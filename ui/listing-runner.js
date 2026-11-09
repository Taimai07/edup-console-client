// Runs the browser screening and server admission for a list, segment by segment.
// It lives outside any page element, so switching tabs or refreshing data does not stop it
// (old code tied it to box.isConnected). Logic follows operations.js start() and
// giga-browser.js ensureGigaFavorites(); only the DOM coupling is removed.
import {openSegmentJournal} from './giga-segment-journal.js';
import {reconcileGigaFavorites} from './giga-browser.js';
import {friendlyError} from './notices.js';
import {isExcludedRate} from './listing-states.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const KEY = {screens: 'edup:listing:screens:v1', skips: 'edup:listing:skips:v1', lists: 'edup:listing:lists:v1', run: 'edup:listing:run:v1'};
const read = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer convenience only */ } };
const REGION = {US: 'USA', DE: 'DEU', GB: 'GBR', CA: 'CAN', JP: 'JPN'};
const maintenance = (action, arg) => window.edup.maintenance(action, arg);

// Local, per-computer records the server does not keep yet (spec §7.2 screen_outcomes).
export const local = {
  screens: () => new Map(Object.entries(read(KEY.screens, {}))),
  recordScreens(site, rows) {
    if (!rows.length) return;
    const all = read(KEY.screens, {});
    for (const row of rows) all[site + ':' + row.sku] = {reason: row.reason, at: Date.now()};
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 3000);
    write(KEY.screens, Object.fromEntries(kept));
  },
  clearScreens(site, skus) {
    const all = read(KEY.screens, {});
    for (const sku of skus) delete all[site + ':' + sku];
    write(KEY.screens, all);
  },
  skips: () => new Set(read(KEY.skips, [])),
  setSkip(site, sku, on) {
    const all = new Set(read(KEY.skips, []));
    on ? all.add(site + ':' + sku) : all.delete(site + ':' + sku);
    write(KEY.skips, [...all]);
  },
  lists: () => read(KEY.lists, []),
  saveList(list) {
    const all = read(KEY.lists, []).filter(x => x.id !== list.id);
    all.unshift(list);
    write(KEY.lists, all.slice(0, 200));
  },
  addJob(listId, jobId) {
    const all = read(KEY.lists, []);
    const list = all.find(x => x.id === listId);
    if (list && !list.jobs.includes(jobId)) { list.jobs.push(jobId); write(KEY.lists, all); }
  },
};

// The one judgement of "is the 大健 page usable for this site" (spec §6.1).
export function browserState(status, site, busy = false) {
  if (!window.edup?.maintenance) return {key: 'desktop', ok: false, label: '需要桌面客户端', tone: 'grey'};
  if (!status || status.code === 'GIGA_BROWSER_SETUP_REQUIRED') return {key: 'setup', ok: false, label: '未设置', tone: 'grey'};
  if (busy) return {key: 'busy', ok: true, label: '正在执行大健任务', tone: 'blue'};
  if (!status.connected) return {key: 'offline', ok: false, label: '未连接', tone: 'red'};
  if (status.extensionProtocol !== 4) return {key: 'update', ok: false, label: '需要更新扩展', tone: 'amber'};
  const ins = status.inspection || {};
  if (ins.loggedIn !== true || ins.buyer !== true) return {key: 'login', ok: false, label: '没登录买家账号', tone: 'amber'};
  if (REGION[site] && ins.countryCode !== REGION[site])
    return {key: 'region', ok: false, label: '地区不符（当前是 ' + (ins.countryCode || '未知') + '）', tone: 'amber'};
  return {key: 'ok', ok: true, label: '已连接 · ' + (ins.countryCode || site) + ' 买家账号', tone: 'green', wide: status.accountScopeV2 === true};
}

let state = {phase: 'idle', queue: 0};
const listeners = new Set();
const queue = [];
let stopRequested = false, resumeSignal = null;
function emit(patch) { state = {...state, ...patch, queue: queue.length}; for (const fn of listeners) fn(state); }

async function checkFavorites(task, update) {
  let excluded = [], deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const receipt = await maintenance('giga-browser-task', {id: task.id});
    if (receipt.state === 'rates_read') {
      const screening = await maintenance('giga-browser-screen', {id: task.id});
      const rates = new Map(receipt.items.map(row => [row.sku, row.reason || row.state]));
      excluded = screening.excluded.map(row => ({...row, rate: rates.get(row.sku)}));
      if (!screening.task) return {codes: [], items: [], excluded};
      task = screening.task;
      deadline = Date.now() + 30 * 60 * 1000;
      update('正在收藏通过筛选的商品');
    } else if (receipt.state === 'verified') {
      return {...receipt, excluded: [...excluded, ...(receipt.excluded || [])]};
    } else if (receipt.state === 'stopped') {
      throw Error(receipt.code);
    }
    await wait(2000);
  }
  throw Error('GIGA_BROWSER_RECEIPT_UNKNOWN');
}

// Waits for the operator to fix something (connect the page, etc.) and press 继续.
function needUser(need, message, extra = {}) {
  emit({phase: 'need', need, message, ...extra});
  return new Promise(resolve => { resumeSignal = resolve; });
}

async function ensureBrowser(site, count) {
  for (;;) {
    const status = await maintenance('giga-browser-status').catch(() => null);
    const b = browserState(status, site);
    if (b.ok) return status;
    const go = await needUser('browser', '有 ' + count + ' 款要在大健页面筛选。请先连好大健页面（' + b.label + '），再点继续。');
    if (!go) throw Object.assign(Error('LISTING_RUN_CANCELLED'), {cancelled: true});
    emit({phase: 'running', need: null, message: '正在检查大健连接'});
  }
}

async function admit(op, site, receipt, requestId, parentJobId, update) {
  const accepted = new Set(receipt.codes);
  const browserScreen = {id: receipt.screenId, site, items: receipt.items.filter(row => accepted.has(row.sku)),
    ...(receipt.buyerHash ? {buyerHash: receipt.buyerHash} : {})};
  const deadline = Date.now() + 45 * 60 * 1000;
  for (;;) {
    try {
      const job = await window.edup.ai(op, {codes: receipt.codes, requestId, site,
        ...(op === 'giga_prepare' ? {browserScreen} : {}), ...(parentJobId ? {parentJobId} : {})});
      if (!job?.id) throw Error('GIGA_ADMISSION_RECEIPT_INVALID');
      return job;
    } catch (error) {
      const text = String(error.message), unknown = error.outcome === 'unknown' || text.includes('OUTCOME_UNKNOWN');
      if (!unknown && text.includes('GIGA_RETURN_SCREEN_REQUIRED')) throw Object.assign(error, {screenRequired: true});
      if (unknown || !text.includes('GIGA_QUERY_RATE_LIMIT') || Date.now() >= deadline) throw Object.assign(error, {admitUnknown: unknown});
      update('服务器本小时处理名额用完了，1 分钟后再试');
      await wait(60000);
      if (stopRequested) throw Object.assign(error, {stopped: true});
    }
  }
}

async function waitJob(id, update) {
  let job;
  for (;;) {
    job = await window.edup.ai('giga_job', {id});
    if (!['queued', 'running'].includes(job.state)) return job;
    update('服务器正在准备这一段，完成后再开始下一段');
    await wait(5000);
  }
}

async function run(task) {
  const {kind, site, parentJobId = null, listId = null} = task;
  const op = kind === 'query' ? 'giga_query' : 'giga_prepare';
  const codes = [...new Set(task.codes.map(c => c.toUpperCase()))];
  const label = task.label || (kind === 'query' ? '查报价' : parentJobId ? '重新检查' : '准备上架');
  emit({phase: 'running', task: {...task, codes}, label, need: null, message: '正在核对已有进度', error: null, done: 0,
    total: codes.length, segment: 0, segments: 0, excluded: 0, reconcileId: null});
  write(KEY.run, {...task, codes, at: Date.now()});
  const journal = await openSegmentJournal(localStorage, {site, operation: op, parent: parentJobId, codes});
  const processed = new Set();
  for (const [, prior] of journal.entries()) {
    if (prior.state === 'completed') { prior.codes.forEach(c => processed.add(c)); continue; }
    if (!['admitting', 'queued', 'running'].includes(prior.state)) continue;
    const id = prior.jobId || prior.requestId;
    let job;
    try { job = await window.edup.ai('giga_job', {id}); }
    catch (error) { throw Object.assign(error, {admitUnknown: true, requestId: id}); }
    if (['queued', 'running'].includes(job.state)) job = await waitJob(job.id, text => emit({message: '上次交给服务器的一段还在处理：' + text}));
    if (job.state === 'completed') prior.codes.forEach(c => processed.add(c));
  }
  let remaining = codes.filter(c => !processed.has(c));
  if (!remaining.length) { emit({phase: 'done', message: '这些商品都已经处理过，结果保留在清单里。'}); return; }
  // Receipts from a recent screening can be reused; only the rest needs the 大健 page.
  let reused = {receipts: [], missing: remaining};
  if (op === 'giga_prepare' && !task.fresh) reused = await maintenance('giga-browser-reuse', {site, codes: remaining}).catch(() => reused);
  const pending = reused.missing || remaining;
  let status = null;
  if (pending.length) status = await ensureBrowser(site, pending.length);
  const size = status?.accountScopeV2 ? 30 : 20;
  const segments = (reused.receipts || []).map(r => ({codes: r.codes, receipt: r}));
  for (let i = 0; i < pending.length; i += size) segments.push({codes: pending.slice(i, i + size)});
  emit({segments: segments.length});
  for (let index = 0; index < segments.length; index++) {
    if (stopRequested) {
      const left = segments.slice(index).flatMap(s => s.codes);
      emit({phase: 'paused', message: '已暂停，还剩 ' + left.length + ' 款没交给服务器。', left});
      return;
    }
    const seg = segments[index];
    const update = text => emit({phase: 'running', segment: index + 1, message: text});
    let receipt = seg.receipt;
    if (receipt) update('复用最近的筛选记录');
    else {
      update('正在大健页面逐款读取退货率（' + seg.codes.length + ' 款）');
      const started = await maintenance('giga-browser-start', {site, codes: seg.codes});
      receipt = await checkFavorites(started, update);
      if (receipt.codes.length && (receipt.site !== site || receipt.codes.some(sku => !seg.codes.includes(sku))))
        throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
    }
    const outcomes = (receipt.excluded || []).map(row => ({sku: row.sku, reason: row.rate || row.reason || row.state}));
    local.recordScreens(site, outcomes);
    local.clearScreens(site, receipt.codes || []);
    if (outcomes.some(row => row.reason === 'RECONCILIATION_PENDING') && receipt.id) emit({reconcileId: receipt.id});
    emit({excluded: state.excluded + outcomes.filter(row => isExcludedRate(row.reason)).length});
    if (receipt.codes.length) {
      const key = seg.codes.join(',');
      const requestId = journal.reserve(key, receipt.codes);
      update('筛选完成，正在交给服务器');
      let job;
      try { job = await admit(op, site, receipt, requestId, parentJobId, update); }
      catch (error) {
        if (error.screenRequired) journal.seen(key, {id: requestId, state: 'not_admitted'});
        if (error.admitUnknown) { if (listId) local.addJob(listId, requestId); }
        else if (!error.screenRequired) journal.seen(key, {id: requestId, state: 'not_admitted'});
        throw Object.assign(error, {requestId});
      }
      journal.seen(key, job);
      if (listId) local.addJob(listId, job.rootJobId || job.id);
      emit({lastJobId: job.rootJobId || job.id, admission: {requestId, rootJobId: job.rootJobId || job.id}});
      if (segments.length > 1 && index < segments.length - 1) {
        const done = await waitJob(job.id, update);
        journal.seen(key, done);
        if (done.state !== 'completed') throw Error(done.result?.code || 'GIGA_SEGMENT_FAILED');
        await wait(2000);
      }
    }
    emit({done: state.done + seg.codes.length});
  }
  emit({phase: 'done', message: '已全部交给服务器，可以关掉软件，结果会出现在清单里。'});
}

async function pump() {
  while (queue.length && !['running', 'need'].includes(state.phase)) {
    const task = queue.shift();
    stopRequested = false;
    try { await run(task); }
    catch (error) {
      if (error.cancelled) { emit({phase: 'paused', need: null, message: '已取消，没有发给服务器。'}); continue; }
      const f = friendlyError(error);
      emit({phase: 'error', need: error.screenRequired ? 'rescreen' : null, unknown: !!error.admitUnknown,
        message: error.admitUnknown ? '服务器可能已经收到这一段。先看清单里的结果，不要重复开始。' : f.title + '：' + f.message,
        error: {code: f.code, requestId: error.requestId || f.requestId || ''}});
      queue.length = 0;
    }
    if (state.phase === 'done' || state.phase === 'paused') try { localStorage.removeItem(KEY.run); } catch { /* ignore */ }
  }
  emit({});
}

export const runner = {
  get state() { return state; },
  subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  // task: {kind:'prepare'|'query'|'recheck', site, codes, parentJobId?, listId?, label?, fresh?}
  // fresh: skip reusing recent screening receipts and read the 大健 page again.
  start(task) {
    if (!window.edup?.maintenance) throw Error('GIGA_BROWSER_DESKTOP_REQUIRED');
    if (!task.codes?.length) return;
    queue.push(task);
    if (!['running', 'need'].includes(state.phase)) { emit({phase: 'queued'}); pump(); }
    else emit({});
  },
  continue() { if (resumeSignal) { const r = resumeSignal; resumeSignal = null; r(true); } },
  cancel() { if (resumeSignal) { const r = resumeSignal; resumeSignal = null; r(false); } },
  stop() { stopRequested = true; emit({stopping: true, message: (state.message || '') + '（这一段结束后暂停）'}); },
  dismiss() { if (!['running', 'need'].includes(state.phase)) emit({phase: 'idle', message: '', error: null, unknown: false}); },
  busy: () => ['running', 'need'].includes(state.phase),
  // A run cut short by closing the app (journal keeps finished segments).
  interrupted() { return state.phase === 'idle' ? read(KEY.run, null) : null; },
  forgetInterrupted() { try { localStorage.removeItem(KEY.run); } catch { /* ignore */ } },
  async reconcile(id, onText = () => {}) {
    const result = await reconcileGigaFavorites(id, () => true, onText);
    if (!result.excluded.some(row => row.reason === 'RECONCILIATION_PENDING')) emit({reconcileId: null});
    return result;
  },
};
