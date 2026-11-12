process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const client=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'edup-groups-'));
app.setPath('userData',path.join(temp,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const out=path.join(client,'dist/native-listing-groups-receipt.json');
const receipt={passed:false,userWindowTouched:false,realBusinessCalls:0};let win;
function save(){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(receipt,null,2));}
const timeout=setTimeout(()=>{receipt.error='TEST_TIMEOUT';save();app.exit(1)},45000);
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('listing-groups-test');
 isolated.protocol.handle('edup',req=>{
  const u=new URL(req.url);
  if(u.pathname==='/')return new Response('<!doctype html><meta charset="utf-8"><main id="view"></main>',{headers:{'Content-Type':'text/html'}});
  const file=path.resolve(client,'ui','.'+u.pathname);
  if(!file.startsWith(path.join(client,'ui')+path.sep))return new Response('',{status:403});
  return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'}});
 });
 win=new BrowserWindow({show:false,focusable:false,width:1200,height:900,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadURL('edup://console/');const run=s=>win.webContents.executeJavaScript(s);
 await run(`(async()=>{
  window.fixtureCalls=[]; window.fixtureCodes=Array.from({length:205},(_,i)=>'WTEST'+(1000+i));let active=[];
  const call=async(op,args)=>{
   if(op==='service_status')return {listingSites:{sites:[{code:'US',name:'美国'}]},storage:window.fixtureStorage};
   if(op==='batch_chat_list')return {batches:[]};
   if(op==='giga_query'){fixtureCalls.push(args.codes);return {id:args.requestId,state:'completed'};}
   if(op==='giga_job')return {id:args.id,state:'completed',result:{products:[]}};
   throw Error('UNEXPECTED '+op);
  };
  window.edup={ai:call,maintenance:async(op,args)=>{
   if(op==='giga-browser-status')return {connected:true,extensionProtocol:4,accountScopeV2:false,inspection:{loggedIn:true,buyer:true,countryCode:'USA'}};
   if(op==='giga-browser-start'){active=args.codes;return {id:'fixture'};}
   if(op==='giga-browser-task')return {state:'verified',site:'US',codes:active,items:active.map(sku=>({sku})),screenId:'fixture',excluded:[]};
   if(op==='listing-event')return {};
   throw Error('UNEXPECTED '+op);
  }};
  localStorage.setItem('edup:listing:pace:v2',JSON.stringify({restMinutes:0,hourly:0,daily:0}));
  const {local,runner}=await import('edup://console/listing-runner.js');window.testRunner=runner;
  local.saveList({id:'fixture-list',site:'US',source:'paste',kind:'query',label:'Fixture Archive',codes:fixtureCodes,jobs:[],created:Date.now()/1000});
  const {mountListing}=await import('edup://console/listing-app.js');
  window.view=mountListing(document.querySelector('#view'),{call,getSnapshot:()=>({products:[]}),isOffline:()=>false});
  await view.store.refreshService();await view.store.refreshBrowser();view.show();
 })()`);
 const click=text=>run(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
 await click('清单');await click('打开');
 if(await run(`document.querySelectorAll('input[aria-label^="选择第 "]').length`)!==3)throw Error('ARCHIVES_MISSING');
 await click('查看本组');
 if(await run(`document.querySelectorAll('.lst-products tbody tr').length`)!==100)throw Error('GROUP_FILTER_WRONG');
 await run(`view.store.touch()`);await new Promise(r=>setTimeout(r,120));
 if(await run(`document.querySelectorAll('.lst-products tbody tr').length`)!==100)throw Error('REFRESH_LOST_FILTER');
 await run(`document.querySelector('input[aria-label="选择第 1 组"]').click()`);
 await run(`document.querySelector('input[aria-label="选择第 3 组"]').click()`);
 await click('执行选中的 2 组');
 for(let n=0;n<250;n++){
  if(await run(`testRunner.state.phase==='done'&&testRunner.state.queue===0`))break;
  await new Promise(r=>setTimeout(r,50));
 }
 const result=await run(`({codes:fixtureCalls.flat(),phase:testRunner.state.phase,queue:testRunner.state.queue})`);
 const expected=Array.from({length:205},(_,i)=>'WTEST'+(1000+i)).filter((_,i)=>i<100||i>=200);
 if(result.phase!=='done'||result.queue||JSON.stringify(result.codes)!==JSON.stringify(expected))throw Error('SELECTION_EXECUTION_MISMATCH');
 await run(`fixtureStorage={blocked:true,code:'GIGA_SERVER_STORAGE_LOW',freeBytes:1073741824,freePercent:1.5};view.store.refreshService()`);
 await new Promise(r=>setTimeout(r,120));
  if(await run(`document.body.textContent.includes('服务器存储不足')`))throw Error('STORAGE_BANNER_SHOULD_NOT_BLOCK_UPLOAD');
 await run(`document.querySelector('input[aria-label="选择第 1 组"]').click()`);
  if(await run(`[...document.querySelectorAll('button')].find(b=>b.textContent==='执行选中的 1 组').disabled`))throw Error('STORAGE_SHOULD_NOT_BLOCK_UPLOAD');
  receipt.storageBanner=false;receipt.storageBlocksGroups=false;
 receipt.passed=true;receipt.groups=[100,100,5];receipt.executedGroups=[1,3];receipt.executed=105;receipt.filteredRows=100;
 clearTimeout(timeout);save();win.destroy();app.exit(0);
}).catch(error=>{receipt.error=error.message;clearTimeout(timeout);save();app.exit(1)});
