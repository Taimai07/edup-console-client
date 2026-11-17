// Hidden-window run of the 大健 query view (ui/operations/operations.js -> gigaQueries) against a scripted fake server.
// It clicks through history, refresh, bulk submit, per-product buttons, query/prepare/resume (with a fake browser
// extension) and the connection-lost path in a fixed order and records the page hash plus the calls made after every
// step, so a refactor of the operations-giga files can be compared with test/operations-giga-trace.golden.json.
process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const client=path.resolve(process.env.EDUP_CLIENT_DIR||path.join(__dirname,'..')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'edup-opsgiga-'));
app.setPath('userData',path.join(temp,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const out=process.env.EDUP_TRACE_OUT||path.join(temp,'trace.json');
const timeout=setTimeout(()=>{fs.writeFileSync(out,JSON.stringify({error:'TEST_TIMEOUT'}));app.exit(1)},110000);
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('opsgiga-test');
 isolated.protocol.handle('edup',req=>{
  const u=new URL(req.url);
  if(u.pathname==='/')return new Response('<!doctype html><meta charset="utf-8"><main><section id="view"></section></main>',{headers:{'Content-Type':'text/html'}});
  const file=path.resolve(client,'ui','.'+u.pathname);
  if(!file.startsWith(path.join(client,'ui')+path.sep)||!fs.existsSync(file))return new Response('',{status:404});
  return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'}});
 });
 const win=new BrowserWindow({show:false,focusable:false,width:1200,height:900,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_e,level,msg)=>{if(level>=2&&!msg.startsWith('Electron Security Warning'))errors.push(msg)});
 await win.loadURL('edup://console/');
 const result=await win.webContents.executeJavaScript(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const timers=[];window.setInterval=f=>{timers.push(f);return timers.length;};window.clearInterval=()=>{};
  const calls=[];let seq=0,active=[];const F={fail:false,excluded:false,decide:'queued',jobs:{}};
  const clean=v=>JSON.parse(JSON.stringify(v??null).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'<UUID>').replace(/\\d{13}/g,'<MS>'));
  const product=(code,extra={})=>({code,name:'Name '+code,currency:'USD',purchaseQuote:10,shippingQuote:2,available:5,...extra});
  const fullJob=id=>({id,rootJobId:id,state:'completed',created:1700000000,codes:['A1','A2','A3','A4','A5'],preparationMode:'ai_workflow',
   result:{preparationMode:'ai_workflow',products:[product('A1'),product('A2',{quoteScreen:'GIGA_LANDED_QUOTE_OVER_3000_USD'}),product('A3',{quoteScreen:'OTHER',currency:'x'}),product('A4'),product('A6')],
    pipeline:{items:[{sku:'A1',state:'PREVIEW_VALID'},{sku:'A2',state:'NEEDS_INPUT',attention:['x',{field:'batteries_included'}],attentionTotal:3},{sku:'A3',state:'PREVIEW_REJECTED',reason:'RULE'},{sku:'A4',state:'PREVIEW_VALID'},{sku:'A5',state:'ALREADY_SUBMITTED'},{sku:'A6',state:'PREVIEW_VALID',latestAttempt:{x:1}}]}},
   childJobs:[],submissions:[{items:[{sku:'A3',state:'needs_review',operationId:'op3'},{sku:'A4',state:'accepted',operationId:'op4'},{sku:'A5',state:'needs_reconciliation'},{sku:'A6',state:'queued'}]}]});
  const ai=async(op,args)=>{
   calls.push([op,clean(args)]);
   if(op==='service_status')return {giga:{buyerReviews:[{sku:'A9',asin:'B0ABCDEFGH',state:'offer_verified_page_review_pending'},{sku:'A8',asin:'B0ABCDEFGI',state:'x'}]}};
   if(op==='batch_chat_list')return {batches:[{id:'J1',created:1700000000,codes:['A1','A2','A3','A4','A5']},{id:'J0',created:1690000000,codes:['A7']}]};
   if(op==='giga_job'){if(F.fail)throw Error('NETWORK_DOWN');if(F.jobs[args.id])return F.jobs[args.id];if(args.id==='J1'||args.id==='J0')return fullJob(args.id);return {id:args.id,rootJobId:args.id,state:'completed',codes:active,result:{products:active.map(c=>product(c))}};}
   if(op==='giga_query'||op==='giga_prepare'||op==='giga_reverify'){const id='JN'+(++seq);return {id,rootJobId:id,state:'queued'};}
   if(op==='proposal_prepare'){
    if(args.action.operation==='giga_batch_import')return {id:'P1',hash:'h1',state:'prepared',preview:{items:[{sku:'A1',price:'12.5',quantity:3},{sku:'A4',price:'9',quantity:0}],skipped:[{sku:'A5',reason:'PRICING_RULE_CHANGED_REPREPARE'},{sku:'A6',reason:'OTHER'}]}};
    return {id:'P2',hash:'h2',state:'preparing',jobId:'J1',note:'note'};}
   if(op==='proposal_decide'){if(F.decide==='not_admitted')return {proposal:{state:'rejected',result:JSON.stringify({outcome:'not_admitted',code:'NOT_ADMITTED'})}};return {proposal:{state:F.decide}};}
   if(op==='operation_readback')return {state:'verified',note:'ok'};
   throw Error('UNEXPECTED_'+op);};
  const maint=async(op,args)=>{
   calls.push(['M:'+op,clean(args)]);
   if(op==='giga-browser-status')return {connected:true,extensionProtocol:4,accountScopeV2:false,inspection:{loggedIn:true,buyer:true,countryCode:'USA'}};
   if(op==='giga-browser-start'){active=args.codes;return {id:'T'+(++seq)};}
   if(op==='giga-browser-task')return {state:'verified',site:'US',codes:active,items:active.map(sku=>({sku})),screenId:'fixture',excluded:F.excluded?[{sku:active[0],reason:'RECONCILIATION_PENDING',rate:'high'}]:[]};
   if(op==='giga-open-buyer-page')return {};
   throw Error('UNEXPECTED_M_'+op);};
  window.edup={ai,maintenance:maint};
  const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  const view=document.querySelector('#view'),trace=[],errs=[];let seen=0;
  const settle=async(n=4)=>{for(let i=0;i<n;i++)await sleep(40);};
  const snap=async label=>{const calls2=calls.slice(seen);seen=calls.length;const html=view.outerHTML.replace(/2026[/][0-9]+[/][0-9]+ [0-9]+:[0-9]+:[0-9]+/g,'<NOW>');trace.push([label,html.length,await sha(html),await sha(JSON.stringify(calls2)),calls2.map(c=>c[0]).join(',')]);};
  const btn=t=>[...view.querySelectorAll('button')].filter(b=>b.textContent===t);
  const step=async(label,fn,wait=4)=>{try{await fn()}catch(e){errs.push(label+': '+e.message)}await settle(wait);await snap(label);};
  const click=(t,i=0)=>()=>{const b=btn(t)[i];if(!b)throw Error('NO_BUTTON '+t);b.click();};
  const ops=await import('edup://console/operations/operations.js');
  const codes=new Set(['B1','B2','B3']);
  const GUIDE='已打开，检查并继续';
  const until=async(cond,n=80)=>{for(let i=0;i<n;i++){if(cond())return true;await sleep(50);}return false;};
  const run=(text,i=0)=>async()=>{const b=btn(text)[i];if(!b)throw Error('NO_BUTTON '+text);b.click();await until(()=>btn(GUIDE).length,60);if(btn(GUIDE).length)btn(GUIDE)[0].click();await sleep(100);await until(()=>!btn(GUIDE).length&&!btn('读取云仓详情、报价和库存')[0]?.disabled,100);};
  const mount=async(label,opts={})=>{view.replaceChildren();seen=calls.length;await step(label,()=>ops.gigaQueries(view,codes,{site:'US',siteAvailable:true,...opts}),12);};
  await mount('mount');
  await step('poll timer',()=>timers.at(-1)());
  await step('refresh button',click('刷新结果'));
  await step('bulk submit',click('一键提交这 2 款商品'),8);
  await step('submit A1 prepare',click('提交到亚马逊'),6);
  await step('readback',click('核对亚马逊结果'),6);
  await step('continue one',run('继续检查此商品'),6);
  await step('supplement',click('补充或修改资料'),6);
  await step('explain',click('查看处理说明'),6);
  await step('open buyer page',click('打开买家页面'));
  await step('history change',()=>{const h=view.querySelector('select');h.value='J0';h.dispatchEvent(new Event('change',{bubbles:true}));},8);
  await step('query',run('读取云仓详情、报价和库存'),6);
  await step('prepare',run('AI准备并检查上架'),6);
  await step('resume',run('继续检查本批（复用已有结果）'),6);
  F.excluded=true;
  await step('query with reconcile hold',run('读取云仓详情、报价和库存'),6);
  await step('retry reconcile',()=>{const b=btn('再试一次')[0];if(b)b.click();},12);
  F.excluded=false;
  F.decide='rejected';F.decide='not_admitted';
  await step('bulk submit not admitted',click('一键提交这 2 款商品'),8);
  F.fail=true;
  await step('refresh while offline',click('刷新结果'),8);
  await step('poll while offline',()=>timers.at(-1)());
  F.fail=false;
  await step('refresh recovered',click('刷新结果'),8);
  // a second mount with other options
  await mount('mount offline',{offline:true});
  await mount('mount site unavailable',{siteAvailable:false,siteChecking:true,site:'DE'});
  await mount('mount read on mount',{readOnMount:true});
  await settle(30);await snap('read on mount settled');
  return {trace,errs,calls:calls.length};
 })()`);
 result.consoleErrors=errors;
 clearTimeout(timeout);
 fs.writeFileSync(out,JSON.stringify(result,null,1));
 app.exit(0);
}).catch(e=>{fs.writeFileSync(out,JSON.stringify({error:String(e&&e.stack||e)}));app.exit(2);});
