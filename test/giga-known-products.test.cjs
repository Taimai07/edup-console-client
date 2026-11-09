'use strict';
// 0.8.2: product IDs from verified receipts are remembered per site and handed to extension 0.4.4,
// which opens the product page directly (it still checks the exact SKU on the page).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {GigaBrowser} = require('../desktop/giga-browser.cjs');

function bridge({knownProducts = true} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edup-known-'));
  const now = 1_800_000_000;
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  write('connection.json', {connectedAt: now - 60, extensionProtocol: 4, accountScopeV2: false, knownProducts,
    inspection: {loggedIn: true, buyer: true, countryId: 223, countryCode: 'USA'}});
  write('heartbeat.json', {at: now});
  return {giga: new GigaBrowser({directory, now: () => now}), directory, write, now};
}
const finish = (b, task, items) => b.write(task.id + '.result.json', {at: b.now, id: task.id, result: {
  state: 'DETAIL_RATES_READ', taskId: task.id, countryId: 223, countryCode: 'USA', amazonSubmitted: false, items}});

test('verified rates are remembered and offered on the next read; unverified ones are not', () => {
  const b = bridge();
  const first = b.giga.start({site: 'US', codes: ['WA001', 'WB002', 'WC003']});
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.directory, 'request.json'))).known, undefined);
  finish(b, first, [
    {sku: 'WA001', productId: '501', state: 'RATE_LOW'},
    {sku: 'WB002', productId: '502', state: 'RATE_UNVERIFIED', reason: 'RATE_TIMEOUT'},
    {sku: 'WC003', productId: null, state: 'RATE_UNVERIFIED', reason: 'RESOLVE_FAILED'}]);
  assert.equal(b.giga.task(first.id).state, 'rates_read');
  const next = b.giga.start({site: 'US', codes: ['WA001', 'WB002', 'WD004']});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b.directory, 'request.json'))).known, {WA001: '501'});
  assert.equal(next.codes.length, 3);
});

test('store pages are remembered; an ID moving to another SKU replaces the old pairing', () => {
  const b = bridge();
  b.giga.remember('US', [{sku: 'WA001', productId: '501'}, {sku: 'WB002', productId: '502'}]);
  b.giga.remember('US', [{sku: 'WZ999', productId: '501'}]);
  assert.deepEqual(b.giga.knownFor('US', ['WA001', 'WB002', 'WZ999']), {WB002: '502', WZ999: '501'});
  assert.equal(b.giga.knownFor('DE', ['WB002']), null, 'per site');
  b.giga.remember('US', [{sku: 'bad sku', productId: '1'}, {sku: 'WC003', productId: 'x1'}]);
  assert.equal(b.giga.knownFor('US', ['WC003']), null, 'invalid rows ignored');
});

test('older extensions (no knownProducts) never receive the field', () => {
  const b = bridge({knownProducts: false});
  b.giga.remember('US', [{sku: 'WA001', productId: '501'}]);
  b.giga.start({site: 'US', codes: ['WA001']});
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.directory, 'request.json'))).known, undefined);
});

test('the file stays bounded', () => {
  const b = bridge();
  b.giga.remember('US', Array.from({length: 3100}, (_, i) => ({sku: 'W' + String(i).padStart(5, '0'), productId: String(1000 + i)})));
  const saved = JSON.parse(fs.readFileSync(path.join(b.directory, 'known-products-US.json')));
  assert.equal(Object.keys(saved.ids).length, 3000);
  assert.equal(saved.ids.W00000, undefined, 'oldest dropped');
  assert.ok(fs.statSync(path.join(b.directory, 'known-products-US.json')).size < 131072, 'readable by read()');
});
