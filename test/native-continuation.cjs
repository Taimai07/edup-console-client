process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),client=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'edup-continuation-native-'));fs.mkdirSync(path.join(client,'dist'),{recursive:true});
app.setPath('userData',path.join(root,'native-profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const id='11111111-1111-4111-8111-111111111111',calls=[],materials=[];let resumed=false;
const job=()=>({id,rootJobId:id,codes:['WTEST1','WTEST2','WTEST3'],state:resumed?'running':'completed',preparationMode:'ai_workflow',result:{products:[{code:'WTEST1'},{code:'WTEST2'},{code:'WTEST3'}],pipeline:{items:[{sku:'WTEST1',state:'NEEDS_SOURCE_REVIEW',reason:'REQUIRED_FACTS_NEED_REVIEW',attention:[{field:'country_of_origin',reason:'Country of origin not supplied.'},{field:'fabric_type',reason:'Fabric type not confirmed.'}]},{sku:'WTEST2',state:'PREPARATION_EXCEPTION',reason:'PLANNER_REQUEST_REJECTED',failure:{details:{reason:'plan_usage_paused',upstreamDispatched:false}}},{sku:'WTEST3',state:'ALREADY_SUBMITTED'}]}}});
ipcMain.handle('fixture:call',async(_e,op,args)=>{calls.push({op,args});
 require(path.join(client,'shared/ai-contract.cjs')).validateAIRequest(op,args);
 if(op==='batch_chat_list')return {batches:[{id,codes:job().codes,created:1}]};
 if(op==='giga_job')return job();
 if(op==='batch_chat_read')return {messages:[],proposals:[],activeRun:null,latestRun:null,hasEarlier:false};
 if(op==='batch_material_list')return {materials};
 if(op==='batch_material_save'){materials.push({label:args.label,read_at:null});return {saved:true};}
 if(op==='batch_chat_send')return {state:'fixture-only'};
 if(op==='giga_prepare'){if(args.parentJobId!==id||args.codes.join(',')!=='WTEST1,WTEST2')throw Error('WRONG_RESUME_SCOPE');resumed=true;return {id:'22222222-2222-4222-8222-222222222222',rootJobId:id,state:'queued'};}
 throw Error('UNEXPECTED_FIXTURE_OPERATION:'+op);
});
let reuseReady=false;
ipcMain.handle('fixture:browser',(_e,op,args)=>{
 if(op==='giga-browser-reuse'){
  if(!reuseReady)return {receipts:[],missing:args.codes};
  return {missing:[],receipts:[{codes:args.codes,site:args.site,screenId:id,excluded:[],
    items:args.codes.map((sku,i)=>({sku,productId:String(i+1),state:'DETAIL_LOW_ALREADY_SAVED'}))}]};
 }
 throw Error('UNEXPECTED_BROWSER_CALL');
});
const save=v=>fs.writeFileSync(path.join(client,'dist/native-continuation-receipt.json'),JSON.stringify({...v,calls}));
const limit=setTimeout(()=>{save({passed:false,error:'TIMEOUT'});app.exit(2)},40000);
app.whenReady().then(async()=>{
 const net=session.fromPartition('resume-fixture'),assets=require(path.join(client,'desktop/ui-assets.cjs')).createUIHandler(path.join(client,'ui'));
 net.protocol.handle('edup',r=>new URL(r.url).pathname==='/'?new Response('<!doctype html><html><head><meta charset="utf-8"></head><body><main id="view"></main></body></html>',{headers:{'Content-Type':'text/html'}}):assets(r));
 const w=new BrowserWindow({show:false,webPreferences:{partition:'resume-fixture',preload:path.join(__dirname,'native-continuation-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 await w.loadURL('edup://console/');
 const run=s=>w.webContents.executeJavaScript(s);
 const wait=async s=>{for(let i=0;i<100;i++){if(await run(s))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI_WAIT:'+s);};
 await run("import('edup://console/operations.js').then(m=>m.gigaQueries(document.querySelector('#view'),new Set(),{site:'US',siteAvailable:true}))");
 await wait("document.querySelectorAll('.listing-action-row').length===3");
 const before=await run("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='继续检查本批（复用已有结果）');return {resumeEnabled:!!b&&!b.disabled,country:document.body.textContent.includes('制造国家尚未核实'),paused:document.body.textContent.includes('模型服务暂停'),noInvent:document.body.textContent.includes('不需要你编造面料'),submittedResume:[...document.querySelectorAll('.listing-action-row')][2].textContent.includes('继续检查此商品')};})()");
 if(!before.resumeEnabled||!before.country||!before.paused||!before.noInvent||before.submittedResume)throw Error('WRONG_RENDERED_ACTIONS');
 await run("[...document.querySelectorAll('.listing-action-row')][0].querySelectorAll('button')[2].click()").catch(()=>{});
 // Locate by label, independent of the row's other controls.
 if(!await run("!!document.querySelector('dialog')"))await run("[...document.querySelectorAll('.listing-action-row')][0].querySelectorAll('button').forEach(x=>{if(x.textContent==='核对并补充')x.click()})");
 await wait("!!document.querySelector('dialog textarea')");
 await run("(()=>{const d=document.querySelector('dialog');d.querySelector('textarea').value='Fixture only: manufacturing country confirmed with supplier evidence.';[...d.querySelectorAll('button')].find(x=>x.textContent==='保存补充资料').click()})()");
 await wait("[...document.querySelector('dialog').querySelectorAll('button')].some(x=>x.textContent==='提交给AI核对并继续处理'&&!x.disabled)");
 await run("[...document.querySelector('dialog').querySelectorAll('button')].find(x=>x.textContent==='提交给AI核对并继续处理').click()");
 for(let i=0;i<50&&!calls.some(x=>x.op==='batch_chat_send');i++)await new Promise(r=>setTimeout(r,100));
 await run("document.querySelector('dialog').close();[...document.querySelectorAll('button')].find(x=>x.textContent==='继续检查本批（复用已有结果）').click()");
 await wait("document.body.textContent.includes('请先读取待核验商品的云仓资料')");
 if(resumed||await run("[...document.querySelectorAll('button')].some(x=>x.textContent==='已打开，检查并继续')"))
  throw Error('RESUME_MISSING_EVIDENCE_OPENED_BROWSER_PROMPT');
 reuseReady=true;
 await run("[...document.querySelectorAll('button')].find(x=>x.textContent==='继续检查本批（复用已有结果）').click()");
 for(let i=0;i<50&&!resumed;i++)await new Promise(r=>setTimeout(r,100));
 if(!resumed||!calls.some(x=>x.op==='batch_material_save'&&x.args.jobId===id&&x.args.sku==='WTEST1')||!calls.some(x=>x.op==='batch_chat_send'&&x.args.jobId===id))throw Error('MATERIAL_OR_RESUME_FLOW_FAILED');
 if(await run("[...document.querySelectorAll('button')].some(x=>x.textContent==='已打开，检查并继续')"))
  throw Error('RESUME_WITH_EVIDENCE_OPENED_BROWSER_PROMPT');
 clearTimeout(limit);save({passed:true,nativeProtocol:true,emptyInputHistoryResume:true,materialEditBoundToOriginalBatch:true,noBrowserPromptOnResume:true,modelAndPlatformCalls:0,userWindowTouched:false,...before});w.destroy();app.exit(0);
}).catch(e=>{clearTimeout(limit);save({passed:false,error:e.message});app.exit(1)});
