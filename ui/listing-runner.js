// Runs the browser screening and server admission for a list, segment by segment.
// It lives outside any page element, so switching tabs or refreshing data does not stop it
// (old code tied it to box.isConnected). Logic follows operations.js start() and
// giga-browser.js ensureGigaFavorites(); only the DOM coupling is removed.
import {openSegmentJournal} from './giga-segment-journal.js';
import {reconcileGigaFavorites} from './giga-browser.js';
import {friendlyError} from './notices.js';
import {isExcludedRate} from './listing-states.js';
import {archiveGroups} from './listing-groups.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const KEY = {screens: 'edup:listing:screens:v1', skips: 'edup:listing:skips:v1', lists: 'edup:listing:lists:v1', run: 'edup:listing:run:v1',
  pace: 'edup:listing:pace:v2', usage: 'edup:listing:giga-usage:v1', queue: 'edup:listing:queue:v1'};
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
    all.unshift({...list, groups: archiveGroups(list)});
    // Archives must not silently evict older user lists or ignore storage failure.
    localStorage.setItem(KEY.lists, JSON.stringify(all));
  },
  ensureGroups(listId) {
    const all = read(KEY.lists, []), list = all.find(x => x.id === listId);
    if (list && !Array.isArray(list.groups)) {
      list.groups = archiveGroups(list);
      localStorage.setItem(KEY.lists, JSON.stringify(all));
    }
    return list;
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
const persistQueue = () => localStorage.setItem(KEY.queue, JSON.stringify(queue));

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

// Owner policy: 30-second CD, no client hour/day quotas. v2 deliberately does not inherit
// old v1 quotas. Verification and site errors still pause/back off; ID navigation is no
// guarantee against supplier throttling. Usage history and recovery journals remain intact.
export const PACE_DEFAULTS = Object.freeze({
  restMinutes: 0.5,     // 30 seconds between browser dispatches
  hourly: 0,           // no client hourly quota; site responses still govern retries
  daily: 0,            // no client daily quota
  resumeHour: 9,        // when the daily allowance is used up, carry on the next day from 9:00
});
export function pace() {
  const saved = read(KEY.pace, {});
  const out = {...PACE_DEFAULTS};
  for (const key of Object.keys(out)) if (Number.isFinite(saved?.[key]) && saved[key] >= 0) out[key] = saved[key];
  return out;
}
const VERIFY = ['GIGA_VERIFICATION_REQUIRED', 'GIGA_RESPONSE_INVALID', 'GIGA_DETAIL_REVIEW_REQUIRED'];
const dayOf = ms => { const d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
const DAILY_RESUME = 'edup:listing:giga-daily-resume:v1';
export const usage = {
  rows: () => read(KEY.usage, []).filter(row => row && Number.isFinite(row.at) && Number.isFinite(row.n)),
  record(site, n, now = Date.now()) {
    const rows = usage.rows().filter(row => now - row.at < 36 * 3600e3);
    rows.push({site, n, at: now});
    write(KEY.usage, rows);
  },
  available(site, now = Date.now(), p = pace()) {
    const rows = usage.rows().filter(row => row.site === site);
    const day = rows.filter(row => dayOf(row.at) === dayOf(now)).reduce((sum, row) => sum + row.n, 0);
    const hour = rows.filter(row => now - row.at < 3600e3).reduce((sum, row) => sum + row.n, 0);
    return Math.max(0, Math.floor(Math.min(p.daily ? p.daily - day : Infinity, p.hourly ? p.hourly - hour : Infinity)));
  },
  // How long to wait before `n` more SKUs may be read for `site`, and why. 0 = go now.
  wait(site, n, now = Date.now(), p = pace()) {
    const rows = usage.rows().filter(row => row.site === site);
    const today = dayOf(now);
    const day = rows.filter(row => dayOf(row.at) === today).reduce((sum, row) => sum + row.n, 0);
    const resumes = read(DAILY_RESUME, {}), resume = resumes[site];
    if (p.daily && resume?.limit === p.daily && Number.isFinite(resume.until) && now < resume.until &&
        resume.day !== today && rows.some(row => dayOf(row.at) === resume.day)) {
      return {ms: resume.until - now, why: 'daily', day, remaining: Math.max(0, p.daily - day), resumeHeld: true};
    }
    if (p.daily && day + n > p.daily) {
      const next = new Date(now); next.setDate(next.getDate() + 1); next.setHours(p.resumeHour, 0, 0, 0);
      resumes[site] = {day: today, until: next.getTime(), limit: p.daily};
      write(DAILY_RESUME, resumes);
      return {ms: next.getTime() - now, why: 'daily', day, remaining: Math.max(0, p.daily - day)};
    }
    const hour = rows.filter(row => now - row.at < 3600e3).sort((a, b) => a.at - b.at);
    const hourUsed = hour.reduce((sum, row) => sum + row.n, 0);
    let used = hourUsed, until = now;
    for (const row of hour) {
      if (!p.hourly || used === 0 || used + n <= p.hourly) break;
      used -= row.n; until = row.at + 3600e3;
    }
    const last = rows.reduce((max, row) => Math.max(max, row.at), 0);
    const rest = last ? last + p.restMinutes * 60e3 : 0;
    const at = Math.max(until, rest);
    return at > now ? {ms: at - now, why: until >= rest ? 'hourly' : 'rest', day, hour: hourUsed,
      remaining: p.hourly ? Math.max(0, p.hourly - hourUsed) : null} : {ms: 0, day};
  },
};
const minutes = ms => Math.max(1, Math.ceil(ms / 60e3));
const duration = ms => ms < 60e3 ? Math.ceil(ms / 1000) + ' 秒' : minutes(ms) + ' 分钟';
const clock = ms => { const d = new Date(Date.now() + ms); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); };

// Keeps the 大健 page reads within the allowance. Waiting can be paused like any other wait.
async function throttle(site, n, update) {
  for (;;) {
    if (stopRequested) throw stopped();
    const p = pace();
    if ((p.daily && n > p.daily) || (p.hourly && n > p.hourly)) throw Error('LISTING_PACE_SEGMENT_TOO_LARGE');
    const w = usage.wait(site, n, Date.now(), p);
    if (!w.ms) return;
    const text = w.why === 'daily' ? (w.resumeHeld ? '按每日额度恢复时间等待' : '今日已安排读取 ' + w.day + '/' + p.daily + ' 款次（含重试），剩余 ' + w.remaining + '；本段需要 ' + n + ' 款')
        + '，' + clock(w.ms) + ' 自动继续（软件要开着）'
      : w.why === 'hourly' ? '本小时已安排读取 ' + w.hour + '/' + p.hourly + ' 款次（含重试），剩余 ' + w.remaining + '；本段需要 ' + n + ' 款，' + minutes(w.ms) + ' 分钟后自动继续'
      : '按节奏休息，' + duration(w.ms) + '后继续读取（今日已安排读取 ' + w.day + ' 款次，含重试）';
    update(text);
    await pause(Math.min(w.ms, 60e3));
  }
}

function desktopNotice(title, body) {
  try { if (typeof Notification === 'function') new Notification(title, {body}); } catch { /* best effort */ }
}

// GIGA wants a human on the page (slider puzzle). No automatic retries here: requests from a
// session under verification only make it worse. 继续 tries again, 取消 ends the run.
async function waitForVerification(code, count) {
  note({code, step: 'verification'});
  const detail = code === 'GIGA_DETAIL_REVIEW_REQUIRED';
  const text = detail ? '商品详情页未能核实，' + count + ' 款已暂停。请检查大健页面是否有验证、登录或商品异常提示，处理后点继续。'
    : '大健要求人工验证，' + count + ' 款暂停。请在大健页面随便搜一个商品，按提示完成拼图验证，然后点「已完成验证，继续」。';
  desktopNotice(detail ? 'EDUPLINK：请检查大健商品页面' : 'EDUPLINK：大健要求人工验证', text);
  emit({phase: 'need', need: detail ? 'detail' : 'verify', message: text});
  const go = await new Promise(resolve => { resumeSignal = resolve; });
  resumeSignal = null;
  if (go === false) throw Object.assign(Error('LISTING_RUN_CANCELLED'), {cancelled: true});
  if (stopRequested) throw stopped();
  emit({phase: 'running', need: null, message: '已确认验证完成，继续'});
}

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
    } else if (receipt.state === 'running_in_browser') {
      const stages = {starting: '开始核对', session: '核对买家账号', search: '搜索商品编号',
        list: '核对商品列表', detail: '读取商品退货率', favorite: '核对收藏'};
      const p = receipt.progress;
      const label = stages[p?.stage] || '等待浏览器返回结果';
      const count = Number.isInteger(p?.index) && Number.isInteger(p?.total) && p.index > 0 && p.index <= p.total
        ? ' · 第 ' + p.index + '/' + p.total + ' 款' : '';
      const elapsed = Number.isFinite(receipt.elapsedSeconds) ? ' · 已用 ' + Math.floor(receipt.elapsedSeconds / 60) + ' 分钟' : '';
      update(label + count + elapsed);
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
      await throttle(site, codes.length, update);
      update('正在大健页面逐款读取退货率（' + codes.length + ' 款）');
      const started = await maintenance('giga-browser-start', {site, codes});
      usage.record(site, codes.length);
      const receipt = await checkFavorites(started, update);
      if (receipt.codes.length && (receipt.site !== site || receipt.codes.some(sku => !codes.includes(sku))))
        throw Error('GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH');
      return receipt;
    } catch (error) {
      if (error.cancelled || error.stopped) throw error;
      const code = codeOf(error);
      if (code === 'LISTING_PACE_SEGMENT_TOO_LARGE') throw error;
      if (CONNECTION.includes(code)) { await waitForBrowser(site, codes.length); continue; }
      if (VERIFY.includes(code)) { await waitForVerification(code, codes.length); continue; }
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
    total: codes.length, segment: 0, segments: 0, excluded: 0, reconcileId: null, failed: 0, failedCodes: [], recovered: 0,
    stopping: false, left: [], unknown: false});
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
  const recovered = codes.filter(code => processed.has(code)).length;
  emit({done: recovered, recovered});
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
    const update = text => emit({phase: 'running', segment: index + 1, message: text});
    let seg = segments[index];
    if (!seg.key && !seg.receipt) {
      await throttle(site, 1, update);
      const available = usage.available(site);
      if (available > 0 && available < seg.codes.length) {
        segments.splice(index, 1, {codes: seg.codes.slice(0, available)}, {codes: seg.codes.slice(available)});
        seg = segments[index];
        emit({segments: segments.length});
      }
    }
    const key = seg.key || seg.codes.join(',');
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
    try {
      // Persist active before removing it from the saved queue; interrupted recovery deduplicates.
      localStorage.setItem(KEY.run, JSON.stringify({...task, at: Date.now()}));
      persistQueue();
      await run(task);
    }
    catch (error) {
      if (error.cancelled || error.stopped) {
        emit({phase:'paused',need:null,left:state.task?.codes || task.codes,
          message:'已暂停。已交给服务器的任务保留，剩下的商品和分组可点「继续剩下的」。'});
        break;
      }
      const f = friendlyError(error);
      emit({phase: 'error', need: error.screenRequired ? 'rescreen' : null, unknown: !!error.admitUnknown,
        message: error.admitUnknown ? '服务器可能已经收到这一段。先看清单里的结果，不要重复开始。' : f.title + '：' + f.message,
        error: {code: f.code, requestId: error.requestId || f.requestId || ''}});
      queue.length = 0;
      // Preserve the unstarted saved queue for explicit recovery after an error.
    }
    // A finished run with leftovers stays as "上次有一份没做完" so a restart can pick them up.
    if (state.phase === 'done' && state.failedCodes?.length)
      write(KEY.run, {...state.task, codes: state.failedCodes, label: (state.label || '上架') + ' · 没做成的', fresh: true, at: Date.now()});
    else if (state.phase === 'done' || (state.phase === 'paused' && !state.left?.length)) try { localStorage.removeItem(KEY.run); } catch { /* ignore */ }
    if (state.phase === 'paused' || state.phase === 'error') break;
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
    if (!['running','need','queued'].includes(state.phase) && (queue.length || read(KEY.queue, []).length))
      throw Error('LISTING_QUEUE_RESUME_REQUIRED');
    if (task.groupId && ([...queue, ...(['running','need'].includes(state.phase) ? [state.task] : [])]
      .some(t => t?.listId === task.listId && t?.groupId === task.groupId))) return;
    queue.push(task);
    try { persistQueue(); } catch (error) { queue.pop(); throw error; }
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
  savedQueue() { return read(KEY.queue, []); },
  discardPending() {
    if (runner.busy()) throw Error('LISTING_RUN_ACTIVE');
    localStorage.removeItem(KEY.queue);
    localStorage.removeItem(KEY.run);
    queue.length = 0;
    emit({phase:'idle', message:'', error:null, unknown:false});
  },
  resumeSaved() {
    if (runner.busy()) return;
    const active = read(KEY.run, null), saved = read(KEY.queue, []);
    const tasks = [active, ...saved].filter(Boolean);
    const seen = new Set();
    queue.length = 0;
    for (const task of tasks) {
      const key = JSON.stringify([task.site,task.kind,task.listId,task.groupId,task.codes,task.parentJobId]);
      if (!seen.has(key)) { seen.add(key); queue.push(task); }
    }
    persistQueue();
    if (queue.length) { emit({phase: 'queued'}); pump(); }
  },
  forgetInterrupted() { try { localStorage.removeItem(KEY.run); } catch { /* ignore */ } },
  async reconcile(id, onText = () => {}) {
    const result = await reconcileGigaFavorites(id, () => true, onText);
    if (!result.excluded.some(row => row.reason === 'RECONCILIATION_PENDING')) emit({reconcileId: null});
    return result;
  },
};
