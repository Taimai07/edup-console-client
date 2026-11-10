const test = require('node:test');
const assert = require('node:assert/strict');
const timers = global.setTimeout;
let clock = new Date(2026, 10, 10, 12, 0).getTime();
Date.now = () => clock;
global.setTimeout = (callback, delay = 0, ...args) => timers(() => {clock += Math.max(0, delay);callback(...args);}, 0);
const data = new Map(), started = [], admitted = [];
data.set('edup:listing:pace:v2',JSON.stringify({restMinutes:5,hourly:90,daily:450}));
global.localStorage = {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
global.Notification = function() {};
global.window = {edup:{
  maintenance:async (action,args)=>{
    if(action==='giga-browser-reuse')return {receipts:[],missing:args.codes};
    if(action==='giga-browser-status')return {connected:true,extensionProtocol:4,accountScopeV2:false,
      inspection:{loggedIn:true,buyer:true,countryCode:'USA'}};
    if(action==='giga-browser-start'){started.push([...args.codes]);return {id:'task-'+started.length};}
    if(action==='giga-browser-task'){
      const codes=started.at(-1);
      return {state:'verified',site:'US',codes,items:codes.map((sku,i)=>({sku,productId:String(i+100)})),screenId:'screen',excluded:[]};
    }
    if(action==='listing-event')return {};
    throw Error('UNEXPECTED '+action);
  },
  ai:async (op,args)=>{
    if(op==='giga_prepare'){admitted.push([...args.codes]);return {id:args.requestId,rootJobId:args.requestId,state:'queued'};}
    if(op==='giga_job')return {id:args.id,state:'completed'};
    throw Error('UNEXPECTED '+op);
  },
}};
const codes=Array.from({length:79},(_,i)=>'W'+String(i+1000)+'P1');
async function settle(runner,phase){
  for(let i=0;i<1000;i++){
    if(runner.state.phase===phase)return;
    if(runner.state.phase==='error')throw Error(JSON.stringify(runner.state));
    await new Promise(resolve=>timers(resolve,1));
  }
  throw Error('RUNNER_DID_NOT_SETTLE '+runner.state.phase);
}

test('440 of 450 uses the remaining 10 and restores 59 previously handled products',async()=>{
  const {usage,runner}=await import('../ui/listing-runner.js');
  const {openSegmentJournal}=await import('../ui/giga-segment-journal.js');
  const journal=await openSegmentJournal(localStorage,{site:'US',operation:'giga_prepare',parent:null,codes});
  for(const group of [codes.slice(0,20),codes.slice(20,40),codes.slice(40,59)]){
    const key=group.join(',');const id=journal.reserve(key,group);journal.seen(key,{id,state:'completed'});
  }
  for(let i=0;i<22;i++)usage.record('US',20,clock-2*3600e3-i*1000);
  assert.equal(usage.available('US'),10);
  let stopped=false;
  const unsubscribe=runner.subscribe(state=>{
    if(!stopped&&state.phase==='running'&&state.message.includes('今日已安排读取 450/450')){stopped=true;runner.stop();}
  });
  runner.start({kind:'prepare',site:'US',codes});
  await settle(runner,'paused');
  unsubscribe();
  assert.equal(started.length,1);
  assert.deepEqual(started[0],codes.slice(59,69));
  assert.deepEqual(admitted[0],codes.slice(59,69));
  assert.equal(runner.state.recovered,59);
  assert.equal(runner.state.done,69);
  assert.equal(usage.available('US'),0);
});

test('next-day resume sends only the remaining ten and resets pause presentation',async()=>{
  const {runner}=await import('../ui/listing-runner.js');
  clock=new Date(2026,10,11,9,0).getTime();
  runner.start({kind:'prepare',site:'US',codes});
  await settle(runner,'done');
  assert.equal(started.length,2);
  assert.deepEqual(started[1],codes.slice(69));
  assert.equal(runner.state.done,79);
  assert.equal(runner.state.recovered,69);
  assert.equal(runner.state.stopping,false);
});
