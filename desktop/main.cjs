const {createUIHandler}=require('./ui-assets.cjs');
const {DiagnosticsUpload}=require('./diagnostics-upload.cjs');
const appPatch=globalThis[Symbol.for('edup.patch')];
const {buildZiniaoRoute}=require('./ziniao.cjs');
const {Network,VPS_ORIGIN}=require('./network.cjs');
const {app,BrowserWindow,protocol,ipcMain,safeStorage,dialog,shell,Menu,session,net}=require('electron');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {VERSION,API_VERSION,deviceId,pairMessage,signRequest}=require('../shared/protocol.cjs');
const {Logger}=require('../shared/logging.cjs');
const {Updates}=require('./maintenance.cjs');
const {ProtectedState}=require('./state.cjs');
const {extractCodes,fileText}=require('./import.cjs');
const {UpdateController}=require('./update-controller.cjs');
const {template:menuTemplate}=require('./menu.cjs');
const {validateAIRequest}=require('../shared/ai-contract.cjs');
const {GigaBrowser}=require('./giga-browser.cjs');
const gigaBrowser=new GigaBrowser();
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let logger,win;
const selfCheckIndex=process.argv.indexOf('--self-check');
if(selfCheckIndex>=0){
 app.whenReady().then(async()=>{
  const result={version:VERSION,apiVersion:API_VERSION,packaged:app.isPackaged,userDataBasename:path.basename(app.getPath('userData')),windowsProtection:safeStorage.isEncryptionAvailable(),patchBootstrap:!!appPatch,bootstrapVersion:appPatch?.baseVersion||null};
  const text='EDUPLINK isolated self-check';result.protectionRoundtrip=safeStorage.decryptString(safeStorage.encryptString(text))===text;
  result.uiFiles=['index.html','app.js','analytics.js','maintenance.js','styles.css','ai.html','ai.js','ai.css','ai-host.js','notices.js','operations.js','network-settings.js','workspace-v2.js','workspace-v2.css','browser-settings.js','batch-chat.js','batch-progress.js','materials.js'].every(n=>fs.existsSync(path.join(__dirname,'../ui',n)));
  const temp=fs.mkdtempSync(path.join(app.getPath('temp'),'edup-self-check-'));
  try{const s=new ProtectedState(temp,safeStorage);s.writeCache({products:[{sku:text}],markets:[]});fs.writeFileSync(path.join(temp,'connection.json'),'isolated');s.backup({version:VERSION,sha256:'0'.repeat(64)});result.protectedRecovery=s.inspectUpgrade(VERSION).dataPreserved&&s.readCache().products[0].sku===text&&!fs.readFileSync(s.cache).includes(Buffer.from(text));}
  finally{if(path.dirname(path.resolve(temp))!==path.resolve(app.getPath('temp')))throw Error('SELF_CHECK_PATH');fs.rmSync(temp,{recursive:true,force:true});}
  result.renderer=await require('./renderer-check.cjs').checkRenderer({app,BrowserWindow,protocol,ipcMain},path.join(__dirname,'../ui'));
  result.ok=result.protectionRoundtrip&&result.uiFiles&&result.protectedRecovery&&result.renderer.ready;fs.writeFileSync(process.argv[selfCheckIndex+1],JSON.stringify(result));if(result.ok)appPatch?.healthy(VERSION);app.exit(result.ok?0:1);
 }).catch(e=>{fs.writeFileSync(process.argv[selfCheckIndex+1],JSON.stringify({ok:false,code:e.message}));if(!appPatch?.fail('RENDERER_SELF_CHECK_FAILED'))app.exit(1);});
}else if(!appPatch?.singleInstanceOwned&&!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',(_event,argv)=>{if(argv.includes('--background'))return;if(win){if(win.isMinimized())win.restore();win.focus();}});
app.whenReady().then(async()=>{
 const userDir=app.getPath('userData');logger=new Logger(path.join(userDir,'logs'));
 const protectedState=new ProtectedState(userDir,safeStorage);const recovery=protectedState.inspectUpgrade(VERSION);let installing=false,pairing=false;
 const configFile=path.join(userDir,'connection.json'),keyFile=path.join(userDir,'device-identity.bin');
 let config={serverUrl:'https://console.eduplinkaudio.com',paired:false};
 try{config=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{}
 let identity;
 const saveIdentity=()=>{if(!safeStorage.isEncryptionAvailable())throw Error('WINDOWS_PROTECTION_UNAVAILABLE');fs.writeFileSync(keyFile,safeStorage.encryptString(JSON.stringify(identity)));};
 if(fs.existsSync(keyFile)){try{identity=JSON.parse(safeStorage.decryptString(fs.readFileSync(keyFile)));}catch{throw Error('DEVICE_KEY_UNREADABLE');}}
 else{const pair=crypto.generateKeyPairSync('ed25519');identity={publicKey:pair.publicKey.export({type:'spki',format:'pem'}),privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})};saveIdentity();}
 const id=deviceId(identity.publicKey);
 const network=new Network(session.fromPartition('persist:edup-network'),{settings:config.proxy||{mode:'system'},logger,requester:options=>net.request(options)});await network.init();
 const updates=new Updates({fetcher:network.fetch,version:VERSION,publicKey:appPatch?.publicKey||fs.readFileSync(path.join(__dirname,'../assets/update-public.pem'),'utf8'),patchStore:appPatch?.store,dir:path.join(userDir,'updates'),logger});
 function validateBase(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==VPS_ORIGIN)throw Error('VPS_ENDPOINT_REQUIRED');return u.origin;}
 const settings=()=>({version:VERSION,apiVersion:API_VERSION,serverUrl:config.serverUrl,paired:config.paired,deviceId:id,recovery,patch:appPatch?{bootstrapVersion:appPatch.baseVersion,lastResult:appPatch.store.lastResult()}:null,proxy:network.settings});
 const saveConfig=()=>fs.writeFileSync(configFile,JSON.stringify(config,null,2));
 protocol.handle('edup',createUIHandler(path.join(__dirname,'../ui'),{missing:route=>logger.write('ui_asset_missing',{route,code:'UI_ASSET_NOT_FOUND'})}));
 win=new BrowserWindow({show:false,width:1320,height:880,minWidth:980,minHeight:680,title:'EDUPLINK 运营工作台',icon:path.join(__dirname,'../assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({about:()=>dialog.showMessageBox(win,{type:'info',title:'关于运营工作台',message:'EDUPLINK 运营工作台',detail:'版本 '+VERSION+'\n个人自用',buttons:['确定']})})));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const trustedUrl=url=>{try{const u=new URL(url);return u.protocol==='edup:'&&u.host==='console';}catch{return false;}};
 win.webContents.on('will-navigate',(e,url)=>{if(!trustedUrl(url))e.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
 win.webContents.on('render-process-gone',(_e,details)=>logger.write('renderer_gone',{code:details.reason}));
 win.webContents.on('unresponsive',()=>logger.write('window_unresponsive'));
 function checkSender(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trustedUrl(event.senderFrame.url))throw Error('IPC_SOURCE_INVALID');}
 async function request(route,body){return network.run(async()=>{
  if(!config.serverUrl)throw Error('请先在同步与维护中配置远程地址');
  const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),time=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
  const url=new URL('/api/'+route,validateBase(config.serverUrl));
  const signature=signRequest(identity.privateKey,{method,route:url.pathname,body:raw,time,nonce,version:VERSION});
  const start=Date.now();let responseReceived=false;
  try{
   const r=await network.fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'X-Edup-Device':id,'X-Edup-Time':time,'X-Edup-Nonce':nonce,'X-Edup-Signature':signature,'X-Edup-Version':VERSION,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':nonce})},body:body===undefined?undefined:raw});
   const text=await r.text();if(text.length>4*1024*1024)throw Error('RESPONSE_TOO_LARGE');const data=JSON.parse(text);responseReceived=true;
   logger.write('api_result',{route,status:r.status,requestId:data.requestId||'',durationMs:Date.now()-start});
   if(!r.ok)throw Error((data.code||'HTTP_'+r.status)+(data.outcome==='unknown'?' OUTCOME_UNKNOWN':'')+(data.requestId?' / '+data.requestId:''));
   if(route==='health'&&data.apiVersion!==API_VERSION)throw Error('API_INCOMPATIBLE');
   return data;
  }catch(e){const readonly=new Set(['status','service_status','giga_job','giga_report','thread_read','thread_list','run_read','batch_chat_read','batch_chat_list','batch_material_list','batch_material_read','file_list','file_read','memory_list','memory_read']);if(!responseReceived&&method==='POST'&&route==='ai'&&!readonly.has(body?.op)&&!e.message.includes('OUTCOME_UNKNOWN'))e=Error(e.message+' OUTCOME_UNKNOWN');logger.writeError('api_failed',e,{route,durationMs:Date.now()-start});throw e;}
 });}
 const diagnosticsUpload=new DiagnosticsUpload({dir:userDir,logger,send:request,paired:()=>config.paired});diagnosticsUpload.start();app.on('before-quit',()=>diagnosticsUpload.close());
 ipcMain.handle('edup:request',async(event,route,body)=>{checkSender(event);if(installing&&body!==undefined)throw Error('UPDATE_INSTALLING');if(!['snapshot','health','drafts','diagnostics'].includes(route)||(route==='drafts')!==(body!==undefined))throw Error('IPC_ROUTE_INVALID');return request(route,body);});
 ipcMain.handle('edup:ai',async(event,op,args)=>{checkSender(event);if(installing)throw Error('UPDATE_INSTALLING');return request('ai',validateAIRequest(op,args));});
 async function installUpdate(){
  if(pairing)throw Error('PAIR_IN_PROGRESS');
  if(!app.isPackaged)throw Error('INSTALL_REQUIRES_PACKAGED_APP');
  if(updates.state.updateKind==='patch'){
   installing=true;try{const staged=updates.verifiedPatch();const backup=protectedState.backup(updates.manifest);logger.write('upgrade_backup',{count:backup.files});appPatch.store.activate(staged.id);logger.write('app_patch_restart',{version:updates.manifest.version});app.relaunch();app.quit();return {state:'restarting',updateKind:'patch'};}catch(e){installing=false;try{protectedState.cancelUpgrade();}catch{}throw e;}
  }
  const file=updates.verifiedInstaller();
  installing=true;try{const backup=protectedState.backup(updates.manifest);logger.write('upgrade_backup',{count:backup.files});const error=await shell.openPath(file);if(error)throw Error('INSTALL_DISPATCH_FAILED');logger.write('update_installer_started');app.quit();return {state:'installing'};}catch(e){installing=false;try{protectedState.cancelUpgrade();}catch{}throw e;}
 }
 const updateController=new UpdateController({updates,canRun:()=>!pairing&&!installing&&win?.isVisible()&&win?.isFocused(),confirm:async s=>{const r=await dialog.showMessageBox(win,{type:'question',title:'发现新版本',message:'发现新版本 '+s.version+(s.updateKind==='patch'?'，是否下载补丁并重启？':'，是否下载并安装？'),detail:s.updateKind==='patch'?'只更新应用程序，不运行安装器。重启前请保存编辑，配对和设置会保留。':'本次需要完整安装包。安装会关闭软件，请先保存编辑；配对和设置会保留。',buttons:[s.updateKind==='patch'?'更新并重启':'下载并安装','稍后再说'],defaultId:0,cancelId:1,noLink:true});return r.response===0;},install:installUpdate,progress:active=>{if(win&&!win.isDestroyed())win.setProgressBar(active?2:-1);},onError:async e=>{logger.write('update_flow_failed',{code:e.message});if(win&&!win.isDestroyed())await dialog.showMessageBox(win,{type:'warning',title:'更新未完成',message:'暂时无法完成更新，可以继续使用当前版本。',detail:'稍后可在“同步与维护”中重试。',buttons:['确定']});}});
 ipcMain.handle('edup:maintenance',async(event,action,arg)=>{
  checkSender(event);
  if(installing)throw Error('UPDATE_INSTALLING');
  if(action==='giga-browser-status')return gigaBrowser.status();
  if(action==='giga-browser-start')return gigaBrowser.start(arg);
  if(action==='giga-browser-task')return gigaBrowser.task(arg?.id);
  if(action==='settings')return settings();
  if(action==='ai-view-get'){try{const state=JSON.parse(fs.readFileSync(path.join(userDir,'ai-view.json'),'utf8'));if(!state||!state.drafts||typeof state.drafts!=='object'||Array.isArray(state.drafts)||(state.thread!==null&&!/^[a-f0-9-]{36}$/.test(state.thread)))throw Error('AI_VIEW_INVALID');return state;}catch{return {thread:null,drafts:{}};}}
  if(action==='ai-view-save'){if(!arg||!arg.drafts||typeof arg.drafts!=='object'||Array.isArray(arg.drafts)||(arg.thread!==null&&!/^[a-f0-9-]{36}$/.test(arg.thread)))throw Error('AI_VIEW_INVALID');const drafts={};for(const [key,value]of Object.entries(arg.drafts).slice(-20)){if((key==='_new'||/^[a-f0-9-]{36}$/.test(key))&&typeof value==='string'&&value.length<=12000)drafts[key]=value;}const dest=path.join(userDir,'ai-view.json'),tmp=dest+'.tmp';fs.writeFileSync(tmp,JSON.stringify({thread:arg.thread,drafts}),{mode:0o600});fs.renameSync(tmp,dest);return {saved:true};}

  if(action==='log-upload-status')return diagnosticsUpload.status();
  if(action==='upload-error-logs')return diagnosticsUpload.tick();
  if(action==='ziniao-settings')return {binding:config.ziniao?.[arg?.site]||null};
  if(action==='ziniao-save-binding'){
   const b=arg?.binding;if(!b||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||b.confirmed!==true)throw Error('STORE_BINDING_NOT_VERIFIED');
   const binding={name:b.name,account:'EDUPLINK / A',site:arg.site,storeId:b.storeId,userId:b.userId,version:b.version,verified:true,loggedInUserId:b.userId,verification:'user_confirmed'};
   buildZiniaoRoute({account:'EDUPLINK / A',site:arg.site,sku:'binding-check',binding});config.ziniao={...config.ziniao,[arg.site]:binding};saveConfig();return {saved:true};
  }
  if(action==='ziniao-open'){
   const r=buildZiniaoRoute({account:'EDUPLINK / A',site:arg?.site,sku:arg?.sku,binding:config.ziniao?.[arg?.site]});
   try{await shell.openExternal(r.protocolUrl);}catch{throw Error('ZINIAO_OPEN_FAILED');}logger.write('ziniao_open_requested',{state:'user_click'});return {requested:true};
  }

  if(action==='set-proxy'){
   if(pairing||updates.state.state==='downloading'||updateController.pending)throw Error('NETWORK_BUSY');
   await network.apply(arg);config.proxy=network.settings;saveConfig();return {settings:network.settings};
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
   const r=await dialog.showOpenDialog(win,{title:'选择含商品编码的文件',properties:['openFile'],filters:[{name:'商品编码文档',extensions:['txt','csv','tsv','docx','xlsx']}]});
   if(r.canceled)return {canceled:true};return {...extractCodes(fileText(r.filePaths[0])),filename:path.basename(r.filePaths[0])};
  }
  if(action==='read-cache')return protectedState.readCache();
  if(action==='write-cache')return protectedState.writeCache(arg);
  if(action==='configure'){const base=validateBase(arg?.serverUrl);if(base!==config.serverUrl){config={...config,serverUrl:base,paired:false};saveConfig();}return settings();}
  if(action==='pair'){
   if(pairing)throw Error('PAIR_IN_PROGRESS');pairing=true;
   try{
   if(!config.serverUrl||typeof arg?.code!=='string')throw Error('PAIR_ARGUMENT');
   const code=arg.code.trim(),publicKey=identity.publicKey,signature=crypto.sign(null,Buffer.from(pairMessage(code,publicKey)),identity.privateKey).toString('base64');
   await network.run(async()=>{const r=await network.fetch(new URL('/api/pair',config.serverUrl),{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({code,publicKey,signature})});
   const data=await r.json();if(!r.ok)throw Error(data.code||'PAIR_FAILED');if(data.deviceId!==id)throw Error('PAIR_IDENTITY_MISMATCH');});
   config.paired=true;saveConfig();logger.write('device_paired',{deviceId:id});return settings();
   }finally{pairing=false;}
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
   const payload={format:2,createdAt:new Date().toISOString(),client:{version:VERSION,apiVersion:API_VERSION,electron:process.versions.electron,platform:process.platform,arch:process.arch,paired:config.paired},...logger.export(),server};
   fs.writeFileSync(result.filePath,JSON.stringify(payload,null,2));return {saved:true};
  }
  throw Error('IPC_ACTION_INVALID');
 });
 let uiReady=false;const uiTimer=setTimeout(()=>{if(uiReady)return;logger.write('ui_startup_failed',{code:'RENDERER_NOT_READY'});if(appPatch?.fail('RENDERER_NOT_READY'))return;dialog.showErrorBox('界面未能打开','请重新打开软件，或用最新版安装包覆盖安装。你的资料会保留。');},45000);uiTimer.unref();
 ipcMain.handle('edup:ui-ready',event=>{checkSender(event);if(uiReady)return {ready:true};uiReady=true;clearTimeout(uiTimer);protectedState.confirmUi();appPatch?.healthy(VERSION);logger.write('ui_ready',{version:VERSION});return {ready:true};});
 win.webContents.once('did-finish-load',()=>{if(process.argv.includes('--background'))win.showInactive();else win.show();});
 win.loadURL('edup://console/');logger.write('client_started',{version:VERSION});
 const interval=setInterval(()=>updateController.run({automatic:true}),6*60*60*1000);interval.unref();setTimeout(()=>updateController.run({automatic:true}),3000).unref();
}).catch(e=>{logger?.writeError('startup_failed',e);if(appPatch?.fail('STARTUP_FAILED'))return;dialog.showErrorBox('EDUPLINK 启动失败','错误编号：'+e.message+'。请保留客户端日志以便诊断。');app.quit();});
}
process.on('uncaughtException',e=>{logger?.writeError('uncaught_exception',e);if(!appPatch?.fail('UNCAUGHT_EXCEPTION'))app.quit();});
process.on('unhandledRejection',e=>logger?.writeError('unhandled_rejection',e));
app.on('window-all-closed',()=>{if(selfCheckIndex<0)app.quit();});

