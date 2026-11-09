'use strict';
// The answer form must report the save and the AI review as two results, follow its own run,
// and never treat "no active run" as "the AI found nothing" (11-09: 16 failed reviews were shown
// as "AI 没有生成要保存的资料"). Source-level checks; the DOM flow is walked in the harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'listing-sheets.js'), 'utf8');
const form = source.slice(source.indexOf('export function openQuestions'), source.indexOf('// Product drawer:'));
const app = fs.readFileSync(path.join(__dirname, '..', 'ui', 'listing-app.js'), 'utf8');
const lists = fs.readFileSync(path.join(__dirname, '..', 'ui', 'giga-lists.js'), 'utf8');

test('the review follows its own run id and reports failed runs', () => {
  assert.match(form, /call\('run_read', \{id: current\.run\.id\}\)/);
  assert.match(source, /const RUN_END = \['completed', 'failed', 'cancelled', 'interrupted'\]/);
  assert.match(form, /run\.state !== 'completed'/);
  assert.doesNotMatch(form, /!chat\.activeRun/);
  assert.match(source, /MODEL_HTTP_400: 'AI 服务的配置出错了，不是你的回答有问题。'/);
});

test('saving and reviewing are separate, and retries never save twice or start a second review', () => {
  assert.match(form, /回答已保存到服务器/);
  assert.ok(form.indexOf("call('batch_material_save'") < form.indexOf('await startReview('), 'save first, then review');
  // RUN_BUSY and unknown outcomes keep the same request id; a definite failure clears it.
  assert.match(form, /if \(!review\) review = \{requestId: crypto\.randomUUID\(\)/);
  assert.match(form, /isBusy\(error\)/);
  assert.match(form, /'再试一次'/);
  assert.match(form, /reviewing = true/);
});

test('answers saved earlier can be reviewed without retyping', () => {
  assert.match(form, /call\('batch_material_list', \{jobId: c\.rootJobId, sku: c\.sku\}\)/);
  assert.match(form, /把已保存的回答交给 AI 核对/);
  assert.match(form, /\.filter\(Boolean\)\)/, 'no null children in replaceChildren');
});

test('a list remembers whether the server has its backup', () => {
  assert.match(lists, /export function backupSkuList\(call, \{id = crypto\.randomUUID\(\)/);
  assert.match(lists, /onState\?\.\(record\.state, record\.error\)/);
  assert.match(app, /local\.setBackup\(list\.id, state === 'saved'/);
  assert.match(app, /这份清单还没备份到服务器/);
});
