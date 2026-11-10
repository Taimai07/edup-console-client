const test = require('node:test');
const assert = require('node:assert/strict');
const {GigaBrowser} = require('../desktop/giga-browser.cjs');
const id = '11111111-2222-4333-8444-555555555555';

function fixture(op = 'read_rates', expiresAt = 2500, connectedAt = 900) {
  const task = {id, op, expiresAt, site: 'US', skus: ['WA001']};
  const files = new Map([
    ['request.json', task], [id + '.client-task.json', task],
    [id + '.dispatch.json', {...task, at: 1000}], ['connection.json', {connectedAt}],
  ]);
  const bridge = new GigaBrowser({now: () => 2000});
  bridge.read = name => files.get(name) || null;
  bridge.write = (name, value) => files.set(name, value);
  return {bridge, files, task};
}

test('expired reads without receipts stop waiting', () => {
  assert.equal(fixture('read_rates', 1900).bridge.task(id).code, 'TASK_EXPIRED');
});
test('a newer connection identifies an interrupted read', () => {
  const {bridge, files} = fixture('read_rates', 2500, 1100);
  assert.equal(bridge.task(id).code, 'GIGA_BROWSER_READ_INTERRUPTED');
  const next = bridge.issueTask({op: 'read_rates', site: 'US', skus: ['WA001']});
  assert.notEqual(next.id, id);
  assert.ok(files.has(id + '.dispatch.json'));
  assert.equal(files.has(id + '.result.json'), false);
});
test('a still-connected pending read cannot be dispatched twice', () => {
  assert.throws(() => fixture().bridge.issueTask({op: 'read_rates'}), /REQUIRES_RECONCILIATION/);
});
test('interrupted favorite writes remain protected from retry', () => {
  const {bridge} = fixture('favorites', 1900, 1100);
  assert.equal(bridge.task(id).state, 'running_in_browser');
  assert.throws(() => bridge.issueTask({op: 'favorites'}), /REQUIRES_RECONCILIATION/);
});
test('the client exposes validated task progress and elapsed time', () => {
  const {bridge, files} = fixture();
  const progress = {stage: 'detail', index: 1, total: 1};
  files.set(id + '.progress.json', {id, progress});
  assert.deepEqual(bridge.task(id).progress, progress);
  assert.equal(bridge.task(id).elapsedSeconds, 1000);
});
test('a valid read arriving after execution expiry is accepted for three days', () => {
  const {bridge, files} = fixture('read_rates', 1900);
  const result = {state: 'DETAIL_RATES_READ', taskId: id, countryId: 223, countryCode: 'USA',
    amazonSubmitted: false, items: [{sku: 'WA001', productId: '501', state: 'RATE_LOW'}]};
  files.set(id + '.result.json', {at: 1950, result});
  assert.equal(bridge.task(id).state, 'rates_read');
  bridge.now = () => 1950 + 3 * 24 * 60 * 60;
  assert.equal(bridge.task(id).state, 'rates_read');
  bridge.now = () => 1950 + 3 * 24 * 60 * 60 + 1;
  assert.equal(bridge.task(id).code, 'GIGA_READ_RECEIPT_EXPIRED');
});
test('three-day acceptance still rejects wrong product scope', () => {
  const {bridge, files} = fixture('read_rates', 1900);
  files.set(id + '.result.json', {at: 1950, result: {state: 'DETAIL_RATES_READ', taskId: id,
    countryId: 223, countryCode: 'USA', amazonSubmitted: false,
    items: [{sku: 'OTHER', productId: '501', state: 'RATE_LOW'}]}});
  assert.throws(() => bridge.task(id), /GIGA_BROWSER_RECEIPT_SCOPE_MISMATCH/);
});
test('client records decisions without rewriting unchanged polling state', () => {
  const {bridge,files}=fixture();
  bridge.task(id);
  const first=files.get(id+'.client-status.json');
  assert.equal(first.state,'running_in_browser');
  bridge.now=()=>2010;
  bridge.task(id);
  assert.equal(files.get(id+'.client-status.json').at,first.at);
  bridge.now=()=>2600;
  bridge.task(id);
  assert.equal(files.get(id+'.client-status.json').code,'TASK_EXPIRED');
  assert.equal(files.get(id+'.client-status.json').receiptAt,null);
});
