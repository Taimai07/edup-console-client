'use strict';
// The runner keeps going on its own (11-09: a 2000+ code list stopped for good at the first browser
// hiccup, and every segment waited for the server before the browser started the next one).
// Source-level checks; the recovery paths are walked in the harness with injected failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'ui', 'listing-runner.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'ui', 'listing-app.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');

test('browser steps retry by themselves and wait for the page instead of stopping', () => {
  assert.match(runner, /const BROWSER_WAITS = \[60e3, 3 \* 60e3, 10 \* 60e3\]/);
  assert.match(runner, /if \(CONNECTION\.includes\(code\)\) \{ await waitForBrowser\(site, codes\.length\); continue; \}/);
  assert.match(runner, /GIGA_BROWSER_TASK_REQUIRES_RECONCILIATION[\s\S]*reconcileGigaFavorites\(undefined/);
  assert.match(runner, /setTimeout\(\(\) => resolve\('check'\), 10000\)/, 'reconnecting resumes without a click');
  assert.doesNotMatch(runner, /function needUser/);
});

test('admission retries unknown outcomes with the same request id and checks before giving up', () => {
  assert.match(runner, /if \(!\(unknown \|\| TRANSIENT\.test\(text\)\)/);
  assert.match(runner, /const found = error\.admitUnknown \? await readJob\(requestId\)/);
  assert.match(runner, /if \(codeOf\(error\) === 'JOB_NOT_FOUND'\) return null;/);
});

test('a failed segment is set aside and the rest continue; leftovers can be retried', () => {
  assert.match(runner, /failed\.push\(\{codes: seg\.codes, code, unknown: !!error\.admitUnknown\}\)/);
  assert.doesNotMatch(runner, /throw Error\(done\.result\?\.code \|\| 'GIGA_SEGMENT_FAILED'\)/);
  assert.match(runner, /write\(KEY\.run, \{\.\.\.state\.task, codes: state\.failedCodes/);
  assert.match(app, /'重试没做成的 ' \+ leftovers\.length \+ ' 款'/);
});

test('the browser works ahead while the server prepares one segment at a time', () => {
  assert.match(runner, /if \(inflight \|\| earlier\.length\) await settle\(update\);/);
  const loop = runner.slice(runner.indexOf('for (let index = 0; index < segments.length; index++)'));
  assert.ok(loop.indexOf('screenSegment(') < loop.indexOf('await settle('), 'screen first, then wait for the previous job');
});

test('runner problems reach the diagnostics upload through an allow-listed event', () => {
  assert.match(main, /if\(action==='listing-event'\)\{const code=typeof arg\?\.code==='string'&&\/\^\[A-Z\]\[A-Z0-9_\]\{2,79\}\$\/\.test\(arg\.code\)/);
  assert.match(main, /logger\.write\('listing_runner_problem',\{level:'error'/);
});

test('0.8.7: a segment the server holds for the operator counts as uploaded and is never resent', () => {
  assert.match(runner, /if \(\['completed', 'held'\]\.includes\(prior\.state\)\)/);
  assert.match(runner, /\['queued', 'running', 'completed', 'held'\]\.includes\(job\.state\)/);
  assert.match(runner, /if \(done && !\['completed', 'held'\]\.includes\(done\.state\)\) note\(/);
  assert.match(app, /if \(c\.jobId\) return 'uploaded';/);
});
