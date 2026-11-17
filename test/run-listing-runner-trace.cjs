// node test/run-listing-runner-trace.cjs            compare a fresh run with test/listing-runner-trace.golden.json
// node test/run-listing-runner-trace.cjs --record   (re)write the golden file; only on code whose behaviour is the reference
// EDUP_CLIENT_DIR=<other client dir> runs the same scenarios against another copy of client/ (used to record on the pre-split code)
// Drives ui/listing/listing-runner.js (the runner object) through fixed scenarios against a fake 大健 extension and a fake
// server, with a fake clock, and records every state the runner emits plus every call it makes.
const fs = require('node:fs'), path = require('node:path'), {pathToFileURL} = require('node:url');
const client = path.resolve(process.env.EDUP_CLIENT_DIR || path.join(__dirname, '..'));
const golden = path.join(__dirname, 'listing-runner-trace.golden.json'), record = process.argv.includes('--record');

const realSetTimeout = global.setTimeout;
const base = 1700000000000;
let elapsed = 0;
Date.now = () => base + elapsed;
global.setTimeout = (callback, delay, ...args) => { elapsed += Number(delay) || 0; return realSetTimeout(callback, 0, ...args); };
const data = new Map();
global.localStorage = {getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k)};
data.set('edup:listing:pace:v2', JSON.stringify({restMinutes: 0, hourly: 0, daily: 0}));

const log = [];
const F = {};
const receipt = (codes, extra = {}) => ({id: 'br', site: 'US', codes, items: codes.map(sku => ({sku})), screenId: 'sc', excluded: [], ...extra});
let current = [], jobSeq = 0, aiCalls = 0;
const jobs = new Map();
global.window = {edup: {
  maintenance: async (op, args) => {
    log.push(['M:' + op, args && args.codes ? args.codes.length : args && args.id || null]);
    if (op === 'listing-event') return {};
    if (op === 'giga-browser-reuse') return {receipts: F.reuse || [], missing: F.reuse ? [] : args.codes};
    if (op === 'giga-browser-status') {
      if (F.statusDown > 0) { F.statusDown--; return {connected: false}; }
      return {connected: true, extensionProtocol: 4, accountScopeV2: !!F.v2, inspection: {loggedIn: true, buyer: true, countryCode: 'USA'}};
    }
    if (op === 'giga-browser-start') {
      if (F.startErrors && F.startErrors.length) throw Error(F.startErrors.shift());
      current = args.codes; return {id: 'T' + (++jobSeq)};
    }
    if (op === 'giga-browser-task') {
      const excluded = F.excludeFirst ? [{sku: current[0], reason: 'RECONCILIATION_PENDING', rate: 'high'}] : [];
      return receipt(current.filter(c => !excluded.some(e => e.sku === c)), {state: 'verified', excluded});
    }
    if (op === 'giga-browser-reconcile') return {excluded: []};
    throw Error('UNEXPECTED_M_' + op);
  },
  ai: async (op, args) => {
    log.push(['AI:' + op, args.codes ? args.codes.length : args.id || null, args.requestId ? 'rid' : '']);
    aiCalls++;
    if (op === 'giga_prepare' || op === 'giga_query') {
      if (F.aiErrors && F.aiErrors.length) { const e = F.aiErrors.shift(); throw Object.assign(Error(e.message), e.extra || {}); }
      const id = args.requestId, job = {id, rootJobId: id, state: F.jobState || 'completed', codes: args.codes};
      jobs.set(id, job); return job;
    }
    if (op === 'giga_job') {
      if (jobs.has(args.id)) { const j = jobs.get(args.id); return F.jobPolls > 0 && F.jobPolls-- ? {...j, state: 'running'} : j; }
      throw Error('JOB_NOT_FOUND');
    }
    throw Error('UNEXPECTED_AI_' + op);
  },
}};
global.Notification = undefined;
const realSet = global.localStorage.setItem;
global.localStorage.setItem = (k, v) => { if (F.lsFail && k === 'edup:listing:run:v1') throw Error('QUOTA_FAKE'); return realSet(k, v); };

const codes = n => Array.from({length: n}, (_, i) => 'W' + String(20000 + i) + 'P100001');
const sleep = ms => new Promise(r => realSetTimeout(r, ms));
const until = async (cond, n = 600) => { for (let i = 0; i < n; i++) { if (cond()) return true; await sleep(2); } return false; };

(async () => {
  const mod = await import(pathToFileURL(path.join(client, 'ui', 'listing', 'listing-runner.js')).href);
  const {runner, local} = mod;
  const trace = [], seen = [];
  let scenario = '';
  const scrub = s => JSON.parse(JSON.stringify(s, (k, v) => k === 'at' ? '<AT>' : v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>'));
  runner.subscribe(s => { if (F.stopAt && s.phase === 'running' && s.segment === F.stopAt) { F.stopAt = 0; runner.stop(); } seen.push(scrub({phase: s.phase, need: s.need, message: s.message, segment: s.segment, segments: s.segments, done: s.done,
    total: s.total, excluded: s.excluded, failed: s.failed, failedCodes: s.failedCodes && s.failedCodes.length, queue: s.queue, unknown: s.unknown,
    reconcileId: s.reconcileId, admission: s.admission && 'adm', left: s.left && s.left.length, error: s.error, stopping: s.stopping, recovered: s.recovered, lastJobId: s.lastJobId && 'job'})); });
  const finish = async name => {
    await sleep(20);
    trace.push({name, states: seen.splice(0), calls: log.splice(0).map(c => scrub(c.join('|'))),
      storage: [...data.keys()].sort().map(k => k + '=' + scrub(data.get(k)).toString().length)});
  };
  const settleIdle = async () => { await until(() => !['running', 'need', 'queued'].includes(runner.state.phase)); };
  const reset = () => { for (const k of [...data.keys()]) if (k !== 'edup:listing:pace:v2') data.delete(k); jobs.clear(); Object.keys(F).forEach(k => delete F[k]); runner.dismiss(); runner.forgetInterrupted(); };
  const auto = async (cond) => { // answer waiting prompts
    for (let i = 0; i < 400; i++) { if (cond()) return; if (runner.state.phase === 'need') runner.continue(); await sleep(2); }
  };

  // 1 happy path, 45 codes -> 3 segments of 20/20/5
  reset(); runner.start({kind: 'prepare', site: 'US', codes: codes(45), listId: 'L1'}); await settleIdle(); await finish('prepare 45 codes');
  // 2 the same list again: everything already in the segment journal
  runner.dismiss(); runner.start({kind: 'prepare', site: 'US', codes: codes(45), listId: 'L1'}); await settleIdle(); await finish('prepare again (journal)');
  // 3 v2 account scope -> 30 per segment
  reset(); F.v2 = true; runner.start({kind: 'prepare', site: 'US', codes: codes(65)}); await settleIdle(); await finish('prepare 65 codes, v2 scope');
  // 4 browser not connected twice, then ok
  reset(); F.statusDown = 2; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await auto(() => !['running', 'need', 'queued'].includes(runner.state.phase)); await finish('browser down then up');
  // 5 human verification once
  reset(); F.startErrors = ['GIGA_VERIFICATION_REQUIRED']; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await auto(() => !['running', 'need', 'queued'].includes(runner.state.phase)); await finish('verification once');
  // 6 detail review then cancel
  reset(); F.startErrors = ['GIGA_DETAIL_REVIEW_REQUIRED']; runner.start({kind: 'prepare', site: 'US', codes: codes(6)});
  await until(() => runner.state.phase === 'need'); runner.cancel(); await settleIdle(); await finish('detail review then cancel');
  // 7 browser step fails twice (retry waits), then works
  reset(); F.startErrors = ['GIGA_X_FAILED', 'GIGA_X_FAILED']; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await settleIdle(); await finish('browser step retries');
  // 8 admission transient error, retried with the same id
  reset(); F.aiErrors = [{message: 'AI_SERVICE_TIMEOUT'}, {message: 'GIGA_QUERY_RATE_LIMIT'}]; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await settleIdle(); await finish('admission transient');
  // 9 admission fails for good in segment 1, segment 2 goes on
  reset(); F.aiErrors = [{message: 'GIGA_BAD_REQUEST'}]; runner.start({kind: 'prepare', site: 'US', codes: codes(25), listId: 'L2'}); await settleIdle(); await finish('admission fails one segment');
  // 10 retry the leftovers with the failed codes
  { const st = runner.state; runner.dismiss(); runner.start({...st.task, codes: st.failedCodes, fresh: true}); await settleIdle(); await finish('retry leftovers'); }
  // 11 outcome unknown on admission
  reset(); F.aiErrors = [{message: 'AI_SERVICE_TIMEOUT OUTCOME_UNKNOWN', extra: {outcome: 'unknown'}}]; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await settleIdle(); await finish('admission unknown outcome');
  // 12 screen required -> re-screen once
  reset(); F.aiErrors = [{message: 'GIGA_RETURN_SCREEN_REQUIRED'}]; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await settleIdle(); await finish('screen required once');
  // 13 query kind with server polling
  reset(); F.jobPolls = 2; runner.start({kind: 'query', site: 'US', codes: codes(25), label: 'Q'}); await settleIdle(); await finish('query 25 codes');
  // 14 reconciliation pending favorites
  reset(); F.excludeFirst = true; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await settleIdle(); const rid = runner.state.reconcileId; await finish('reconciliation pending');
  try { const r = await runner.reconcile(rid || 'x'); trace.push({name: 'reconcile call', result: scrub(r)}); } catch (e) { trace.push({name: 'reconcile call', error: String(e.message).slice(0, 60)}); }
  await finish('after reconcile');
  // 15 stop after the first segment, then resume
  reset(); F.stopAt = 1; runner.start({kind: 'prepare', site: 'US', codes: codes(45), listId: 'L3'});
  await settleIdle(); const stopped = runner.state.phase; await finish('stop requested ' + stopped);
  trace.push({name: 'interrupted/savedQueue', interrupted: !!runner.interrupted(), saved: runner.savedQueue().length});
  runner.resumeSaved(); await settleIdle(); await finish('resume saved');
  // 16 queue with two groups, duplicate group ignored, then error discards
  reset(); runner.start({kind: 'prepare', site: 'US', codes: codes(6), listId: 'L4', groupId: 'g1'}); runner.start({kind: 'prepare', site: 'US', codes: codes(6), listId: 'L4', groupId: 'g1'});
  runner.start({kind: 'prepare', site: 'US', codes: codes(6).reverse(), listId: 'L4', groupId: 'g2'}); await settleIdle(); await finish('two groups');
  // 17 queue refused until resumed; discardPending
  reset(); data.set('edup:listing:queue:v1', JSON.stringify([{kind: 'prepare', site: 'US', codes: codes(3)}]));
  try { runner.start({kind: 'prepare', site: 'US', codes: codes(3)}); trace.push({name: 'start with saved queue', ok: true}); } catch (e) { trace.push({name: 'start with saved queue', error: e.message}); }
  runner.discardPending(); trace.push({name: 'after discard', saved: runner.savedQueue().length, phase: runner.state.phase});
  // 18 fatal error path
  reset(); F.lsFail = true; runner.start({kind: 'prepare', site: 'US', codes: codes(6)}); await settleIdle(); await finish('storage fails -> error');
  F.lsFail = false;
  // 19 no desktop
  { const keep = global.window.edup.maintenance; global.window.edup.maintenance = undefined; try { runner.start({kind: 'prepare', site: 'US', codes: codes(2)}); trace.push({name: 'no desktop', ok: true}); } catch (e) { trace.push({name: 'no desktop', error: e.message}); } global.window.edup.maintenance = keep; }
  // 20 empty codes is ignored
  runner.start({kind: 'prepare', site: 'US', codes: []}); trace.push({name: 'empty start', phase: runner.state.phase});
  trace.push({name: 'busy/api', busy: runner.busy(), phase: runner.state.phase, local: Object.keys(local).sort().length, keys: Object.keys(mod).sort()});

  const text = JSON.stringify({steps: trace.length, trace}, null, 1);
  if (record) { fs.writeFileSync(golden, text); console.log('recorded ' + trace.length + ' steps'); process.exit(0); }
  if (process.env.EDUP_DUMP) { fs.writeFileSync(process.env.EDUP_DUMP, text); process.exit(0); }
  if (fs.readFileSync(golden, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('LISTING_RUNNER_TRACE_DIFFERENT: the runner no longer behaves as recorded in test/listing-runner-trace.golden.json');
  console.log(JSON.stringify({passed: true, steps: trace.length}));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
