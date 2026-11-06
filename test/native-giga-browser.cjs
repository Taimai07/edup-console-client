process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const client=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'edup-giga-browser-'));
app.setPath('userData',path.join(root,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const {GigaBrowser}=require('../desktop/giga-browser.cjs'),bridge=new GigaBrowser({directory:root});
const put=(name,v)=>fs.writeFileSync(path.join(root,name),JSON.stringify(v));
put('connection.json',{extensionProtocol:2,inspection:{loggedIn:true,buyer:true,countryId:223,countryCode:'USA'}});
put('heartbeat.json',{at:Date.now()/1000});
const calls=[];let scope=null;
ipcMain.handle('fixture:business',(_event,op,args)=>{
  require('../shared/ai-contract.cjs').validateAIRequest(op,args);calls.push({op,args});
  if(op==='batch_chat_list')return {batches:[]};
  if(op==='giga_query'){
    if(!scope||args.site!==scope.site||JSON.stringify(args.codes)!==JSON.stringify(scope.codes))throw Error('FROZEN_SCOPE_LOST');
    if(bridge.task(scope.id).state!=='verified')throw Error('PIPELINE_STARTED_BEFORE_RECEIPT');
    return {id:args.requestId,rootJobId:args.requestId,state:'queued'};
  }
  if(op==='giga_job')return {id:args.id,rootJobId:args.id,codes:['WTEST1'],state:'queued',result:{products:[]}};
  throw Error('UNEXPECTED_BUSINESS_CALL');
});
ipcMain.handle('fixture:browser',(_event,op,args)=>{
  if(op==='giga-browser-start'){
    put('heartbeat.json',{at:Date.now()/1000});
    const task=bridge.start(args);scope=task;
    setTimeout(()=>put(task.id+'.result.json',{result:{state:'ALL_SAVED_VERIFIED',countryId:223,countryCode:'USA',amazonSubmitted:false,
      items:task.codes.map(sku=>({sku,productId:'fixture-only',state:'ALREADY_SAVED_OR_RECONCILED'}))}}),250);
    return task;
  }
  if(op==='giga-browser-task')return bridge.task(args.id);
  throw Error('UNEXPECTED_BROWSER_CALL');
});
const receipt={passed:false,userWindowTouched:false,modelAndPlatformCalls:0};
function save(){fs.mkdirSync(path.join(client,'dist'),{recursive:true});fs.writeFileSync(path.join(client,'dist/native-giga-browser-receipt.json'),JSON.stringify({...receipt,calls},null,2));}
const limit=setTimeout(()=>{receipt.error='TIMEOUT';save();app.exit(2)},45000);
app.whenReady().then(async()=>{
  const partition='giga-browser-fixture',isolated=session.fromPartition(partition),assets=require('../desktop/ui-assets.cjs').createUIHandler(path.join(client,'ui'));
  isolated.protocol.handle('edup',req=>new URL(req.url).pathname==='/'?new Response('<!doctype html><html><head><meta charset="utf-8"></head><body><main id="view"></main></body></html>',{headers:{'Content-Type':'text/html'}}):assets(req));
  const win=new BrowserWindow({show:false,webPreferences:{partition,preload:path.join(__dirname,'native-giga-browser-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
  await win.loadURL('edup://console/');
  const run=code=>win.webContents.executeJavaScript(code);
  const wait=async code=>{for(let n=0;n<100;n++){if(await run(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI_WAIT_FAILED:'+code);};
  await run("window.selection=new Set(['WTEST1']);import('edup://console/operations.js').then(m=>m.gigaQueries(document.querySelector('#view'),window.selection,{site:'US',siteAvailable:true}))");
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='读取云仓详情、报价和库存'&&!b.disabled)");
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='读取云仓详情、报价和库存').click()");
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  if(calls.some(x=>x.op==='giga_query'))throw Error('BUSINESS_BEFORE_MANUAL_CONFIRMATION');
  receipt.waitsForManualAccount=true;
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='取消本次操作').click()");
  await wait("![...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  if(calls.some(x=>x.op==='giga_query'))throw Error('BUSINESS_AFTER_CANCEL');
  receipt.cancelPreventsPipeline=true;
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='读取云仓详情、报价和库存').click()");
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  await run("window.selection.clear();window.selection.add('OTHER_CODE');[...document.querySelectorAll('button')].find(b=>b.textContent==='已打开，检查并继续').click()");
  for(let n=0;n<100&&!calls.some(x=>x.op==='giga_query');n++)await new Promise(r=>setTimeout(r,100));
  const query=calls.find(x=>x.op==='giga_query');
  if(!query||query.args.codes.join(',')!=='WTEST1'||query.args.site!=='US')throw Error('FROZEN_SCOPE_CHANGED');
  receipt.frozenScopePreserved=true;receipt.completeReceiptRequired=true;receipt.nativeProtocol=true;receipt.passed=true;
  clearTimeout(limit);save();win.destroy();app.exit(0);
}).catch(error=>{clearTimeout(limit);receipt.error=error.message;save();app.exit(1)});
