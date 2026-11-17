'use strict';
const HOST = 'com.eduplink.giga_browser';
let port = null, tabId = null, timer = null, busy = false, latest = '未连接';
let taskProgress = false, activeTask = null, progressRead = false;
let lastProgress = null;
let taskDiagnostics = false, bridgeSequence = 0, bridgeEvents = [], pageEvents = [], lastTickAt = 0;
let lastTabSnapshot = '';
function bridgeEvent(event, fields = {}) {
  bridgeEvents.push({source: 'bridge', seq: ++bridgeSequence, at: Date.now(), event, stage: 'bridge', ...fields});
  bridgeEvents = bridgeEvents.slice(-8);
}
function diagnosticBatch() { return [...bridgeEvents, ...pageEvents.slice(-24)]; }
function cleanDiagnostic(row, total) {
  if (!row || row.source !== 'page' || !Number.isSafeInteger(row.seq) || row.seq < 1 ||
      !Number.isFinite(row.at) || row.at < 0 || row.at > 1e15 ||
      !['step_start', 'step_end', 'request_start', 'response_headers', 'body_read', 'request_error',
        'frame_state', 'frame_wait', 'timer_delay', 'visibility', 'page_lifecycle'].includes(row.event)) return null;
  const out = {source: 'page', seq: row.seq, at: row.at, event: row.event};
  const enums = {stage: ['starting', 'session', 'search', 'list', 'detail', 'favorite'],
    contentKind: ['json', 'html', 'text', 'other', 'unknown'], visibility: ['visible', 'hidden', 'prerender', 'unknown'],
    readyState: ['loading', 'interactive', 'complete', 'unknown'], routeType: ['product', 'login', 'other', 'blank', 'cross_origin']};
  for (const [key, values] of Object.entries(enums)) if (values.includes(row[key])) out[key] = row[key];
  for (const key of ['durationMs', 'bodyBytes', 'timerLagMs'])
    if (Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1e15) out[key] = row[key];
  for (const key of ['frameAccessible', 'panelPresent', 'skuMatched', 'rateFound', 'challengeTextSeen', 'challengeControlSeen'])
    if (typeof row[key] === 'boolean') out[key] = row[key];
  if (Number.isInteger(row.index) && row.index >= 0 && row.index <= total) out.index = row.index;
  if (row.total === total) out.total = total;
  if (Number.isInteger(row.httpStatus) && row.httpStatus >= 0 && row.httpStatus <= 599) out.httpStatus = row.httpStatus;
  if (typeof row.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(row.errorCode)) out.errorCode = row.errorCode;
  if (typeof row.productId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.productId)) out.productId = row.productId;
  return out;
}
const valid = url => { try { return new URL(url).origin === 'https://www.gigab2b.com'; } catch { return false; } };
const safeError = error => /^[A-Z0-9_]{1,100}$/.test(error?.message || '') ? error.message : 'BRIDGE_ACTION_FAILED';
function disconnect() {
  const target = tabId;
  if (busy && Number.isInteger(target)) {
    bridgeEvent('bridge_disconnect');
    if (taskDiagnostics && activeTask) port?.postMessage({type: 'heartbeat', id: activeTask.id, diagnostics: diagnosticBatch()});
    chrome.scripting.executeScript({target: {tabId: target, frameIds: [0]}, world: 'MAIN',
      func: () => { globalThis[Symbol.for('edup.giga.abort')]?.abort(); }}).catch(() => {});
  }
  clearInterval(timer); timer = null; tabId = null;
  const old = port; port = null; if (old) old.disconnect();
  latest = '已断开'; chrome.action.setBadgeText({text: ''});
}
async function inject(file) {
  const tab = await chrome.tabs.get(tabId);
  if (!valid(tab.url)) throw Error('GIGA_TAB_CLOSED_OR_NAVIGATED');
  const results = await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'MAIN', files: [file]});
  if (results.length !== 1 || !results[0].result) throw Error('PAGE_RESULT_MISSING');
  return results[0].result;
}
async function receive(message) {
  if (message.type === 'hello_ack') {
    taskProgress = message.taskProgress === true;
    taskDiagnostics = message.taskDiagnostics === true;
    return;
  }
  if (message.type !== 'task') return;
  if (busy) return;
  busy = true;
  activeTask = message;
  bridgeSequence = 0; bridgeEvents = []; pageEvents = []; lastTickAt = Date.now(); lastTabSnapshot = '';
  bridgeEvent('bridge_received');
  lastProgress = {stage: 'starting', index: 0, total: message.skus?.length || 0};
  try {
    const files = {inspect: 'inspect.js', read_rates: 'favorites.js', favorites: 'favorites.js', store: 'store.js'};
    if (!files[message.op]) throw Error('OPERATION_NOT_ALLOWED');
    if (!Number.isFinite(message.expiresAt) || Date.now() / 1000 > message.expiresAt) throw Error('TASK_EXPIRED');
    latest = message.op === 'inspect' ? '正在检查地区' : message.op === 'store' ? '正在核对店铺与商品清单' : '正在核对商品详情与收藏';
    if (message.op === 'favorites' || message.op === 'read_rates') {
      await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'MAIN',
        func: task => { globalThis[Symbol.for('edup.giga.frozenTask')] = Object.freeze(task); },
        args: [{id: message.id, phase: message.op, site: message.site, skus: [...message.skus], approved: message.approved,
          buyerSalt: message.buyerSalt, expectedBuyerHash: message.expectedBuyerHash, reconcileOnly:message.reconcileOnly,
          ...(message.known ? {known: message.known} : {})}]});
    } else if (message.op === 'store') {
      const {id, action, site, input, ticket, page, allowWrite} = message;
      await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'MAIN',
        func: task => { globalThis[Symbol.for('edup.giga.storeTask')] = Object.freeze(task); },
        args: [{id, action, site, input, ticket, page, allowWrite}]});
    }
    bridgeEvent('bridge_inject');
    const result = await inject(files[message.op]);
    // The primary result never waits indefinitely for optional diagnostic sampling.
    if (taskDiagnostics) await Promise.race([samplePage(message.id), new Promise(resolve => setTimeout(resolve, 500))]);
    bridgeEvent('bridge_result_sent');
    port?.postMessage({type: 'result', id: message.id, result,
      ...(taskDiagnostics ? {diagnostics: diagnosticBatch()} : {})});
    latest = result.state || result.status || '已返回检查结果';
  } catch (error) {
    bridgeEvent('bridge_error', {errorCode: safeError(error)});
    port?.postMessage({type: 'result', id: message.id, result: {state: 'STOPPED', code: safeError(error)},
      ...(taskDiagnostics ? {diagnostics: diagnosticBatch()} : {})});
    latest = safeError(error);
  } finally { busy = false; activeTask = null; lastProgress = null; }
}
async function samplePage(id) {
  if (progressRead || !Number.isInteger(tabId)) return;
  progressRead = true;
  try {
    const [tab, results] = await Promise.all([
      chrome.tabs.get(tabId),
      chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'MAIN', func: () => ({
        progress: globalThis[Symbol.for('edup.giga.progress')] || null,
        diagnostics: globalThis[Symbol.for('edup.giga.diagnostics')] || null,
      })}),
    ]);
    if (activeTask?.id !== id) return;
    const value = results[0]?.result?.progress;
    if (value?.taskId === id && ['starting', 'session', 'search', 'list', 'detail', 'favorite'].includes(value.stage) &&
        Number.isInteger(value.index) && value.index >= 0 && value.index <= lastProgress.total) {
      lastProgress = {stage: value.stage, index: value.index, total: lastProgress.total};
    }
    const diagnostics = results[0]?.result?.diagnostics;
    if (taskDiagnostics && diagnostics?.taskId === id && Array.isArray(diagnostics.events)) {
      pageEvents = diagnostics.events.slice(-24).map(row => cleanDiagnostic(row, lastProgress.total)).filter(Boolean);
      const tabState = {tabActive: tab.active === true, tabDiscarded: tab.discarded === true,
        ...(typeof tab.frozen === 'boolean' ? {tabFrozen: tab.frozen} : {}),
        tabStatus: ['loading', 'complete', 'unloaded'].includes(tab.status) ? tab.status : 'unknown'};
      const signature = JSON.stringify(tabState);
      if (signature !== lastTabSnapshot) { lastTabSnapshot = signature; bridgeEvent('frame_state', tabState); }
    }
  } catch (_) {
    if (activeTask?.id === id) bridgeEvent('bridge_error', {errorCode: 'DIAGNOSTIC_SAMPLE_FAILED'});
  } finally { progressRead = false; }
}
function tick() {
  if (!busy) { port?.postMessage({type: 'poll'}); return; }
  if (!taskProgress || !activeTask) return;
  const id = activeTask.id;
  if (lastTickAt && Date.now() - lastTickAt > 5000) bridgeEvent('timer_delay', {timerLagMs: Date.now() - lastTickAt - 2000});
  lastTickAt = Date.now();
  port?.postMessage({type: 'heartbeat', id, progress: lastProgress,
    ...(taskDiagnostics ? {diagnostics: diagnosticBatch()} : {})});
  void samplePage(id);
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'status') { sendResponse({connected: !!port, busy, latest}); return; }
  if (message.type === 'disconnect') { disconnect(); sendResponse({ok: true}); return; }
  if (message.type !== 'connect') return;
  (async () => {
    if (busy) throw Error('TASK_ALREADY_RUNNING');
    if (port) disconnect();
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || !valid(tab.url)) throw Error('OPEN_GIGA_TAB_FIRST');
    tabId = tab.id;
    // A reloaded worker can inherit a page whose earlier read is still awaiting a timer.
    // Cancel that page-local run before taking ownership; existing write checkpoints remain.
    await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, world: 'MAIN',
      func: () => { globalThis[Symbol.for('edup.giga.abort')]?.abort(); }});
    // This is the only tab selected, and activeTab permission comes from the user's popup click.
    const inspection = await inject('inspect.js');
    const connectedPort = chrome.runtime.connectNative(HOST);
    port = connectedPort;
    taskProgress = false;
    taskDiagnostics = false;
    connectedPort.onMessage.addListener(message => { if (port === connectedPort) receive(message); });
    connectedPort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (port !== connectedPort) return;
      port = null; disconnect();
      latest = error ? '本机连接未接通：' + error.message : '连接已结束';
      chrome.action.setBadgeText({text: ''});
    });
    port.postMessage({type: 'hello', inspection, extensionProtocol: 4, storeCatalog: true, accountScopeV2: true, knownProducts: true});
    timer = setInterval(tick, 2000);
    latest = '已授权此大健标签页，等待本机连接确认';
    chrome.action.setBadgeText({text: 'ON'});
    return {ok: true, inspection};
  })().then(sendResponse).catch(error => sendResponse({ok: false, code: safeError(error)}));
  return true;
});
