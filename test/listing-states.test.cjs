// The listing workspace shows one stage, one owner and one next action per product.
// Fixture shapes follow native-continuation.cjs and the live giga_job records.
const {test} = require('node:test'), assert = require('node:assert/strict');
const load = () => import('../ui/listing-states.js');

test('an admitted recheck refreshes a cached completed batch, even during a read', async () => {
  const {createStore} = await import('../ui/listing-store.js');
  let calls = 0, finish;
  const store = createStore({isOffline: () => false, getSnapshot: () => ({}),
    call: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({id: 'job-1', state: 'running'})});
  const reading = store.refreshJobs(['job-1']);
  store.invalidateJob('job-1');
  finish({id: 'job-1', state: 'completed'});
  await reading;
  await store.refreshJobs(['job-1']);
  assert.equal(calls, 2);
  assert.equal(store.job('job-1').state, 'running');
});

const job = (items, extra = {}) => ({id: 'job-1', rootJobId: 'job-1', state: 'completed', preparationMode: 'ai_workflow', created: 100,
  codes: items.map(x => x.sku), result: {products: items.map(x => ({code: x.sku, name: 'N ' + x.sku})), pipeline: {items}}, ...extra});

test('preparation records map to one owner and one action', async () => {
  const {jobCards} = await load();
  const cards = new Map(jobCards(job([
    {sku: 'WTEST1', state: 'NEEDS_SOURCE_REVIEW', reason: 'REQUIRED_FACTS_NEED_REVIEW',
      attention: [{field: 'country_of_origin', reason: 'Country of origin not supplied.'}, {field: 'fabric_type', reason: 'Fabric type not confirmed.'}]},
    {sku: 'WTEST2', state: 'PREPARATION_EXCEPTION', reason: 'PLANNER_REQUEST_REJECTED', failure: {details: {reason: 'plan_usage_paused', upstreamDispatched: false}}},
    {sku: 'WTEST3', state: 'ALREADY_SUBMITTED'},
    {sku: 'WTEST4', state: 'PREVIEW_VALID'},
    {sku: 'WTEST5', state: 'COLOR_FAMILY_REVIEW_REQUIRED'},
    {sku: 'WTEST6', state: 'EXCEPTION', reason: 'PLANNER_CONTRACT_INVALID'},
  ]), {site: 'US'}).map(c => [c.sku, c]));
  assert.deepEqual([cards.get('WTEST1').owner, cards.get('WTEST1').primary, cards.get('WTEST1').headline], ['you', 'answer_questions', '要你回答 1 个问题']);
  assert.deepEqual([cards.get('WTEST2').owner, cards.get('WTEST2').primary], ['you', 'recheck']);
  assert.match(cards.get('WTEST2').headline, /模型服务暂停/);
  assert.deepEqual([cards.get('WTEST3').stage, cards.get('WTEST3').owner], ['creating', 'platform']);
  assert.deepEqual([cards.get('WTEST4').stage, cards.get('WTEST4').primary], ['ready', 'confirm_submit']);
  assert.deepEqual([cards.get('WTEST5').owner, cards.get('WTEST5').primary], ['maintainer', 'copy_for_maintainer']);
  assert.deepEqual([cards.get('WTEST6').owner, cards.get('WTEST6').stage], ['maintainer', 'preparing']);
  assert.equal(cards.get('WTEST1').name, 'N WTEST1');
});

test('running jobs are the program\'s turn, failed segments are the operator\'s', async () => {
  const {jobCards} = await load();
  const [running] = jobCards(job([{sku: 'WRUN1', state: 'COPY_GENERATING'}], {state: 'running'}));
  assert.deepEqual([running.owner, running.headline], ['program', '正在生成商品文案']);
  const [failed] = jobCards({id: 'j', state: 'failed', codes: ['WFAIL1'], result: {code: 'GIGA_SEGMENT_FAILED'}});
  assert.deepEqual([failed.owner, failed.primary], ['you', 'recheck']);
});

test('submission and live listing states', async () => {
  const {productCard} = await load();
  const sub = (state, extra = {}) => productCard({sku: 'WSUB1', job: {id: 'j'}, item: {sku: 'WSUB1', state: 'PREVIEW_VALID'}, submission: {sku: 'WSUB1', state, ...extra}});
  assert.deepEqual([sub('accepted').owner, sub('accepted').stage], ['platform', 'creating']);
  const unknown = sub('needs_reconciliation', {operationId: 'op-1'});
  assert.deepEqual([unknown.unknown, unknown.owner, unknown.primary], [true, 'you', 'check_result']);
  const pending = sub('needs_reconciliation');
  assert.deepEqual([pending.unknown, pending.owner, pending.primary], [true, 'program', null]);
  assert.deepEqual([sub('not_sent').primary, sub('not_sent').stage], ['confirm_submit', 'ready']);
  assert.equal(sub('needs_review', {result: {code: 'GIGA_PRICE_DRIFT'}}).primary, 'recheck');
  assert.equal(sub('needs_review', {result: {code: 'PREVIEW_PROGRAM_FAILED'}}).owner, 'maintainer');
  const live = (available, status = ['BUYABLE']) => productCard({sku: 'WSUB1', job: {id: 'j'}, submission: {sku: 'WSUB1', state: 'verified'},
    live: {sku: 'WSUB1', asin: 'B000000001', status, available}});
  assert.deepEqual([live(5).stage, live(5).headline, live(5).asin], ['selling', '在售 5 件', 'B000000001']);
  assert.deepEqual([live(0).stage, live(0).owner], ['opening', 'program']);
  assert.equal(live(3, []).stage, 'opening');
});

test('screening, quote screen and skip states', async () => {
  const {productCard} = await load();
  assert.equal(productCard({sku: 'W1', screen: {reason: 'RATE_MEDIUM'}}).stage, 'excluded');
  const unverified = productCard({sku: 'W1', screen: {reason: 'RATE_UNVERIFIED'}});
  assert.deepEqual([unverified.stage, unverified.owner, unverified.primary], ['screening', 'you', 'rescreen']);
  assert.equal(productCard({sku: 'W1', job: {id: 'j'}, quote: {code: 'W1', quoteScreen: 'GIGA_LANDED_QUOTE_OVER_3000_USD'}}).stage, 'excluded');
  assert.deepEqual(['skipped', 'unskip'], (c => [c.stage, c.primary])(productCard({sku: 'W1', skipped: true, item: {state: 'PREVIEW_VALID'}})));
});

test('every operator-owned card has an action and the todo list is ordered by safety first', async () => {
  const {jobCards, summarize, ACTION, mergeCards} = await load();
  const states = ['PREPARING', 'PREVIEW_VALID', 'NEEDS_SOURCE_REVIEW', 'PREPARATION_EXCEPTION', 'EXCEPTION', 'PREVIEW_REJECTED', 'NEEDS_INPUT',
    'PREVIEW_VALID_DRAFT_STOCK_HOLD', 'PREPARED_OUT_OF_STOCK', 'COLOR_FAMILY_REVIEW_REQUIRED', 'ALREADY_SUBMITTED', 'PUBLICATION_PENDING', 'SOMETHING_NEW'];
  const cards = jobCards(job(states.map((state, i) => ({sku: 'WS' + i, state}))));
  for (const c of cards) {
    assert.ok(c.headline, c.sku);
    if (c.owner === 'you') assert.ok(c.primary && ACTION[c.primary], c.sku + ' ' + c.headline);
  }
  const reconcile = jobCards({id: 'j2', created: 200, codes: ['WR1'], result: {pipeline: {items: [{sku: 'WR1', state: 'PREVIEW_VALID'}]}},
    submissions: [{items: [{sku: 'WR1', state: 'needs_reconciliation', operationId: 'op'}]}]});
  const s = summarize(mergeCards([cards, reconcile]));
  assert.equal(s.todo[0].action, 'check_result');
  assert.equal(s.todo[1].action, 'confirm_submit');
});

test('the newest job wins when a SKU appears twice', async () => {
  const {mergeCards, productCard} = await load();
  const old = {...productCard({sku: 'W1', job: {id: 'a', state: 'failed'}}), created: 1};
  const fresh = {...productCard({sku: 'W1', job: {id: 'b'}, item: {state: 'PREVIEW_VALID'}}), created: 2};
  assert.equal(mergeCards([[fresh], [old]])[0].stage, 'ready');
});
