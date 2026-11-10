'use strict';
// 0.8.2: GIGA started asking for a slider puzzle after a 2000+ list (11-09). The runner keeps
// 大健 page reads within an allowance and pauses for the operator when GIGA asks for verification.
const assert = require('node:assert/strict');
const test = require('node:test');

const timers = global.setTimeout;
let clockMs = new Date(2026, 10, 10, 10, 0, 0).getTime();
Date.now = () => clockMs;
// Simulated time: every wait advances the clock immediately.
global.setTimeout = (callback, delay = 0, ...args) => { clockMs += Math.max(0, delay); return timers(callback, 0, ...args); };

const data = new Map();
global.localStorage = {getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k)};
const notices = [];
global.Notification = function (title, options) { notices.push([title, options.body]); };

const codes = Array.from({length: 60}, (_, i) => 'W' + String(20000 + i) + 'P1');
const starts = [], events = [];
let verifyOnce = true;
global.window = {edup: {
  maintenance: async (action, args) => {
    if (action === 'giga-browser-reuse') return {receipts: [], missing: args.codes};
    if (action === 'giga-browser-status') return {connected: true, extensionProtocol: 4, accountScopeV2: true,
      inspection: {loggedIn: true, buyer: true, countryCode: 'USA'}};
    if (action === 'giga-browser-start') { starts.push({codes: args.codes, at: clockMs}); return {id: 'task-' + starts.length, codes: args.codes}; }
    if (action === 'giga-browser-task') {
      const last = starts[starts.length - 1];
      if (verifyOnce && starts.length === 2) { verifyOnce = false; return {id: args.id, state: 'stopped', code: 'GIGA_VERIFICATION_REQUIRED'}; }
      return {id: args.id, state: 'verified', site: 'US', codes: last.codes, items: last.codes.map(sku => ({sku})), screenId: 's', excluded: []};
    }
    if (action === 'listing-event') { events.push(args); return {}; }
    throw Error('UNEXPECTED ' + action);
  },
  ai: async (op, args) => {
    if (op === 'giga_prepare') return {id: args.requestId, rootJobId: args.requestId, state: 'queued'};
    if (op === 'giga_job') return {id: args.id, state: 'completed'};
    throw Error('UNEXPECTED_AI ' + op);
  },
}};

const settle = async (runner, phases, limit = 4000) => {
  for (let i = 0; i < limit; i++) {
    if (phases.includes(runner.state.phase)) return runner.state;
    if (runner.state.phase === 'error') throw Error(JSON.stringify(runner.state));
    await new Promise(r => timers(r, 1));
  }
  throw Error('STUCK ' + JSON.stringify(runner.state));
};

test('usage.wait: rest between segments, hourly and daily allowance', async () => {
  const {usage, PACE_DEFAULTS} = await import('../ui/listing-runner.js');
  const p = {...PACE_DEFAULTS, restMinutes:5, hourly:90, daily:450};
  const t0 = new Date(2026, 10, 9, 10, 0, 0).getTime();
  data.delete('edup:listing:giga-usage:v1');
  assert.equal(usage.wait('US', 30, t0, p).ms, 0, 'first segment goes at once');
  usage.record('US', 30, t0);
  assert.deepEqual([usage.wait('US', 30, t0 + 60e3, p).why, usage.wait('US', 30, t0 + 60e3, p).ms], ['rest', 4 * 60e3]);
  assert.equal(usage.wait('DE', 30, t0 + 60e3, p).ms, 0, 'other site has its own allowance');
  usage.record('US', 30, t0 + 5 * 60e3); usage.record('US', 30, t0 + 10 * 60e3);
  const hourly = usage.wait('US', 30, t0 + 15 * 60e3, p);
  assert.equal(hourly.why, 'hourly');
  assert.equal(hourly.ms, 45 * 60e3, 'the oldest 30 drop out of the hour at 11:00');
  for (let i = 0; i < 12; i++) usage.record('US', 30, t0 + 60 * 60e3 * (1 + i / 4));
  const daily = usage.wait('US', 30, t0 + 5 * 3600e3, p);
  assert.equal(daily.why, 'daily');
  assert.equal(new Date(t0 + 5 * 3600e3 + daily.ms).getHours(), 9);
  assert.equal(new Date(t0 + 5 * 3600e3 + daily.ms).getDate(), 10);
  data.set('edup:listing:pace:v2', JSON.stringify({daily: 2000, hourly: 0, restMinutes: 0}));
  const {pace} = await import('../ui/listing-runner.js');
  assert.deepEqual([pace().daily, pace().hourly, pace().restMinutes], [2000, 0, 0], 'operator override without a release');
  data.delete('edup:listing:pace:v2');
  data.delete('edup:listing:giga-usage:v1');
});

test('run: segments are spaced, verification pauses with a desktop notice until 继续', async () => {
  const {runner} = await import('../ui/listing-runner.js');
  data.set('edup:listing:pace:v2', JSON.stringify({restMinutes:5,hourly:90,daily:450}));
  runner.start({kind: 'prepare', site: 'US', codes, listId: null});
  const need = await settle(runner, ['need', 'done']);
  assert.equal(need.phase, 'need');
  assert.equal(need.need, 'verify');
  assert.match(need.message, /人工验证/);
  assert.equal(notices.length, 1);
  assert.ok(events.some(e => e.code === 'GIGA_VERIFICATION_REQUIRED' && e.step === 'verification'));
  const startsBefore = starts.length;
  for (let i = 0; i < 50; i++) await new Promise(r => timers(r, 1));
  assert.equal(starts.length, startsBefore, 'no automatic retries while GIGA asks for verification');
  runner.continue();
  const done = await settle(runner, ['done']);
  assert.equal(done.failedCodes.length, 0);
  assert.equal(starts.length, 3, 'segment 1, segment 2 (verification), segment 2 again');
  assert.ok(starts[1].at - starts[0].at >= 5 * 60e3, 'rest between browser segments');
});
