// Hidden-window run of the listing workspace (ui/listing/listing-app.js -> mountListing) against a scripted fake server and
// fake 大健 browser extension. It drives lists, wizard, list page, groups, runner banner and the uploaded page in a
// fixed order and records the page hash plus the calls made after every step, so a refactor of the listing-app files
// can be compared with test/listing-app-trace.golden.json.
process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});
const {app,BrowserWindow,protocol,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const client=path.resolve(process.env.EDUP_CLIENT_DIR||path.join(__dirname,'..')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'edup-listingapp-'));
app.setPath('userData',path.join(temp,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const out=process.env.EDUP_TRACE_OUT||path.join(temp,'trace.json');
const timeout=setTimeout(()=>{fs.writeFileSync(out,JSON.stringify({error:'TEST_TIMEOUT'}));app.exit(1)},140000);
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('listingapp-test');
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
  const timers=[];const realSetInterval=window.setInterval.bind(window);window.setInterval=f=>{timers.push(f);return timers.length;};window.clearInterval=()=>{};
  localStorage.setItem('edup:listing:pace:v2',JSON.stringify({restMinutes:0,hourly:0,daily:0}));
  const calls=[];let seq=0,active=[];const F={offline:false,browserDown:false};
  const clean=v=>JSON.parse(JSON.stringify(v??null).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'<UUID>').replace(/\\d{13}/g,'<MS>').replace(/\\d{10}/g,'<S>'));
  const codesOf=n=>Array.from({length:n},(_,i)=>'WT'+String(1000+i));
  const call=async(op,args)=>{
   calls.push([op,clean(args)]);
   if(F.offline)throw Error('NETWORK_DOWN');
   if(op==='service_status')return {listingSites:{sites:[{code:'US',name:'美国'},{code:'DE',name:'德国'}]},storage:{}};
   if(op==='batch_chat_list')return {batches:[]};
   if(op==='sku_list_save'||op==='sku_list_backup')return {id:args.id,site:args.site,saved:true,items:(args.codes||[]).map(sku=>({sku,stage:'not_started'}))};
   if(op==='sku_list_status')return {id:args.id,site:'US',items:[]};
   if(op==='sku_list_list')return {lists:[]};
   if(op==='giga_query'){return {id:args.requestId,rootJobId:args.requestId,state:'queued'};}
   if(op==='giga_job')return {id:args.id,rootJobId:args.id,state:'completed',created:1700000000,codes:active,result:{products:active.map(c=>({code:c,name:'N '+c,currency:'USD',purchaseQuote:5,shippingQuote:1,available:3}))}};
   return {};};
  window.edup={ai:call,maintenance:async(op,args)=>{
   calls.push(['M:'+op,clean(args)]);
   if(op==='giga-browser-status')return F.browserDown?{connected:false}:{connected:true,extensionProtocol:4,accountScopeV2:false,inspection:{loggedIn:true,buyer:true,countryCode:'USA'}};
   if(op==='giga-browser-start'){active=args.codes;return {id:'T'+(++seq)};}
   if(op==='giga-browser-task')return {state:'verified',site:'US',codes:active,items:active.map(sku=>({sku})),screenId:'fixture',excluded:[]};
   if(op==='giga-browser-folder')return {directory:'fixture-folder'};
   if(op==='giga-browser-copy-folder')return {copied:true};
   if(op==='extract-codes'){const m=[...new Set(args.text.match(/W[A-Z0-9]{3,}/g)||[])];return {items:m.map(code=>({code,reason:'x',occurrences:1})),duplicates:0};}
   if(op==='listing-event')return {};
   return {};}};
  try{Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{calls.push(['clipboard',t.length])}},configurable:true});}catch{}
  const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  const view=document.querySelector('#view'),trace=[],errs=[],notes=[];let seen=0;
  const settle=async(n=5)=>{for(let i=0;i<n;i++)await sleep(40);};
  const maskDates=s=>s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'<UUID>').replace(/20\\d\\d[-/年]\\d+[-/月]\\d+[日]?[ T]?\\d*:?\\d*:?\\d*/g,'<D>').replace(/\\d+:\\d+(:\\d+)?/g,'<T>');
  const snap=async label=>{const c2=calls.slice(seen);seen=calls.length;const html=maskDates(view.outerHTML);trace.push([label,html.length,await sha(html),await sha(JSON.stringify(c2)),c2.map(c=>c[0]).join(',')]);};
  const q=s=>[...view.querySelectorAll(s)];
  const btn=(t,i=0)=>q('button').filter(b=>b.textContent===t||b.textContent.trim()===t)[i];
  const step=async(label,fn,wait=5)=>{try{await fn()}catch(e){errs.push(label+': '+e.message)}await settle(wait);await snap(label);};
  const click=(t,i=0)=>()=>{const b=btn(t,i);if(!b)throw Error('NO_BUTTON '+t);b.click();};
  const type=(sel,v,ev='input')=>()=>{const e=q(sel)[0];if(!e)throw Error('NO_INPUT '+sel);e.value=v;e.dispatchEvent(new Event(ev,{bubbles:true}));};
  const check=(sel,i=0)=>()=>{const e=q(sel)[i];if(!e)throw Error('NO_CHECK '+sel);e.click();};
  const until=async(cond,n=120)=>{for(let i=0;i<n;i++){if(cond())return true;await sleep(50);}return false;};
  const {mountListing}=await import('edup://console/listing/listing-app.js');
  const {local,runner}=await import('edup://console/listing/listing-runner.js');
  window.testRunner=runner;
  // a saved list that is already in storage, so the lists page has something to show
  local.saveList({id:'seed-list',site:'US',source:'local',kind:'prepare',label:'Seed list',codes:codesOf(7),jobs:[],created:1700000000,backupId:'seed-backup',backup:'saved'});
  local.ensureGroups('seed-list');
  const handle=mountListing(view,{call,getSnapshot:()=>({products:[]}),isOffline:()=>F.offline});
  await handle.store.refreshService();await handle.store.refreshBrowser();
  await step('before show',()=>{});
  await step('show',()=>handle.show(),12);
  await step('timer tick',()=>timers.at(-1)(),10);
  await step('nav uploaded',click('已上传合格'));
  await step('nav lists',click('清单'));
  await step('pill open',()=>q('.lst-pill')[0].click());
  await step('help recheck',click('重新检查'),8);
  await step('help copy',click('复制目录'),8);
  await step('pill close',()=>q('.lst-pill')[0].click());
  await step('open seed list',click('打开'),8);
  await step('filter retry',()=>q('.lst-chips button')[2].click());
  await step('filter all',()=>q('.lst-chips button')[0].click());
  await step('search',type('input[type=search]','WT100'));
  await step('search clear',type('input[type=search]',''));
  await step('select one',check('.lst-products input[type=checkbox]',0));
  await step('select two',check('.lst-products input[type=checkbox]',1));
  await step('bulk skip',()=>{const b=q('.lst-bulk button').find(x=>x.textContent.startsWith('不筛'));if(!b)throw Error('NO_BULK');b.click();},8);
  await step('restore',()=>{const b=q('.lst-products button').find(x=>x.textContent==='恢复');if(!b)throw Error('NO_RESTORE');b.click();},6);
  await step('select all groups',click('全选组'));
  await step('clear groups',click('清空选择'));
  await step('group check',check('input[aria-label^="选择"]',0));
  await step('run groups',async()=>{const b=q('button').find(x=>x.textContent.startsWith('执行选中的'));if(!b)throw Error('NO_RUN');b.click();await until(()=>runner.state.phase!=='idle'&&runner.state.phase!=='running'&&runner.state.phase!=='queued',200);notes.push('phase '+runner.state.phase);},10);
  await step('banner dismiss',click('知道了'),6);
  await step('view group',click('查看本组'),8);
  await step('back to lists',click('← 返回'),8);
  await step('nav new',click('新建清单')||click('清单'),6);
  await step('wizard tab store',click('大健店铺'),8);
  await step('wizard tab file',click('选文件'),6);
  await step('wizard tab paste',click('粘贴文字'),6);
  await step('wizard paste',type('textarea','WA1111 WB2222 WC3333 junk WA1111'),4);
  await step('wizard extract',click('识别编码'),8);
  await step('wizard label',type('input[aria-label="清单名称"]','My new list'),4);
  await step('wizard next',click('下一步'),6);
  await step('wizard recheck',click('重新检查'),10);
  await step('wizard back',click('上一步'),6);
  await step('wizard next again',click('下一步'),6);
  await step('wizard next 3',click('下一步'),6);
  await step('wizard save',()=>{const b=q('button').find(x=>x.textContent.startsWith('保存 '));if(!b)throw Error('NO_SAVE');b.click();},12);
  await step('backup button',()=>{const b=btn('备份到服务器');if(b)b.click();},8);
  F.offline=true;
  await step('go offline',()=>handle.store.touch(),8);
  await step('timer tick offline',()=>timers.at(-1)(),8);
  F.offline=false;F.browserDown=true;
  await step('browser down',async()=>{await handle.store.refreshBrowser();handle.store.touch();},8);
  await step('open help for wizard',click('打开连接说明'),6);
  F.browserDown=false;
  await step('recover',async()=>{await handle.store.refreshBrowser();handle.store.touch();},8);
  await step('nav lists again',click('清单'),8);
  await step('hide',()=>handle.hide());
  await step('site change',()=>{handle.show();const s=q('select')[0];s.value='DE';s.dispatchEvent(new Event('change',{bubbles:true}));},12);
  await step('refresh handle',()=>handle.refresh(),10);
  await step('nav uploaded 2',click('已上传合格'),6);
  await step('copy skus',click('复制全部 SKU'),6);
  return {trace,errs:errs.concat(notes),calls:calls.length};
 })()`);
 result.consoleErrors=errors;
 clearTimeout(timeout);
 fs.writeFileSync(out,JSON.stringify(result,null,1));
 app.exit(0);
}).catch(e=>{fs.writeFileSync(out,JSON.stringify({error:String(e&&e.stack||e)}));app.exit(2);});
