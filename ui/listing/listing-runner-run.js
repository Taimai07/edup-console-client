// The listing runner: runs one task, segment by segment, recovering from the segment journal.
// Split out of listing-runner.js unchanged (client round 3); the module state the runner shares is `rs` in listing-runner-state.js.
import {openSegmentJournal} from '../giga/giga-segment-journal.js';
import {isExcludedRate} from './listing-states.js';
import {storageCode} from '../common/storage-state.js';
import {KEY, write, maintenance, local} from './listing-local.js';
import {usage} from './listing-pace.js';
import {codeOf, note, readJob, waitJob} from './listing-runner-io.js';
import {rs, emit} from './listing-runner-state.js';
import {throttle, screenSegment, waitForBrowser} from './listing-runner-screen.js';
import {admit} from './listing-runner-admit.js';

async function run(task) {
  const {kind, site, parentJobId = null, listId = null} = task;
  const op = kind === 'query' ? 'giga_query' : 'giga_prepare';
  const codes = [...new Set(task.codes.map(c => c.toUpperCase()))];
  const journalCodes = task.journalCodes || codes;
  const wanted = new Set(codes);
  const label = task.label || (kind === 'query' ? '查报价' : parentJobId ? '重新检查' : '筛选并上传');
  emit({phase: 'running', task: {...task, codes, journalCodes}, label, need: null, message: '正在核对已有进度', error: null, done: 0,
    total: codes.length, segment: 0, segments: 0, excluded: 0, reconcileId: null, failed: 0, failedCodes: [], recovered: 0,
    stopping: false, left: [], unknown: false});
  write(KEY.run, {...task, codes, journalCodes, at: Date.now()});
  const journal = await openSegmentJournal(localStorage, {site, operation: op, parent: parentJobId, codes: journalCodes});
  const processed = new Set(), reserved = new Set(), earlier = [], pendingSegments = [];
  for (const [key, prior] of journal.entries()) {
    if (!prior.codes.some(code => wanted.has(code))) continue;
    // 'held' (0.8.7): the server keeps the SKUs for the operator; they are uploaded, never sent again.
    if (['completed', 'held'].includes(prior.state)) { prior.codes.forEach(c => processed.add(c)); continue; }
    if (!['admitting', 'queued', 'running'].includes(prior.state) &&
        !(op === 'giga_prepare' && ['failed', 'interrupted'].includes(prior.state))) continue;
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
    if (op === 'giga_prepare') {
      journal.seen(key, job);
      prior.codes.forEach(code => processed.add(code));
      continue;
    }
    if (storageCode(job)) {
      // The server returned a definite terminal resource hold, not an unknown admission.
      // Keep successful sibling SKUs, and retry only the unfinished items after manual resume.
      journal.seen(key, {id:job.id, state:'failed'});
      for (const row of job.result?.pipeline?.items || [])
        if (row.sku && !storageCode(row)) processed.add(row.sku);
      continue;
    }
    journal.seen(key, job);
    if (['queued', 'running', 'completed', 'held'].includes(job.state)) { prior.codes.forEach(c => processed.add(c)); if (['queued', 'running'].includes(job.state)) earlier.push({job, key}); }
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
      if (done && !['completed', 'held'].includes(done.state)) note({code: done.result?.code || 'GIGA_SEGMENT_FAILED', step: 'preparation'});
    }
    inflight = null;
  };
  for (let index = 0; index < segments.length; index++) {
    if (rs.stopRequested) {
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
          emit({excluded: rs.state.excluded + outcomes.filter(row => isExcludedRate(row.reason)).length});
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
          inflight = op === 'giga_prepare' ? null : {job, key};
          break;
        } catch (error) {
          const found = error.admitUnknown ? await readJob(requestId).catch(() => null) : null;
          if (found) {
            journal.seen(key, found);
            if (listId) local.addJob(listId, found.rootJobId || found.id);
            inflight = op === 'giga_prepare' ? null : {job: found, key};
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
      if (storageCode(error)) throw error;
      failed.push({codes: seg.codes, code, unknown: !!error.admitUnknown});
      note({code, step: 'segment', segment: index + 1, unknown: !!error.admitUnknown});
      emit({message: '第 ' + (index + 1) + ' 段没做成（' + code + '），先跳过，接着做下一段'});
    }
    const failedCodes = [...new Set(failed.flatMap(f => f.codes))];
    emit({done: rs.state.done + seg.codes.length, failed: failedCodes.length, failedCodes});
  }
  const failedCodes = [...new Set(failed.flatMap(f => f.codes))];
  const unknown = failed.some(f => f.unknown);
  emit({phase: 'done', failedCodes, unknown,
    message: !failedCodes.length ? '合格的 SKU 已全部上传到服务器，可以关掉软件；后续由服务器后台处理。'
      : '其余已交给服务器；' + failedCodes.length + ' 款没做成（' + [...new Set(failed.map(f => f.code))].join('、') + '）。' +
        (unknown ? '其中有的可能服务器已经收到，重试时会用原编号核对，不会重复。' : '可以点「重试没做成的」。')});
}

export {run};
