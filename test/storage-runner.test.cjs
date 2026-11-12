const test=require('node:test'),assert=require('node:assert/strict');
const data=new Map();global.localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
data.set('edup:listing:pace:v2',JSON.stringify({restMinutes:0,hourly:0,daily:0}));
let mode='resume',oldId;const admissions=[];
const receipt=codes=>({site:'US',codes,items:codes.map(sku=>({sku})),screenId:'mock',excluded:[]});
global.window={edup:{maintenance:async(op,args)=>{
 if(op==='giga-browser-reuse')return {receipts:Array.from({length:Math.ceil(args.codes.length/20)},(_,i)=>receipt(args.codes.slice(i*20,i*20+20))),missing:[]};
 if(op==='listing-event')return {};
 throw Error('UNEXPECTED '+op);
},ai:async(op,args)=>{
 if(op==='giga_prepare'){admissions.push(args);return {id:args.requestId,state:'queued'};}
 if(op==='giga_job')return {id:args.id,state:'failed',result:{code:'GIGA_SERVER_STORAGE_LOW',pipeline:{items:mode==='resume'?[{sku:'WGOOD1',state:'PREVIEW_VALID'},{sku:'WBLOCK1',reason:'GIGA_SERVER_STORAGE_LOW'}]:[]}}};
 throw Error(op);
}}};
async function settle(runner,phase){for(let i=0;i<500;i++){if(runner.state.phase===phase)return;await new Promise(r=>setTimeout(r,2));}throw Error('STUCK '+JSON.stringify(runner.state));}
test('persisted screened SKU segments are never resent after a backend storage failure',async()=>{
 const {openSegmentJournal}=await import('../ui/giga-segment-journal.js');const codes=['WGOOD1','WBLOCK1'];
 const journal=await openSegmentJournal(localStorage,{site:'US',operation:'giga_prepare',parent:null,codes});oldId=journal.reserve(codes.join(','),codes);journal.seen(codes.join(','),{id:oldId,state:'queued'});
 const {runner}=await import('../ui/listing-runner.js?storage-resume');runner.start({kind:'prepare',site:'US',codes});await settle(runner,'done');
 assert.equal(admissions.length,0);
 assert.equal(runner.state.recovered,2);
});
test('client uploads every screened segment without waiting for server downloads',async()=>{
 mode='blocked';admissions.length=0;
 const {runner}=await import('../ui/listing-runner.js?storage-stop');const codes=Array.from({length:45},(_,i)=>'WSTORAGE'+i);
 runner.start({kind:'prepare',site:'US',codes,listId:'one',groupId:'one'});
 runner.start({kind:'prepare',site:'US',codes:['WLATER1'],listId:'two',groupId:'two'});
 await settle(runner,'done');await new Promise(r=>setTimeout(r,20));
 assert.equal(admissions.length,4);
 assert.deepEqual(admissions.flatMap(x=>x.codes),[...codes,'WLATER1']);
 assert.equal(runner.savedQueue().length,0);
 assert.doesNotMatch(runner.state.message,/服务器存储不足/);
});
