const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {GigaBrowser} = require('../desktop/giga-browser.cjs');
function setup(t, countryId = 81, countryCode = 'DEU') {
  const dir = fs.mkdtempSync(path.join(__dirname, 'giga-integration-'));
  t.after(() => { assert.equal(path.dirname(dir), __dirname); fs.rmSync(dir, {recursive: true, force: true}); });
  const put = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  put('connection.json', {connectedAt: 999, extensionProtocol: 4, inspection: {loggedIn: true, buyer: true, countryId, countryCode}});
  put('heartbeat.json', {at: 1000});
  const bridge = new GigaBrowser({directory: dir, now: () => 1000});
  return {dir, put, bridge};
}
test('UI input is frozen and product receipts are bound to the exact site and code list', t => {
  const {dir, put, bridge} = setup(t), codes = ['WTEST1', 'WTEST2'];
  const started = bridge.start({site: 'DE', codes}); codes.push('NOT_IN_TASK');
  const task = JSON.parse(fs.readFileSync(path.join(dir, 'request.json')));
  assert.deepEqual(task.skus, ['WTEST1', 'WTEST2']); assert.equal(task.site, 'DE');
  assert.equal(bridge.task(started.id).state, 'waiting_for_browser');
  put(started.id + '.result.json', {result: {state: 'DETAIL_RATES_READ', taskId:started.id, countryId: 81, countryCode: 'DEU', amazonSubmitted: false,
    items: task.skus.map((sku,i) => ({sku, productId: String(i+1), state: i===0?'RATE_LOW':'RATE_HIGH'}))}});
  const evidence=bridge.task(started.id);
  assert.equal(evidence.state, 'rates_read');
  const approved=bridge.startApproved(evidence,{id:'12345678-1234-4123-8123-123456789abc',approved:{WTEST1:'1'},excluded:[{sku:'WTEST2',state:'RETURN_RATE_NOT_LOW'}]});
  assert.deepEqual(approved.task.codes,['WTEST1']);
  put(approved.task.id+'.result.json',{result:{state:'APPROVED_FAVORITES_VERIFIED',taskId:approved.task.id,countryId:81,countryCode:'DEU',amazonSubmitted:false,
    items:[{sku:'WTEST1',productId:'1',state:'DETAIL_LOW_ADDED'}]}});
  assert.equal(bridge.task(approved.task.id).state,'verified');
});
test('wrong browser region cannot dispatch a favorite task', t => {
  const {bridge, dir} = setup(t);
  assert.throws(() => bridge.start({site: 'US', codes: ['WTEST1']}), /REGION_MISMATCH/);
  assert.equal(fs.existsSync(path.join(dir, 'request.json')), false);
});
test('preparation can reuse a fresh verified favorite subset without an active browser', t => {
  const {put,bridge}=setup(t,223,'USA');
  const id='12345678-1234-4123-8123-123456789abc';
  const screenId='98765432-9876-4987-8987-987654321abc';
  put(id+'.client-task.json',{id,op:'favorites',site:'US',skus:['WTEST1','WTEST2'],
    approved:{WTEST1:'1',WTEST2:'2'},screenId,expiresAt:2800});
  put(id+'.result.json',{result:{taskId:id,state:'APPROVED_FAVORITES_VERIFIED',countryId:223,
    countryCode:'USA',amazonSubmitted:false,items:[
      {sku:'WTEST1',productId:'1',state:'DETAIL_LOW_ALREADY_SAVED'},
      {sku:'WTEST2',productId:'2',state:'DETAIL_LOW_ADDED'},
    ]}});
  put('heartbeat.json',{at:900});
  const result=bridge.reusableFavorites({site:'US',codes:['WTEST2','WTEST3']});
  assert.deepEqual(result.missing,['WTEST3']);
  assert.deepEqual(result.receipts.map(r=>[r.screenId,r.codes]),[[screenId,['WTEST2']]]);
  assert.deepEqual(bridge.reusableFavorites({site:'DE',codes:['WTEST2']}).receipts,[]);
  const newer='ab345678-1234-4123-8123-123456789abc';
  put(newer+'.client-task.json',{id:newer,op:'read_rates',site:'US',skus:['WTEST1'],expiresAt:2801});
  assert.deepEqual(bridge.reusableFavorites({site:'US',codes:['WTEST1']}).missing,['WTEST1']);
  put('connection.json',{connectedAt:1001,extensionProtocol:4,inspection:{loggedIn:true,buyer:true,countryId:223,countryCode:'USA'}});
  assert.deepEqual(bridge.reusableFavorites({site:'US',codes:['WTEST2']}).missing,['WTEST2']);
  put('connection.json',{connectedAt:999,extensionProtocol:4,inspection:{loggedIn:true,buyer:true,countryId:223,countryCode:'USA'}});
  bridge.now=()=>4300;
  assert.deepEqual(bridge.reusableFavorites({site:'US',codes:['WTEST2']}).missing,['WTEST2']);
});
test('unverified country mapping and duplicate codes cannot dispatch', t => {
  const {bridge} = setup(t);
  assert.throws(() => bridge.start({site: 'FR', codes: ['WTEST1']}), /MAPPING_NOT_VERIFIED/);
  assert.throws(() => bridge.start({site: 'DE', codes: ['WTEST1', 'WTEST1']}), /CODES_INVALID/);
});
test('a read within three days remains usable but does not replace favorite evidence', t => {
  const {put,bridge}=setup(t,223,'USA');
  const id='12345678-1234-4123-8123-123456789abc';
  const codes=['WTEST1','WTEST2','WTEST3','WTEST4'];
  put(id+'.client-task.json',{id,op:'read_rates',site:'US',skus:codes.slice(0,3),expiresAt:900});
  put(id+'.result.json',{result:{taskId:id,state:'DETAIL_RATES_READ',countryId:223,countryCode:'USA',amazonSubmitted:false,
    items:['RATE_MEDIUM','RATE_UNVERIFIED','RATE_NA'].map((state,i)=>({sku:codes[i],productId:String(i+1),state}))}});
  assert.equal(bridge.task(id).state,'rates_read');
  const result=bridge.reusableFavorites({site:'US',codes});
  assert.deepEqual(result.receipts,[]);
  assert.deepEqual(result.missing,codes);
  assert.deepEqual(result.missingDetails.map(row=>row.reason),['RATE_MEDIUM','RATE_UNVERIFIED','RATE_NA','NO_FAVORITE_EVIDENCE']);
  put(id+'.result.json',{result:{taskId:id,state:'DETAIL_RATES_READ',countryId:81,countryCode:'DEU',amazonSubmitted:false,
    items:codes.slice(0,3).map((sku,i)=>({sku,productId:String(i+1),state:'RATE_MEDIUM'}))}});
  assert(bridge.reusableFavorites({site:'US',codes}).missingDetails.every(row=>row.reason==='NO_FAVORITE_EVIDENCE'));
});
test('stale connection is not a usable login', t => {
  const {bridge, put} = setup(t); put('heartbeat.json', {at: 900});
  assert.throws(() => bridge.start({site: 'DE', codes: ['WTEST1']}), /NOT_CONNECTED/);
});
test('unresolved dispatched task is not overwritten', t => {
  const {bridge, put} = setup(t); const first = bridge.start({site: 'DE', codes: ['WTEST1']});
  put(first.id + '.dispatch.json', {at: 1000});
  assert.throws(() => bridge.start({site: 'DE', codes: ['WTEST2']}), /REQUIRES_RECONCILIATION/);
});
test('scope-tampered receipt cannot start the original pipeline', t => {
  const {bridge, put} = setup(t); const task = bridge.start({site: 'DE', codes: ['WTEST1']});
  put(task.id + '.result.json', {result: {state: 'DETAIL_RATES_READ', taskId:task.id, countryId: 81, countryCode: 'DEU', amazonSubmitted: false,
    items: [{sku: 'OTHER_SKU', state: 'ADDED_AND_VERIFIED'}]}});
  assert.throws(() => bridge.task(task.id), /SCOPE_MISMATCH/);
});
test('a browser hold is returned as stopped and never mistaken for success', t => {
  const {bridge, put} = setup(t); const task = bridge.start({site: 'DE', codes: ['WTEST1']});
  put(task.id + '.result.json', {result: {state: 'STOPPED', code: 'LOGIN_REQUIRED'}});
  assert.deepEqual(bridge.task(task.id), {id: task.id, state: 'stopped', code: 'LOGIN_REQUIRED'});
});
