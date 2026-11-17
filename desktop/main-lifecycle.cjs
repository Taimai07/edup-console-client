const {app,BrowserWindow,protocol,ipcMain,safeStorage,dialog,shell,session,net}=require('electron');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {VERSION,API_VERSION,deviceId,signRequest}=require('../shared/protocol.cjs');
const {Logger}=require('../shared/logging.cjs');
const {Network,VPS_ORIGIN}=require('./net/network.cjs');
const {Updates}=require('./update/maintenance.cjs');
const {ProtectedState}=require('./state.cjs');
const {DiagnosticsUpload}=require('./net/diagnostics-upload.cjs');
const {UpdateController}=require('./update/update-controller.cjs');
const {registerBusinessIpc}=require('./business-ipc.cjs');
const {createWindow}=require('./main-window.cjs');
const {registerIpc}=require('./main-ipc.cjs');
const appPatch=globalThis[Symbol.for('edup.patch')];
// Startup, the signed request to the server, updates and exit. main.cjs only wires this up.
let logger,win;

// ---- isolated --self-check
// Isolated --self-check run: used by the installer, the patch health check and the native smoke tests.
function runSelfCheck({appPatch,selfCheckIndex}){
 app.whenReady().then(async()=>{
  const result={version:VERSION,apiVersion:API_VERSION,packaged:app.isPackaged,userDataBasename:path.basename(app.getPath('userData')),windowsProtection:safeStorage.isEncryptionAvailable(),patchBootstrap:!!appPatch,bootstrapVersion:appPatch?.baseVersion||null};
  const text='EDUPLINK isolated self-check';result.protectionRoundtrip=safeStorage.decryptString(safeStorage.encryptString(text))===text;
  result.uiFiles=['index.html','app.js','operations/analytics.js','settings/maintenance.js','styles.css','ai/ai.html','ai/ai.js','ai/ai.css','ai/ai-host.js','common/notices.js','operations/operations.js','settings/network-settings.js','workspace-v2.js','workspace-v2.css','settings/browser-settings.js','operations/batch-chat.js','operations/batch-progress.js','operations/materials.js'].every(n=>fs.existsSync(path.join(__dirname,'../ui',n)));
  const temp=fs.mkdtempSync(path.join(app.getPath('temp'),'edup-self-check-'));
  try{const s=new ProtectedState(temp,safeStorage);s.writeCache({products:[{sku:text}],markets:[]});fs.writeFileSync(path.join(temp,'connection.json'),'isolated');s.backup({version:VERSION,sha256:'0'.repeat(64)});result.protectedRecovery=s.inspectUpgrade(VERSION).dataPreserved&&s.readCache().products[0].sku===text&&!fs.readFileSync(s.cache).includes(Buffer.from(text));}
  finally{if(path.dirname(path.resolve(temp))!==path.resolve(app.getPath('temp')))throw Error('SELF_CHECK_PATH');fs.rmSync(temp,{recursive:true,force:true});}
  result.renderer=await require('./renderer-check.cjs').checkRenderer({app,BrowserWindow,protocol,ipcMain},path.join(__dirname,'../ui'));
  result.ok=result.protectionRoundtrip&&result.uiFiles&&result.protectedRecovery&&result.renderer.ready;fs.writeFileSync(process.argv[selfCheckIndex+1],JSON.stringify(result));if(result.ok)appPatch?.healthy(VERSION);app.exit(result.ok?0:1);
 }).catch(e=>{fs.writeFileSync(process.argv[selfCheckIndex+1],JSON.stringify({ok:false,code:e.message}));if(!appPatch?.fail('RENDERER_SELF_CHECK_FAILED'))app.exit(1);});
}
// ---- connection settings and device key
// Connection settings and the device key. `state` holds the three values that change while the app runs.
function loadDevice({userDir,safeStorage}){
 const configFile=path.join(userDir,'connection.json'),keyFile=path.join(userDir,'device-identity.bin');
 let config={serverUrl:'https://console.eduplinkaudio.com',paired:false};
 try{config=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{}
 let identity;
 const saveIdentity=()=>{if(!safeStorage.isEncryptionAvailable())throw Error('WINDOWS_PROTECTION_UNAVAILABLE');fs.writeFileSync(keyFile,safeStorage.encryptString(JSON.stringify(identity)));};
 if(fs.existsSync(keyFile)){try{identity=JSON.parse(safeStorage.decryptString(fs.readFileSync(keyFile)));}catch{throw Error('DEVICE_KEY_UNREADABLE');}}
 else{const pair=crypto.generateKeyPairSync('ed25519');identity={publicKey:pair.publicKey.export({type:'spki',format:'pem'}),privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})};saveIdentity();}
 const id=deviceId(identity.publicKey);
 return {configFile,identity,id,state:{config,installing:false,pairing:false}};
}
function validateBase(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==VPS_ORIGIN)throw Error('VPS_ENDPOINT_REQUIRED');return u.origin;}
const createSettings=({state,id,recovery,network})=>()=>({version:VERSION,apiVersion:API_VERSION,serverUrl:state.config.serverUrl,paired:state.config.paired,deviceId:id,recovery,patch:appPatch?{bootstrapVersion:appPatch.baseVersion,lastResult:appPatch.store.lastResult()}:null,proxy:network.settings});
const createSaveConfig=({configFile,state})=>()=>fs.writeFileSync(configFile,JSON.stringify(state.config,null,2));
// ---- signed request
// Signed request to the private server. Same behaviour as before the split; only the shared values arrive as arguments.
function createRequest({network,logger,state,identity,id}){
 async function request(route,body){return network.run(async()=>{
  if(!state.config.serverUrl)throw Error('请先在同步与维护中配置远程地址');
  const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),time=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
  const url=new URL('/api/'+route,validateBase(state.config.serverUrl));
  const signature=signRequest(identity.privateKey,{method,route:url.pathname,body:raw,time,nonce,version:VERSION});
  const start=Date.now();let responseReceived=false;
  try{
   const r=await network.fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'X-Edup-Device':id,'X-Edup-Time':time,'X-Edup-Nonce':nonce,'X-Edup-Signature':signature,'X-Edup-Version':VERSION,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':nonce})},body:body===undefined?undefined:raw});
   const text=await r.text();if(text.length>4*1024*1024)throw Error('RESPONSE_TOO_LARGE');const data=JSON.parse(text);responseReceived=true;
   logger.write('api_result',{route,status:r.status,requestId:data.requestId||'',durationMs:Date.now()-start});
   if(!r.ok)throw Error((data.code||'HTTP_'+r.status)+(data.outcome==='unknown'?' OUTCOME_UNKNOWN':'')+(data.requestId?' / '+data.requestId:''));
   if(route==='health'&&data.apiVersion!==API_VERSION)throw Error('API_INCOMPATIBLE');
   return data;
  }catch(e){const readonly=new Set(['status','service_status','giga_job','giga_report','thread_read','thread_list','run_read','batch_chat_read','batch_chat_list','batch_material_list','batch_material_read','file_list','file_read','memory_list','memory_read','sku_list_index','sku_list_status']);if(!responseReceived&&method==='POST'&&route==='ai'&&!readonly.has(body?.op)&&!e.message.includes('OUTCOME_UNKNOWN'))e=Error(e.message+' OUTCOME_UNKNOWN');logger.writeError('api_failed',e,{route,durationMs:Date.now()-start});throw e;}
 });}
 return request;
}
// ---- updates
// Installing an update and the automatic update prompt.
function createUpdater({win,updates,protectedState,logger,state}){
 async function installUpdate(){
  if(state.pairing)throw Error('PAIR_IN_PROGRESS');
  if(!app.isPackaged)throw Error('INSTALL_REQUIRES_PACKAGED_APP');
  if(updates.state.updateKind==='patch'){
   state.installing=true;try{const staged=updates.verifiedPatch();const backup=protectedState.backup(updates.manifest);logger.write('upgrade_backup',{count:backup.files});appPatch.store.activate(staged.id);logger.write('app_patch_restart',{version:updates.manifest.version});app.relaunch();app.quit();return {state:'restarting',updateKind:'patch'};}catch(e){state.installing=false;try{protectedState.cancelUpgrade();}catch{}throw e;}
  }
  const file=updates.verifiedInstaller();
  state.installing=true;try{const backup=protectedState.backup(updates.manifest);logger.write('upgrade_backup',{count:backup.files});const error=await shell.openPath(file);if(error)throw Error('INSTALL_DISPATCH_FAILED');logger.write('update_installer_started');app.quit();return {state:'installing'};}catch(e){state.installing=false;try{protectedState.cancelUpgrade();}catch{}throw e;}
 }
 const updateController=new UpdateController({updates,canRun:()=>!state.pairing&&!state.installing&&win?.isVisible()&&win?.isFocused(),confirm:async s=>{const r=await dialog.showMessageBox(win,{type:'question',title:'发现新版本',message:'发现新版本 '+s.version+(s.updateKind==='patch'?'，是否下载补丁并重启？':'，是否下载并安装？'),detail:s.updateKind==='patch'?'只更新应用程序，不运行安装器。重启前请保存编辑，配对和设置会保留。':'本次需要完整安装包。安装会关闭软件，请先保存编辑；配对和设置会保留。',buttons:[s.updateKind==='patch'?'更新并重启':'下载并安装','稍后再说'],defaultId:0,cancelId:1,noLink:true});return r.response===0;},install:installUpdate,progress:active=>{if(win&&!win.isDestroyed())win.setProgressBar(active?2:-1);},onError:async e=>{logger.write('update_flow_failed',{code:e.message});if(win&&!win.isDestroyed())await dialog.showMessageBox(win,{type:'warning',title:'更新未完成',message:'暂时无法完成更新，可以继续使用当前版本。',detail:'稍后可在“同步与维护”中重试。',buttons:['确定']});}});
 return {installUpdate,updateController};
}

function start({gigaBrowser}){
const selfCheckIndex=process.argv.indexOf('--self-check');
if(selfCheckIndex>=0){
 runSelfCheck({appPatch,selfCheckIndex});
}else if(!appPatch?.singleInstanceOwned&&!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',(_event,argv)=>{if(argv.includes('--background'))return;if(win){if(win.isMinimized())win.restore();win.focus();}});
app.whenReady().then(async()=>{
 const userDir=app.getPath('userData');logger=new Logger(path.join(userDir,'logs'));
 const protectedState=new ProtectedState(userDir,safeStorage);const recovery=protectedState.inspectUpgrade(VERSION);
 const device=loadDevice({userDir,safeStorage}),{state,identity,id}=device;
 const network=new Network(session.fromPartition('persist:edup-network'),{settings:state.config.proxy||{mode:'system'},logger,requester:options=>net.request(options)});await network.init();
 const updates=new Updates({fetcher:network.fetch,version:VERSION,publicKey:appPatch?.publicKey||fs.readFileSync(path.join(__dirname,'../assets/update-public.pem'),'utf8'),patchStore:appPatch?.store,dir:path.join(userDir,'updates'),logger});
 const settings=createSettings({state,id,recovery,network}),saveConfig=createSaveConfig({configFile:device.configFile,state});
 const window=createWindow({logger}),{checkSender}=window;win=window.win;
 const request=createRequest({network,logger,state,identity,id});
 const diagnosticsUpload=new DiagnosticsUpload({dir:userDir,logger,send:request,paired:()=>state.config.paired});diagnosticsUpload.start();app.on('before-quit',()=>diagnosticsUpload.close());
 registerBusinessIpc({ipcMain,checkSender,request,isInstalling:()=>state.installing});
 const {updateController,installUpdate}=createUpdater({win,updates,protectedState,logger,state});
 registerIpc({validateBase,ipcMain,checkSender,state,userDir,protectedState,gigaBrowser,logger,request,settings,saveConfig,diagnosticsUpload,network,updates,updateController,installUpdate,identity,id,win});
 win.webContents.once('did-finish-load',()=>{if(process.argv.includes('--background'))win.showInactive();else win.show();});
 win.loadURL('edup://console/');logger.write('client_started',{version:VERSION});
 const interval=setInterval(()=>updateController.run({automatic:true}),6*60*60*1000);interval.unref();setTimeout(()=>updateController.run({automatic:true}),3000).unref();
}).catch(e=>{logger?.writeError('startup_failed',e);if(appPatch?.fail('STARTUP_FAILED'))return;dialog.showErrorBox('EDUPLINK 启动失败','错误编号：'+e.message+'。请保留客户端日志以便诊断。');app.quit();});
}
process.on('uncaughtException',e=>{logger?.writeError('uncaught_exception',e);if(!appPatch?.fail('UNCAUGHT_EXCEPTION'))app.quit();});
process.on('unhandledRejection',e=>logger?.writeError('unhandled_rejection',e));
app.on('window-all-closed',()=>{if(selfCheckIndex<0)app.quit();});
}
module.exports={start};
