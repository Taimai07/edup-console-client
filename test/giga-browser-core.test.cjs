const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {run, SKUS} = require('./giga-browser-core.cjs');

function fixture(options = {}) {
  const favorites = new Set(options.saved || []), writes = [], checkpoints = new Map();
  let reads = 0;
  const idFor = sku => String(SKUS.indexOf(sku) + 101);
  const makeRow = id => ({product: {id, sku: SKUS[Number(id) - 101]}, other: {is_in_my_wishlist: favorites.has(String(id))}});
  const dependencies = {
    state: async () => {
      reads++;
      return {is_logged: true, is_buyer: true, country_id: 81, country_code: 'DEU',
        customer_id: options.switchAt && reads >= options.switchAt ? 'different-buyer' : 'buyer-fixture',
        ...options.state};
    },
    hash: async text => crypto.createHash('sha256').update(text).digest('hex'),
    load: async scope => checkpoints.get(scope) || null,
    save: async (scope, value) => {
      if (options.failSave) throw Error('CHECKPOINT_SAVE_FAILED');
      checkpoints.set(scope, structuredClone(value));
    },
    post: async (route, body) => {
      if (route === 'product/list/search') return {code: 200, data: {product_list: [idFor(body.search)]}};
      if (route === 'product/list/list') {
        const rows = body.product_ids.map(id => makeRow(String(id)));
        if (options.badSku && rows[0].product.sku === options.badSku) rows[0].product.sku = 'WRONG_SKU';
        if (options.unknownWish) delete rows[0].other.is_in_my_wishlist;
        return {code: 200, data: rows};
      }
      assert.equal(route, 'account/wishlist/addProductsToWish');
      const ledger = [...checkpoints.values()][0];
      const item = Object.values(ledger.items).find(item => item.productId === body.product_ids);
      assert.equal(item.state, 'STARTED', 'receipt must exist before write');
      writes.push(body);
      if (!options.noEffect) favorites.add(body.product_ids);
      if (options.timeout) throw Error('simulated transport interruption');
      return {code: 200, data: {add_product_num: 1}};
    }
  };
  return {dependencies, writes, favorites, checkpoints};
}

test('10 exact products are resolved, added once and read back; repeat sends no additional writes', async () => {
  const f = fixture();
  assert.equal((await run(f.dependencies)).state, 'ALL_SAVED_VERIFIED');
  assert.equal(f.writes.length, SKUS.length);
  assert.equal(f.favorites.size, SKUS.length);
  assert.equal((await run(f.dependencies)).state, 'ALL_SAVED_VERIFIED');
  assert.equal(f.writes.length, SKUS.length);
});
test('already saved products are preserved', async () => {
  const f = fixture({saved: ['101', '102']});
  const result = await run(f.dependencies);
  assert.equal(f.writes.length, SKUS.length-2);
  assert.equal(result.items[0].state, 'ALREADY_SAVED_OR_RECONCILED');
});
test('US login cannot change any German favorites', async () => {
  const f = fixture({state: {country_id: 223, country_code: 'USA'}});
  await assert.rejects(run(f.dependencies), /REGION_SESSION_MISMATCH/);
  assert.equal(f.writes.length, 0);
});
test('logged out and seller sessions are blocked', async () => {
  for (const state of [{is_logged: false}, {is_buyer: false}]) {
    const f = fixture({state});
    await assert.rejects(run(f.dependencies), /LOGIN_REQUIRED|BUYER_NOT_VERIFIED/);
    assert.equal(f.writes.length, 0);
  }
});
test('a wrong SKU anywhere prevents the first favorite write', async () => {
  const f = fixture({badSku: SKUS[SKUS.length-1]});
  await assert.rejects(run(f.dependencies), /EXACT_SKU_NOT_UNIQUE_OR_NOT_FOUND/);
  assert.equal(f.writes.length, 0);
});
test('unknown wishlist status blocks rather than guesses', async () => {
  const f = fixture({unknownWish: true});
  await assert.rejects(run(f.dependencies), /WISHLIST_STATE_NOT_VERIFIED/);
  assert.equal(f.writes.length, 0);
});
test('storage failure sends no favorite request', async () => {
  const f = fixture({failSave: true});
  await assert.rejects(run(f.dependencies), /CHECKPOINT_SAVE_FAILED/);
  assert.equal(f.writes.length, 0);
});
test('transport timeout after successful add is reconciled by readback', async () => {
  const f = fixture({timeout: true});
  const result = await run(f.dependencies);
  assert.equal(result.items[0].state, 'RECONCILED_SAVED');
  assert.equal(f.writes.length, SKUS.length);
});
test('unverified outcome is retained; second execution does not resend', async () => {
  const f = fixture({timeout: true, noEffect: true});
  await assert.rejects(run(f.dependencies), /FAVORITE_NOT_VERIFIED_DO_NOT_RESEND/);
  assert.equal(f.writes.length, 1);
  await assert.rejects(run(f.dependencies), /PREVIOUS_ATTEMPT_REQUIRES_RECONCILIATION/);
  assert.equal(f.writes.length, 1);
});
test('account changing during lookups blocks favorite writes', async () => {
  const f = fixture({switchAt: 4});
  await assert.rejects(run(f.dependencies), /BROWSER_ACCOUNT_CHANGED/);
  assert.equal(f.writes.length, 0);
});
test('an independently removed verified favorite is not silently re-added', async () => {
  const f = fixture();
  await run(f.dependencies);
  f.favorites.delete('101');
  await assert.rejects(run(f.dependencies), /PREVIOUS_ATTEMPT_REQUIRES_RECONCILIATION/);
  assert.equal(f.writes.length, SKUS.length);
});
