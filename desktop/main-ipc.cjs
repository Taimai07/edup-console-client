const {dialog,shell,session,net,clipboard}=require('electron');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {VERSION,API_VERSION,pairMessage}=require('../shared/protocol.cjs');
const {Network}=require('./net/network.cjs');
const {buildZiniaoRoute}=require('./net/ziniao.cjs');
const {extractCodes,fileText,importCodes}=require('./import.cjs');
const appPatch=globalThis[Symbol.for('edup.patch')];
// The 'edup:maintenance' channel and 'edup:ui-ready': the handler bodies are the ones that used to sit in main.cjs.
// `state` carries config/installing/pairing, which change while the app runs.
function registerIpc({validateBase,ipcMain,checkSender,state,userDir,protectedState,gigaBrowser,logger,request,settings,saveConfig,diagnosticsUpload,network,updates,updateController,installUpdate,identity,id,win}){
 ipcMain.handle('edup:maintenance',async(event,action,arg)=>{
  checkSender(event);
  if(state.installing)throw Error('UPDATE_INSTALLING');
  if(action==='giga-browser-status')return gigaBrowser.status();
  if(action==='giga-browser-folder'){try{return {directory:gigaBrowser.folder()};}catch{return {directory:null};}}
  if(action==='giga-browser-copy-folder'){clipboard.writeText(gigaBrowser.folder());return {copied:true};}
  if(action==='giga-browser-start')return gigaBrowser.start(arg);
  if(action==='giga-store-start')return gigaBrowser.startStore(arg);
  if(action==='giga-browser-task')return gigaBrowser.task(arg?.id);
  if(action==='giga-browser-reconcile')return gigaBrowser.reconcileFavorites(arg?.id);
  if(action==='giga-open-buyer-page'){
   if(typeof arg?.asin!=='string'||!/^[A-Z0-9]{10}$/.test(arg.asin))throw Error('GIGA_BUYER_PAGE_INVALID');
   await shell.openExternal('https://www.amazon.com/dp/'+arg.asin);return {requested:true};
  }
  if(action==='giga-browser-reuse')return gigaBrowser.reusableFavorites(arg);
  // The listing runner reports why it waited or set a segment aside; errors.jsonl is what the diagnostics upload sends.
  if(action==='listing-event'){const code=typeof arg?.code==='string'&&/^[A-Z][A-Z0-9_]{2,79}$/.test(arg.code)?arg.code:'LISTING_EVENT_INVALID';logger.write('listing_runner_problem',{level:'error',code,state:['browser','segment','preparation','verification'].includes(arg?.step)?arg.step:'unknown',...(Number.isInteger(arg?.segment)&&arg.segment>0&&arg.segment<100000?{count:arg.segment}:{})});return {logged:true};}
  if(action==='giga-browser-screen'){
   const evidence=gigaBrowser.task(arg?.id);
   if(evidence.state!=='rates_read')throw Error('GIGA_RETURN_SCREEN_REQUIRED');
   const screen=await request('ai',{op:'giga_screen',args:{site:evidence.site,evidence}});
   return gigaBrowser.startApproved(evidence,screen);
  }
  if(action==='settings')return settings();
  if(action==='ai-view-get'){try{const state=JSON.parse(fs.readFileSync(path.join(userDir,'ai-view.json'),'utf8'));if(!state||!state.drafts||typeof state.drafts!=='object'||Array.isArray(state.drafts)||(state.thread!==null&&!/^[a-f0-9-]{36}$/.test(state.thread)))throw Error('AI_VIEW_INVALID');return state;}catch{return {thread:null,drafts:{}};}}
  if(action==='ai-view-save'){if(!arg||!arg.drafts||typeof arg.drafts!=='object'||Array.isArray(arg.drafts)||(arg.thread!==null&&!/^[a-f0-9-]{36}$/.test(arg.thread)))throw Error('AI_VIEW_INVALID');const drafts={};for(const [key,value]of Object.entries(arg.drafts).slice(-20)){if((key==='_new'||/^[a-f0-9-]{36}$/.test(key))&&typeof value==='string'&&value.length<=12000)drafts[key]=value;}const dest=path.join(userDir,'ai-view.json'),tmp=dest+'.tmp';fs.writeFileSync(tmp,JSON.stringify({thread:arg.thread,drafts}),{mode:0o600});fs.renameSync(tmp,dest);return {saved:true};}

  if(action==='log-upload-status')return diagnosticsUpload.status();
  if(action==='upload-error-logs')return diagnosticsUpload.tick();
  if(action==='ziniao-settings')return {binding:state.config.ziniao?.[arg?.site]||null};
  if(action==='ziniao-save-binding'){
   const b=arg?.binding;if(!b||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||b.confirmed!==true)throw Error('STORE_BINDING_NOT_VERIFIED');
   const binding={name:b.name,account:'EDUPLINK / A',site:arg.site,storeId:b.storeId,userId:b.userId,version:b.version,verified:true,loggedInUserId:b.userId,verification:'user_confirmed'};
   buildZiniaoRoute({account:'EDUPLINK / A',site:arg.site,sku:'binding-check',binding});state.config.ziniao={...state.config.ziniao,[arg.site]:binding};saveConfig();return {saved:true};
  }
  if(action==='ziniao-open'){
   const r=buildZiniaoRoute({account:'EDUPLINK / A',site:arg?.site,sku:arg?.sku,binding:state.config.ziniao?.[arg?.site]});
   try{await shell.openExternal(r.protocolUrl);}catch{throw Error('ZINIAO_OPEN_FAILED');}logger.write('ziniao_open_requested',{state:'user_click'});return {requested:true};
  }

  if(action==='set-proxy'){
   if(state.pairing||updates.state.state==='downloading'||updateController.pending)throw Error('NETWORK_BUSY');
   await network.apply(arg);state.config.proxy=network.settings;saveConfig();return {settings:network.settings};
  }
  if(action==='test-proxy'){
   const targets={server:'https://console.eduplinkaudio.com/updates/v3/stable.json'};
   if(!targets[arg?.target])throw Error('PROXY_TEST_TARGET_INVALID');
   const temp=new Network(session.fromPartition('edup-proxy-test-'+crypto.randomUUID()),{settings:arg.settings,requester:options=>net.request(options)});
   try{await temp.init();return await temp.diagnose(targets[arg.target]);}finally{await temp.session.closeAllConnections();}
  }

  if(action==='upload-material'){
   const r=await dialog.showOpenDialog(win,{title:'为这个商品选择补充资料',properties:['openFile'],filters:[{name:'文字资料（不读取内嵌图片或公式）',extensions:['txt','csv','tsv','docx','xlsx']}]});if(r.canceled)return {cancelled:true};const file=r.filePaths[0];if(fs.statSync(file).size>512*1024)throw Error('MATERIAL_FILE_LIMIT_512KB');const bytes=fs.readFileSync(file),content=fileText(file);if(Buffer.byteLength(content)>64000)throw Error('MATERIAL_TEXT_LIMIT_64KB');return request('ai',validateAIRequest('batch_material_save',{jobId:arg.jobId,sku:arg.sku,label:path.basename(file),base64:bytes.toString('base64'),text:content}));
  }
  if(action==='extract-codes')return extractCodes(arg?.text);
  if(action==='extract-document'){
   const r=await dialog.showOpenDialog(win,{title:'选择含商品编码的文件',properties:['openFile'],filters:[{name:'商品编码文档',extensions:['txt','csv','tsv','docx','xls','xlsx']}]});
   if(r.canceled)return {canceled:true};return {...await importCodes(r.filePaths[0]),filename:path.basename(r.filePaths[0])};
  }
  if(action==='read-cache')return protectedState.readCache();
  if(action==='write-cache')return protectedState.writeCache(arg);
  if(action==='configure'){const base=validateBase(arg?.serverUrl);if(base!==state.config.serverUrl){state.config={...state.config,serverUrl:base,paired:false};saveConfig();}return settings();}
  if(action==='pair'){
   if(state.pairing)throw Error('PAIR_IN_PROGRESS');state.pairing=true;
   try{
   if(!state.config.serverUrl||typeof arg?.code!=='string')throw Error('PAIR_ARGUMENT');
   const code=arg.code.trim(),publicKey=identity.publicKey,signature=crypto.sign(null,Buffer.from(pairMessage(code,publicKey)),identity.privateKey).toString('base64');
   await network.run(async()=>{const r=await network.fetch(new URL('/api/pair',state.config.serverUrl),{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({code,publicKey,signature})});
   const data=await r.json();if(!r.ok)throw Error(data.code||'PAIR_FAILED');if(data.deviceId!==id)throw Error('PAIR_IDENTITY_MISMATCH');});
   state.config.paired=true;saveConfig();logger.write('device_paired',{deviceId:id});return settings();
   }finally{state.pairing=false;}
  }
  if(action==='update-status')return updates.state;
  if(action==='check-and-install-update'){
   return updateController.run();
  }
  if(action==='check-update')return updates.check();
  if(action==='download-update')return updates.download();
  if(action==='install-update')return installUpdate();
  if(action==='diagnostics'){
   const result=await dialog.showSaveDialog(win,{title:'导出诊断包（不含商品数据或密钥）',defaultPath:'EDUPLINK-diagnostics-'+new Date().toISOString().slice(0,10)+'.json',filters:[{name:'JSON',extensions:['json']}]});
   if(result.canceled||!result.filePath)return {saved:false};
   let server;try{server=await request('diagnostics');}catch{server={state:'unavailable'};}
   const payload={format:2,createdAt:new Date().toISOString(),client:{version:VERSION,apiVersion:API_VERSION,electron:process.versions.electron,platform:process.platform,arch:process.arch,paired:state.config.paired},...logger.export(),server};
   fs.writeFileSync(result.filePath,JSON.stringify(payload,null,2));return {saved:true};
  }
  throw Error('IPC_ACTION_INVALID');
 });
 let uiReady=false;const uiTimer=setTimeout(()=>{if(uiReady)return;logger.write('ui_startup_failed',{code:'RENDERER_NOT_READY'});if(appPatch?.fail('RENDERER_NOT_READY'))return;dialog.showErrorBox('界面未能打开','请重新打开软件，或用最新版安装包覆盖安装。你的资料会保留。');},45000);uiTimer.unref();
 ipcMain.handle('edup:ui-ready',event=>{checkSender(event);if(uiReady)return {ready:true};uiReady=true;clearTimeout(uiTimer);protectedState.confirmUi();appPatch?.healthy(VERSION);logger.write('ui_ready',{version:VERSION});return {ready:true};});
}
module.exports={registerIpc};
