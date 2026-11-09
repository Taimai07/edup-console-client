const assert = require('node:assert/strict');
const test = require('node:test');

const timers = global.setTimeout;
const baseTime = Date.now();
let elapsed = 0;
Date.now = () => baseTime + elapsed;
global.setTimeout = (callback, _delay, ...args) => timers(callback, 0, ...args);

const data = new Map();
global.localStorage = {
  getItem: key => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
  removeItem: key => data.delete(key),
};

const codes = Array.from({length: 25}, (_, index) => 'W' + String(10100 + index) + 'P100001');
const first = codes.slice(0, 20);
const second = codes.slice(20);
const makeReceipt = skus => ({id:'mock-browser',site:'US',codes:skus,items:skus.map(sku => ({sku})),
  screenId:'mock-screen',excluded:[]});
const persisted = new Map(), calls = [];
const acceptedBeforeLoss = process.env.EDUP_RETRY_PROBE !== 'not_found';
let hidden = true, currentCodes;
global.window = {edup: {
  maintenance: async (action, args) => {
    if (action === 'giga-browser-reuse') return {receipts:[makeReceipt(first),makeReceipt(second)],missing:[]};
    if (action === 'giga-browser-status') return {connected:true,extensionProtocol:4,accountScopeV2:false,
      inspection:{loggedIn:true,buyer:true,countryCode:'USA'}};
    if (action === 'giga-browser-start') { currentCodes=args.codes; return {id:'mock-browser'}; }
    if (action === 'giga-browser-task') return {...makeReceipt(currentCodes),state:'verified'};
    if (action === 'listing-event') return {};
    throw Error('UNEXPECTED_MAINTENANCE');
  },
  ai: async (op,args) => {
    if (op === 'giga_prepare') {
      calls.push({id:args.requestId,codes:args.codes});
      const result={id:args.requestId,rootJobId:args.requestId,state:'completed'};
      if (calls.length !== 1 || acceptedBeforeLoss) persisted.set(args.requestId,result);
      if (calls.length===1) {
        elapsed += 46 * 60000;
        throw Object.assign(Error('AI_SERVICE_TIMEOUT OUTCOME_UNKNOWN'),{outcome:'unknown'});
      }
      return result;
    }
    if (op === 'giga_job') {
      if (hidden && args.id===calls[0].id) throw Error('NETWORK_BUSY');
      if (persisted.has(args.id)) return persisted.get(args.id);
      throw Error('JOB_NOT_FOUND');
    }
    throw Error('UNEXPECTED_AI_CALL');
  },
}};

async function done(runner) {
  for(let i=0;i<400;i++){
    if(runner.state.phase==='done')return runner.state;
    if(runner.state.phase==='error')throw Error(JSON.stringify(runner.state.error));
    await new Promise(resolve=>timers(resolve,3));
  }
  throw Error('PROBE_DID_NOT_FINISH');
}

test('subset retry preserves a prior segment request across uncertain readback', async()=>{
  const {runner}=await import('../ui/listing-runner.js');
  const original={kind:'prepare',site:'US',codes,listId:null};
  runner.start(original);
  const firstRun=await done(runner);
  assert.equal(firstRun.unknown,true);
  assert.deepEqual(firstRun.failedCodes,first);
  assert.equal(calls.length,2);
  assert.equal(persisted.size,acceptedBeforeLoss?2:1);
  hidden=false;
  runner.dismiss();
  runner.start({...firstRun.task,codes:firstRun.failedCodes,fresh:true});
  await done(runner);
  const duplicates=calls.filter(x=>JSON.stringify(x.codes)===JSON.stringify(first));
  console.log(JSON.stringify({case:'server accepted but all client readback failed; operator retries leftover subset',
    testOnly:true,admissions:calls.length,firstSegmentIds:duplicates.map(x=>x.id),sameId:duplicates.length===1||duplicates[0].id===duplicates[1].id}));
  assert.equal(duplicates.length,acceptedBeforeLoss?1:2);
  assert.equal(new Set(duplicates.map(x=>x.id)).size,1,'retrying leftovers must not mint a new ID for an already-admitted segment');
});
