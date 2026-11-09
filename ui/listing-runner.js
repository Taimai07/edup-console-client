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
  // Remembers whether the server has a copy of this list (sku_list_save), so a failed backup is
  // still visible after the app restarts.
  setBackup(listId, patch) {
    const all = read(KEY.lists, []);
    const list = all.find(x => x.id === listId);
    if (list) { Object.assign(list, patch); write(KEY.lists, all); }
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

// 11-09: a list of 2000+ codes stopped for good at the first browser hiccup and each segment waited
// for the server before the browser started the next one. Now every step retries on its own, a
// segment that still fails is set aside while the rest go on, and the browser works on the next
// segment while the server prepares the previous one (still one server job at a time).
const BROWSER_WAITS = [60e3, 3 * 60e3, 10 * 60e3];
const CONNECTION = ['GIGA_BROWSER_NOT_CONNECTED', 'GIGA_BROWSER_REGION_MISMATCH', 'GIGA_BROWSER_UPDATE_REQUIRED', 'GIGA_BROWSER_SETUP_REQUIRED'];
const TRANSIENT = /GIGA_QUERY_RATE_LIMIT|AI_SERVICE_NOT_CONNECTED|AI_SERVICE_TIMEOUT|AI_SERVICE_FAILED|AI_REQUEST_FAILED|AI_SERVICE_RESPONSE_INVALID|OPERATIONS_REQUEST_FAILED|NETWORK_BUSY|HTTP_5\d\d|RESPONSE_TOO_LARGE|ETIMEDOUT|ECONNRESET|fetch failed/;
const codeOf = error => (String(error?.message || error || '').match(/\b[A-Z][A-Z0-9_]{3,}\b/) || ['REQUEST_FAILED'])[0];
const unknownOutcome = error => error?.outcome === 'unknown' || String(error?.message || '').includes('OUTCOME_UNKNOWN');
const stopped = () => Object.assign(Error('LISTING_RUN_STOPPED'), {stopped: true});

// Best effort: why a run waited or set a segment aside reaches the diagnostics upload, so the
// server can see where a list stopped. Older desktops without the action simply ignore it.
function note(event) {
  try { Promise.resolve(window.edup?.maintenance?.('listing-event', event)).catch(() => {}); } catch { /* ignore */ }
}

// Waits that end early when the operator asks to pause.
async function pause(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && !stopRequested) await wait(Math.min(1000, end - Date.now()));
}

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

// The 大健 page has to be usable. Instead of stopping, keep checking every 10 s and carry on by
// itself once it is; 继续 just checks at once, 取消 ends the run.
async function waitForBrowser(site, count) {
  let asked = false;
  for (;;) {
    const status = await maintenance('giga-browser-status').catch(() => null);
    const b = browserState(status, site);
    if (b.ok) {
      if (asked) emit({phase: 'running', need: null, message: '大健页面已连好，继续'});
      return status;
    }
    if (!asked) { asked = true; note({code: 'GIGA_BROWSER_' + b.key.toUpperCase(), step: 'browser'}); }
    emit({phase: 'need', need: 'browser', message: '有 ' + count + ' 款要在大健页面处理。请连好大健页面（' + b.label + '），连好后会自动继续。'});
    const go = await new Promise(resolve => { resumeSignal = resolve; setTimeout(() => resolve('check'), 10000); });
    resumeSignal = null;
    if (go === false) throw Object.assign(Error('LISTING_RUN_CANCELLED'), {cancelled: true});
    if (stopRequested) throw stopped();
  }
}

// Reads rates, records the screening and favorites one segment, recovering by itself: waits for
// the page, closes out a task left unfinished last time, and retries with growing pauses.
async function screenSegment(codes, site, update) {
  let attempt = 0, expiryWaits = 0;
  for (;;) {
    if (stopRequested) throw stopped();
    try {
      update('正在大健页面逐款读取退货率（' + codes.length + ' 款）');
      const started = await maintenance('giga-browser-start', {site, codes});
      const receipt = await checkFavorites(started, update);
      if (receipt.codes.length && (receipt.site !== site || receipt.codes.some(sku => !codes.includes(sku))))
        throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
      return receipt;
    } catch (error) {
      if (error.cancelled || error.stopped) throw error;
      const code = codeOf(error);
      if (CONNECTION.includes(code)) { await waitForBrowser(site, codes.length); continue; }
      if (code === 'GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION') {
        try {
          update('上次的大健收藏没收尾，正在自动核对');
          await reconcileGigaFavorites(undefined, () => !stopRequested, update);
          continue;
        } catch (reconcileError) {
          // A read task from last time is still open; it expires within 30 minutes.
          if (codeOf(reconcileError) === 'GIGA_FAVORITE_RECONCILIATION_NOT_REQUIRED' && expiryWaits++ < 35) {
            update('上一个大健读取任务还没结束，1 分钟后再试（最多等它 30 分钟过期）');
            await pause(60e3);
            continue;
          }
        }
      }
      if (attempt >= BROWSER_WAITS.length) throw error;
      const ms = BROWSER_WAITS[attempt++];
      note({code, step: 'browser', attempt});
      update('大健页面这一步没成功（' + code + '），' + ms / 60e3 + ' 分钟后自动重试（第 ' + attempt + '/' + BROWSER_WAITS.length + ' 次）');
      await pause(ms);
    }
  }
}

// Hands one screened segment to the server. The same request id is safe to send again: the
// server returns the job it already made for it, so unknown outcomes and busy hours are retried.
async function admit(op, site, receipt, requestId, parentJobId, update, previouslyUncertain = false) {
  const accepted = new Set(receipt.codes);
  const browserScreen = {id: receipt.screenId, site, items: receipt.items.filter(row => accepted.has(row.sku)),
    ...(receipt.buyerHash ? {buyerHash: receipt.buyerHash} : {})};
  const deadline = Date.now() + 45 * 60 * 1000;
  let tries = 0;
  let uncertain = previouslyUncertain;
  for (;;) {
    try {
      const job = await window.edup.ai(op, {codes: receipt.codes, requestId, site,
        ...(op === 'giga_prepare' ? {browserScreen} : {}), ...(parentJobId ? {parentJobId} : {})});
      if (!job?.id) throw Error('GIGA_ADMISSION_RECEIPT_INVALID');
      return job;
    } catch (error) {
      const unknown = unknownOutcome(error), text = String(error?.message || '');
      uncertain ||= unknown;
      if (!uncertain && text.includes('GIGA_RETURN_SCREEN_REQUIRED')) throw Object.assign(error, {screenRequired: true});
      if (!(unknown || TRANSIENT.test(text)) || Date.now() >= deadline || stopRequested) throw Object.assign(error, {admitUnknown: uncertain});
      const busy = text.includes('GIGA_QUERY_RATE_LIMIT');
      update(busy ? '服务器本小时处理名额用完了，1 分钟后自动再交' : '没确认服务器是否收到（' + codeOf(error) + '），用同一个编号自动再交');
      await pause(busy ? 60e3 : Math.min(60e3, 10e3 * ++tries));
      if (stopRequested) throw Object.assign(stopped(), {admitUnknown: uncertain});
    }
  }
}

// Reads a job, riding out short network trouble. null means the server never made it.
async function readJob(id) {
  for (let failures = 0; ; failures++) {
    try { return await window.edup.ai('giga_job', {id}); }
    catch (error) {
      if (codeOf(error) === 'JOB_NOT_FOUND') return null;
      if (failures >= 20) throw error;
      await wait(Math.min(60e3, 5e3 * (failures + 1)));
    }
  }
}

async function waitJob(id, update) {
  for (;;) {
    const job = await readJob(id);
    if (!job || !['queued', 'running'].includes(job.state)) return job;
    update('服务器正在准备上一段，浏览器这边已经可以接着做');
    await wait(5000);
  }
}

async function run(task) {
  const {kind, site, parentJobId = null, listId = null} = task;
  const op = kind === 'query' ? 'giga_query' : 'giga_prepare';
  const codes = [...new Set(task.codes.map(c => c.toUpperCase()))];
  const journalCodes = task.journalCodes || codes;
  const wanted = new Set(codes);
  const label = task.label || (kind === 'query' ? '查报价' : parentJobId ? '重新检查' : '准备上架');
  emit({phase: 'running', task: {...task, codes, journalCodes}, label, need: null, message: '正在核对已有进度', error: null, done: 0,
    total: codes.length, segment: 0, segments: 0, excluded: 0, reconcileId: null, failed: 0, failedCodes: []});
  write(KEY.run, {...task, codes, journalCodes, at: Date.now()});
  const journal = await openSegmentJournal(localStorage, {site, operation: op, parent: parentJobId, codes: journalCodes});
  const processed = new Set(), reserved = new Set(), earlier = [], pendingSegments = [];
  for (const [key, prior] of journal.entries()) {
    if (!prior.codes.some(code => wanted.has(code))) continue;
    if (prior.state === 'completed') { prior.codes.forEach(c => processed.add(c)); continue; }
    if (!['admitting', 'queued', 'running'].includes(prior.state)) continue;
    let job;
    try { job = await readJob(prior.jobId || prior.requestId); }
    catch (error) { throw Object.assign(error, {admitUnknown: true, requestId: prior.requestId}); }
    if (!job) {
      // Preserve both the request ID and its exact SKU payload. A subset retry
      // must not regroup this segment, even after a JOB_NOT_FOUND readback.
      if (prior.codes.some(code => !wanted.has(code))) throw Error('GIGA_SEGMENT_JOURNAL_CONFLICT');
      pendingSegments.push({codes: prior.codes, key, previouslyUncertain: true});
      for (const code of key.split(',')) reserved.add(code);
      continue;
    }
    journal.seen(key, job);
    if (['queued', 'running', 'completed'].includes(job.state)) { prior.codes.forEach(c => processed.add(c)); if (job.state !== 'completed') earlier.push({job, key}); }
  }
  const remaining = codes.filter(c => !processed.has(c) && !reserved.has(c));
  if (!remaining.length && !earlier.length && !pendingSegments.length) { emit({phase: 'done', message: '这些商品都已经处理过，结果保留在清单里。'}); return; }
  // Receipts from a recent screening can be reused; only the rest needs the 大健 page.
  let reused = {receipts: [], missing: remaining};
  if (op === 'giga_prepare' && !task.fresh && remaining.length) reused = await maintenance('giga-browser-reuse', {site, codes: remaining}).catch(() => reused);
  const pending = reused.missing || remaining;
  let status = null;
  const toScreen = pending.length + pendingSegments.reduce((count, segment) => count + segment.codes.length, 0);
  if (toScreen) status = await waitForBrowser(site, toScreen);
  const size = status?.accountScopeV2 ? 30 : 20;
  const segments = [...pendingSegments, ...(reused.receipts || []).map(r => ({codes: r.codes, receipt: r}))];
  for (let i = 0; i < pending.length; i += size) segments.push({codes: pending.slice(i, i + size)});
  emit({segments: segments.length});
  let inflight = earlier.shift() || null;
  const failed = [];
  // The server prepares one segment at a time; the browser meanwhile screens the next one.
  const settle = async update => {
    for (const item of [inflight, ...earlier.splice(0)].filter(Boolean)) {
      const done = await waitJob(item.job.id, update);
      if (done) journal.seen(item.key, done);
      if (done && done.state !== 'completed') note({code: done.result?.code || 'GIGA_SEGMENT_FAILED', step: 'preparation'});
    }
    inflight = null;
  };
  for (let index = 0; index < segments.length; index++) {
    if (stopRequested) {
      const left = segments.slice(index).flatMap(s => s.codes);
      emit({phase: 'paused', message: '已暂停，还剩 ' + left.length + ' 款没交给服务器。已交给服务器的会照常准备。', left});
      return;
    }
    const seg = segments[index], key = seg.key || seg.codes.join(',');
    const update = text => emit({phase: 'running', segment: index + 1, message: text});
    let receipt = seg.receipt, unconfirmed = [];
    if (receipt) update('复用最近的筛选记录');
    try {
      for (let round = 0; ; round++) {
        if (!receipt) receipt = await screenSegment(seg.codes, site, update);
        const outcomes = (receipt.excluded || []).map(row => ({sku: row.sku, reason: row.rate || row.reason || row.state}));
        if (round === 0) {
          local.recordScreens(site, outcomes);
          local.clearScreens(site, receipt.codes || []);
          if (outcomes.some(row => row.reason === 'RECONCILIATION_PENDING') && receipt.id) emit({reconcileId: receipt.id});
          emit({excluded: state.excluded + outcomes.filter(row => isExcludedRate(row.reason)).length});
        }
        // Favorites the page could not confirm are retried with the rest at the end.
        unconfirmed = outcomes.filter(row => row.reason === 'RECONCILIATION_PENDING').map(row => row.sku);
        if (!receipt.codes.length) break;
        if (inflight || earlier.length) await settle(update);
        const requestId = journal.reserve(key, receipt.codes);
        update('筛选完成，正在交给服务器');
        try {
          const job = await admit(op, site, receipt, requestId, parentJobId, update, seg.previouslyUncertain);
          journal.seen(key, job);
          if (listId) local.addJob(listId, job.rootJobId || job.id);
          emit({lastJobId: job.rootJobId || job.id, admission: {requestId, rootJobId: job.rootJobId || job.id}});
          inflight = {job, key};
          break;
        } catch (error) {
          const found = error.admitUnknown ? await readJob(requestId).catch(() => null) : null;
          if (found) {
            journal.seen(key, found);
            if (listId) local.addJob(listId, found.rootJobId || found.id);
            inflight = {job: found, key};
            break;
          }
          if (error.screenRequired && round < 2) {
            journal.seen(key, {id: requestId, state: 'not_admitted'});
            receipt = null;
            update('筛选结果过期了，自动重新筛选这一段');
            continue;
          }
          if (error.admitUnknown) { if (listId) local.addJob(listId, requestId); }
          else journal.seen(key, {id: requestId, state: 'not_admitted'});
          throw Object.assign(error, {requestId});
        }
      }
      if (unconfirmed.length) failed.push({codes: unconfirmed, code: 'RECONCILIATION_PENDING'});
    } catch (error) {
      if (error.cancelled || error.stopped) throw error;
      const code = codeOf(error);
      failed.push({codes: seg.codes, code, unknown: !!error.admitUnknown});
      note({code, step: 'segment', segment: index + 1, unknown: !!error.admitUnknown});
      emit({message: '第 ' + (index + 1) + ' 段没做成（' + code + '），先跳过，接着做下一段'});
    }
    const failedCodes = [...new Set(failed.flatMap(f => f.codes))];
    emit({done: state.done + seg.codes.length, failed: failedCodes.length, failedCodes});
  }
  const failedCodes = [...new Set(failed.flatMap(f => f.codes))];
  const unknown = failed.some(f => f.unknown);
  emit({phase: 'done', failedCodes, unknown,
    message: !failedCodes.length ? '已全部交给服务器，可以关掉软件，结果会出现在清单里。'
      : '其余已交给服务器；' + failedCodes.length + ' 款没做成（' + [...new Set(failed.map(f => f.code))].join('、') + '）。' +
        (unknown ? '其中有的可能服务器已经收到，重试时会用原编号核对，不会重复。' : '可以点「重试没做成的」。')});
}

async function pump() {
  while (queue.length && !['running', 'need'].includes(state.phase)) {
    const task = queue.shift();
    stopRequested = false;
    try { await run(task); }
    catch (error) {
      if (error.cancelled) { emit({phase: 'paused', need: null, message: '已取消，没有发给服务器。'}); continue; }
      if (error.stopped) { emit({phase: 'paused', need: null, left: state.task?.codes || [], message: '已暂停。已交给服务器的会照常准备，没交的点「继续剩下的」接着做。'}); continue; }
      const f = friendlyError(error);
      emit({phase: 'error', need: error.screenRequired ? 'rescreen' : null, unknown: !!error.admitUnknown,
        message: error.admitUnknown ? '服务器可能已经收到这一段。先看清单里的结果，不要重复开始。' : f.title + '：' + f.message,
        error: {code: f.code, requestId: error.requestId || f.requestId || ''}});
      queue.length = 0;
    }
    // A finished run with leftovers stays as "上次有一份没做完" so a restart can pick them up.
    if (state.phase === 'done' && state.failedCodes?.length)
      write(KEY.run, {...state.task, codes: state.failedCodes, label: (state.label || '上架') + ' · 没做成的', fresh: true, at: Date.now()});
    else if (state.phase === 'done' || (state.phase === 'paused' && !state.left?.length)) try { localStorage.removeItem(KEY.run); } catch { /* ignore */ }
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
