process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const client=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'edup-giga-browser-'));
app.setPath('userData',path.join(root,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const {GigaBrowser}=require('../desktop/giga-browser.cjs'),bridge=new GigaBrowser({directory:root});
const put=(name,v)=>fs.writeFileSync(path.join(root,name),JSON.stringify(v));
put('connection.json',{extensionProtocol:4,storeCatalog:true,accountScopeV2:true,connectedAt:Date.now()/1000,inspection:{loggedIn:true,buyer:true,countryId:223,countryCode:'USA'}});
put('heartbeat.json',{at:Date.now()/1000});
const calls=[], segments=[], jobs=new Map(), storeActions=[];
const fixtureStore={id:'6547',code:'N616',name:'Fixture Store'};
let scope=null;
ipcMain.handle('fixture:business',(_event,op,args)=>{
  require('../shared/ai-contract.cjs').validateAIRequest(op,args);calls.push({op,args});
  if(op==='batch_chat_list')return {batches:[]};
  if(op==='giga_query'){
    if(!scope||args.site!==scope.site||JSON.stringify(args.codes)!==JSON.stringify(scope.codes))throw Error('FROZEN_SCOPE_LOST');
    if(bridge.task(scope.id).state!=='verified')throw Error('PIPELINE_STARTED_BEFORE_RECEIPT');
    jobs.set(args.requestId,{codes:args.codes,completed:false});
    return {id:args.requestId,rootJobId:args.requestId,state:'queued'};
  }
  if(op==='giga_job'){
    const job=jobs.get(args.id);
    if(!job)throw Error('UNEXPECTED_JOB_ID');
    job.completed=true;
    return {id:args.id,rootJobId:args.id,codes:job.codes,state:'completed',result:{products:[]}};
  }
  throw Error('UNEXPECTED_BUSINESS_CALL');
});
ipcMain.handle('fixture:browser',(_event,op,args)=>{
  if(op==='giga-browser-folder')return {directory:'fixture-only-extension-folder'};
  if(op==='giga-browser-copy-folder')return {copied:true};
  if(op==='giga-browser-start'){
    put('heartbeat.json',{at:Date.now()/1000});
    if([...jobs.values()].some(job=>!job.completed))throw Error('OVERLAPPING_SEGMENTS');
    segments.push(args.codes);
    const task=bridge.start(args);
    setTimeout(()=>put(task.id+'.result.json',{result:{state:'DETAIL_RATES_READ',taskId:task.id,countryId:223,countryCode:'USA',amazonSubmitted:false,buyerHash:'b'.repeat(64),
      items:task.codes.map((sku,i)=>({sku,productId:String(i+1),state:i===0?'RATE_LOW':'RATE_HIGH'}))}}),250);
    return task;
  }
  if(op==='giga-store-start'){
    put('heartbeat.json',{at:Date.now()/1000});
    const task=bridge.startStore(args);
    const base={taskId:task.id,countryId:223,countryCode:'USA',amazonSubmitted:false,store:fixtureStore};
    storeActions.push(args.action==='page'?'page'+args.page:args.action);
    let result;
    if(args.action==='resolve'){
      if(args.input!=='N616')throw Error('WRONG_STORE_INPUT');
      result={...base,state:'STORE_RESOLVED',saved:false,total:51,pageSize:50};
    }else if(args.action==='page'){
      const offset=(args.page-1)*50;
      const items=Array.from({length:Math.min(50,51-offset)},(_,i)=>({sku:'ABTEST'+(offset+i+1),productId:String(offset+i+1)}));
      result={...base,state:'STORE_PAGE_READ',page:args.page,total:51,items};
    }else result={...base,state:'STORE_SAVED_VERIFIED',saved:true};
    put(task.id+'.result.json',{result});
    return task;
  }
  if(op==='giga-browser-status')return bridge.status();
  if(op==='giga-browser-task')return bridge.task(args.id);
  if(op==='giga-browser-screen'){
    const rates=bridge.task(args.id);
    if(rates.state!=='rates_read')throw Error('RATES_NOT_READ');
    const screen=bridge.startApproved(rates,{id:'12345678-1234-4123-8123-123456789abc',
      buyerHash:'b'.repeat(64),approved:{[rates.codes[0]]:'1'},excluded:rates.codes.slice(1).map(sku=>({sku,state:'RETURN_RATE_NOT_LOW'}))});
    scope=screen.task;
    setTimeout(()=>put(scope.id+'.result.json',{result:{state:'APPROVED_FAVORITES_VERIFIED',taskId:scope.id,countryId:223,countryCode:'USA',amazonSubmitted:false,buyerHash:'b'.repeat(64),
      items:[{sku:rates.codes[0],productId:'1',state:'DETAIL_LOW_ALREADY_SAVED'}]}}),250);
    return screen;
  }
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
  await run("window.selection=new Set(Array.from({length:31},(_,i)=>'WTEST'+(i+1)));import('edup://console/operations.js').then(m=>m.gigaQueries(document.querySelector('#view'),window.selection,{site:'US',siteAvailable:true}))");
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='读取云仓详情、报价和库存'&&!b.disabled)");
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='读取云仓详情、报价和库存').click()");
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  if(calls.some(x=>x.op==='giga_query'))throw Error('BUSINESS_BEFORE_MANUAL_CONFIRMATION');
  if(!await run("document.body.textContent.includes('首次安装、更新和连接教程')&&document.body.textContent.includes('chrome://extensions/')&&document.body.textContent.includes('加载已解压的扩展程序')"))throw Error('INSTALL_GUIDE_MISSING');
  receipt.installationGuidePresent=true;
  receipt.waitsForManualAccount=true;
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='取消本次操作').click()");
  await wait("![...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  if(calls.some(x=>x.op==='giga_query'))throw Error('BUSINESS_AFTER_CANCEL');
  receipt.cancelPreventsPipeline=true;
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='读取云仓详情、报价和库存').click()");
  await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  await run("window.selection.clear();window.selection.add('OTHER_CODE');[...document.querySelectorAll('button')].find(b=>b.textContent==='已打开，检查并继续').click()");
  for(let n=0;n<350&&!(jobs.size===2&&[...jobs.values()].every(job=>job.completed));n++)await new Promise(r=>setTimeout(r,100));
  const queries=calls.filter(x=>x.op==='giga_query');
  if(queries.length!==2||queries.some(x=>x.args.site!=='US')||queries.flatMap(x=>x.args.codes).join(',')!=='WTEST1,WTEST31')throw Error('FROZEN_SCOPE_CHANGED');
  if(segments.map(codes=>codes.length).join(',')!=='30,1')throw Error('SEGMENTS_NOT_SEQUENTIAL');
  await wait("![...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  await run("Promise.all([import('edup://console/giga-store.js'),import('edup://console/operations.js')]).then(([store,ops])=>{const view=document.querySelector('#view');view.replaceChildren();store.renderGigaStore(view,{site:'US',available:true,onImported:({codes})=>{window.imported=codes;view.replaceChildren();ops.gigaQueries(view,new Set(codes),{site:'US',readOnMount:true});}});})");
  await run("document.querySelector('input[aria-label=\"大健店铺名称、编码或网址\"]').value='N616';[...document.querySelectorAll('button')].find(b=>b.textContent==='核对店铺').click()");
  await wait("document.body.textContent.includes('Fixture Store · N616 · 51 件商品')");
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='收藏店铺并导入 SKU').click()");
  await wait("window.imported?.length===51&&[...document.querySelectorAll('button')].some(b=>b.textContent==='已打开，检查并继续')");
  if(await run("window.imported.at(-1)")!=='ABTEST51'||storeActions.join(',')!=='resolve,page1,page2,save'||
    calls.filter(x=>x.op==='giga_query').length!==2)throw Error('STORE_HANDOFF_FAILED');
  receipt.storeImport=true;receipt.sequentialSegments=true;receipt.frozenScopePreserved=true;receipt.completeReceiptRequired=true;receipt.nativeProtocol=true;receipt.passed=true;
  clearTimeout(limit);save();win.destroy();app.exit(0);
}).catch(error=>{clearTimeout(limit);receipt.error=error.message;save();app.exit(1)});
