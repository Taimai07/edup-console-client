const assert = require('node:assert/strict');
const test = require('node:test');
const {validateAIRequest, SKU_LIST_READONLY} = require('../shared/ai-contract.cjs');
const {GigaBrowser} = require('../desktop/giga-browser.cjs');

test('K1 permits the three SKU list operations with the declared read-only subset', () => {
  assert.deepEqual(SKU_LIST_READONLY, ['sku_list_status', 'sku_list_index']);
  for (const op of ['sku_list_save', ...SKU_LIST_READONLY]) {
    assert.equal(validateAIRequest(op, {}).op, op);
  }
  assert.throws(() => validateAIRequest('sku_list_delete', {}), /AI_REQUEST_INVALID/);
});

test('a partial favorites receipt can retry only unresolved products, as a readback', () => {
  const id = '4f80fc1d-3e70-43c3-bc34-5aeae63cf0c6';
  const prior = {id, op: 'favorites', site: 'US', skus: ['W1P234', 'W2P345'],
    approved: {W1P234: 'p1', W2P345: 'p2'}, screenId: 'screen', buyerSalt: 'b'.repeat(64),
    expectedBuyerHash: 'a'.repeat(64)};
  const receipt = {taskId: id, state: 'APPROVED_FAVORITES_VERIFIED', countryId: 223, countryCode: 'USA',
    amazonSubmitted: false, buyerHash: prior.expectedBuyerHash, items: [
      {sku: 'W1P234', productId: 'p1', state: 'DETAIL_LOW_ALREADY_SAVED'},
      {sku: 'W2P345', productId: 'p2', state: 'FAVORITE_UNVERIFIED', reason: 'RECONCILIATION_PENDING'},
    ]};
  const browser = Object.create(GigaBrowser.prototype);
  browser.read = name => ({
    [id + '.client-task.json']: prior, [id + '.dispatch.json']: {},
    [id + '.result.json']: {result: receipt},
  })[name];
  browser.requireConnection = () => ({accountScopeV2: true});
  browser.issueTask = (fields, scope) => {
    assert.deepEqual(fields.skus, ['W2P345']);
    assert.deepEqual(fields.approved, {W2P345: 'p2'});
    assert.equal(fields.reconcileOnly, true);
    assert.equal(fields.expectedBuyerHash, prior.expectedBuyerHash);
    assert.deepEqual(scope, {screenId: 'screen', reconciles: id});
    return {...fields, id: 'next'};
  };
  assert.equal(browser.reconcileFavorites(id).id, 'next');
  browser.requireConnection = () => ({accountScopeV2: false});
  assert.throws(() => browser.reconcileFavorites(id), /GIGA_BUYER_SCOPE_REQUIRED/);
});
