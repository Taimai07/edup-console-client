const test=require('node:test'),assert=require('node:assert/strict');
const data=new Map();
global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
const codes=Array.from({length:205},(_,i)=>'WTEST'+(1000+i));
let active=[],stopOnce=true,currentRunner;
const reads=[],admissions=[];
global.window={edup:{maintenance:async(action,args)=>{
  if(action==='giga-browser-status')return {connected:true,extensionProtocol:4,accountScopeV2:false,inspection:{loggedIn:true,buyer:true,countryCode:'USA'}};
  if(action==='giga-browser-reuse')return {receipts:[],missing:args.codes};
  if(action==='giga-browser-start'){active=[...args.codes];reads.push(...active);if(stopOnce){stopOnce=false;currentRunner.stop();}return {id:'mock'};}
  if(action==='giga-browser-task')return {state:'verified',site:'US',codes:active,items:active.map(sku=>({sku})),screenId:'screen',excluded:[]};
  if(action==='listing-event')return {};
  throw Error(action);
},ai:async(op,args)=>{
  if(op==='giga_prepare'){admissions.push(...args.codes);return {id:args.requestId,state:'completed'};}
  if(op==='giga_job')return {id:args.id,state:'completed'};
  throw Error(op);
}}};
async function settle(runner,phase){for(let n=0;n<200;n++){if(runner.state.phase===phase && (phase!=='done'||runner.state.queue===0))return;if(runner.state.phase==='error')throw Error(runner.state.message);await new Promise(r=>setTimeout(r,5));}throw Error('STUCK '+runner.state.phase);}

test('100-SKU archives remain stable, preserve legacy journal scope and do not evict old lists',async()=>{
  const {local}=await import('../ui/listing-runner.js');
  const {groupTask}=await import('../ui/listing-groups.js');
  const old={id:'old',site:'US',codes,jobs:['existing-job'],created:1};
  data.set('edup:listing:lists:v1',JSON.stringify([old]));
  const migrated=local.ensureGroups('old');
  assert.deepEqual(migrated.groups.map(g=>g.codes.length),[100,100,5]);
  assert.deepEqual(migrated.codes,old.codes);assert.deepEqual(migrated.jobs,old.jobs);
  assert.deepEqual(groupTask(migrated,migrated.groups[1]).journalCodes,codes);
  assert.deepEqual(local.ensureGroups('old'),migrated);
  assert.throws(()=>groupTask(migrated,{...migrated.groups[0],codes:['OTHER']}),/SCOPE/);
  for(let i=0;i<205;i++)local.saveList({id:'archive'+i,site:'US',codes:['W'+i],jobs:[]});
  assert.equal(local.lists().length,206);assert.ok(local.lists().some(x=>x.id==='old'));
  const set=localStorage.setItem;localStorage.setItem=()=>{throw Error('QuotaExceededError')};
  assert.throws(()=>local.saveList({id:'unsaved',codes:['W9']}),/QuotaExceeded/);localStorage.setItem=set;
});

test('new pacing ignores legacy quotas, retains history and still waits 30 seconds',async()=>{
  const {pace,usage}=await import('../ui/listing-runner.js');
  data.set('edup:listing:pace:v1',JSON.stringify({hourly:90,daily:450,restMinutes:5}));
  const now=Date.now();usage.record('US',2000,now);
  assert.deepEqual([pace().hourly,pace().daily,pace().restMinutes],[0,0,0.5]);
  assert.equal(usage.available('US',now),Infinity);
  assert.equal(usage.wait('US',100,now).ms,30000);
  assert.equal(usage.wait('US',100,now+30000).ms,0);
  assert.equal(usage.rows().at(-1).n,2000);
});

test('server backup restores the original archive membership and existing job owners',async()=>{
  const {restoredArchive}=await import('../ui/listing-groups.js');
  const result={id:'server-list',site:'US',source:'store',total:205,savedAt:1,
    items:codes.map((sku,i)=>({sku,...(i<20?{preparation:{rootJobId:'existing-root'}}:{})}))};
  const restored=restoredArchive(result);
  assert.deepEqual(restored.groups.map(g=>g.codes.length),[100,100,5]);
  assert.deepEqual(restored.jobs,['existing-root']);assert.equal(restored.backupId,result.id);
  assert.deepEqual(restoredArchive(result),restored);
  assert.throws(()=>restoredArchive({...result,total:204}),/RECEIPT/);
});

test('select groups 1 and 3, pause, restart, and resume only selected unhandled SKUs',async()=>{
  data.set('edup:listing:pace:v2',JSON.stringify({restMinutes:0,hourly:0,daily:0}));
  const {groupTask}=await import('../ui/listing-groups.js');
  const {local,runner}=await import('../ui/listing-runner.js');currentRunner=runner;
  const list=local.ensureGroups('old');
  runner.start(groupTask(list,list.groups[0]));runner.start(groupTask(list,list.groups[2]));
  runner.start(groupTask(list,list.groups[2])); // duplicate click cannot duplicate queued group
  await settle(runner,'paused');
  assert.equal(reads.length,20);assert.equal(runner.savedQueue().length,1);
  const fresh=(await import('../ui/listing-runner.js?restart=1')).runner;currentRunner=fresh;
  fresh.resumeSaved();await settle(fresh,'done');
  assert.deepEqual(reads,[...codes.slice(0,100),...codes.slice(200)]);
  assert.equal(new Set(admissions).size,105);assert.equal(admissions.length,105);
  assert.equal(fresh.savedQueue().length,0);assert.equal(localStorage.getItem('edup:listing:run:v1'),null);
});
