// Runs the browser screening and server admission for a list, segment by segment.
// It lives outside any page element, so switching tabs or refreshing data does not stop it
// (old code tied it to box.isConnected). Logic follows operations.js start() and
// giga-browser.js ensureGigaFavorites(); only the DOM coupling is removed.
import {reconcileGigaFavorites} from './listing-runner-screen.js';
import {friendlyError} from '../common/notices.js';
import {KEY, read, write, local, browserState} from './listing-local.js';
import {PACE_DEFAULTS, pace, usage} from './listing-pace.js';
import {rs, queue, listeners, emit, persistQueue} from './listing-runner-state.js';
import {run} from './listing-runner-run.js';
// The runner's public surface is unchanged: these names are still exported from here.
export {local, browserState, PACE_DEFAULTS, pace, usage};

async function pump() {
  while (queue.length && !['running', 'need'].includes(rs.state.phase)) {
    const task = queue.shift();
    rs.stopRequested = false;
    try {
      // Persist active before removing it from the saved queue; interrupted recovery deduplicates.
      localStorage.setItem(KEY.run, JSON.stringify({...task, at: Date.now()}));
      persistQueue();
      await run(task);
    }
    catch (error) {
      if (error.cancelled || error.stopped) {
        emit({phase:'paused',need:null,left:rs.state.task?.codes || task.codes,
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
    if (rs.state.phase === 'done' && rs.state.failedCodes?.length)
      write(KEY.run, {...rs.state.task, codes: rs.state.failedCodes, label: (rs.state.label || '上架') + ' · 没做成的', fresh: true, at: Date.now()});
    else if (rs.state.phase === 'done' || (rs.state.phase === 'paused' && !rs.state.left?.length)) try { localStorage.removeItem(KEY.run); } catch { /* ignore */ }
    if (rs.stopRequested && queue.length && rs.state.phase === 'done')
      emit({phase:'paused',need:null,left:[],message:'当前组已交给服务器；后续选中的组已暂停并保存。'});
    if (rs.state.phase === 'paused' || rs.state.phase === 'error') break;
  }
  emit({});
}

export const runner = {
  get state() { return rs.state; },
  subscribe(fn) { listeners.add(fn); fn(rs.state); return () => listeners.delete(fn); },
  // task: {kind:'prepare'|'query'|'recheck', site, codes, parentJobId?, listId?, label?, fresh?}
  // fresh: skip reusing recent screening receipts and read the 大健 page again.
  start(task) {
    if (!window.edup?.maintenance) throw Error('GIGA_BROWSER_DESKTOP_REQUIRED');
    if (!task.codes?.length) return;
    if (!['running','need','queued'].includes(rs.state.phase) && (queue.length || read(KEY.queue, []).length))
      throw Error('LISTING_QUEUE_RESUME_REQUIRED');
    if (task.groupId && ([...queue, ...(['running','need'].includes(rs.state.phase) ? [rs.state.task] : [])]
      .some(t => t?.listId === task.listId && t?.groupId === task.groupId))) return;
    queue.push(task);
    try { persistQueue(); } catch (error) { queue.pop(); throw error; }
    if (!['running', 'need'].includes(rs.state.phase)) { emit({phase: 'queued'}); pump(); }
    else emit({});
  },
  continue() { if (rs.resumeSignal) { const r = rs.resumeSignal; rs.resumeSignal = null; r(true); } },
  cancel() { if (rs.resumeSignal) { const r = rs.resumeSignal; rs.resumeSignal = null; r(false); } },
  stop() { rs.stopRequested = true; emit({stopping: true, message: (rs.state.message || '') + '（这一段结束后暂停）'}); },
  dismiss() { if (!['running', 'need'].includes(rs.state.phase)) emit({phase: 'idle', message: '', error: null, unknown: false}); },
  busy: () => ['running', 'need'].includes(rs.state.phase),
  // A run cut short by closing the app (journal keeps finished segments).
  interrupted() { return rs.state.phase === 'idle' ? read(KEY.run, null) : null; },
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
