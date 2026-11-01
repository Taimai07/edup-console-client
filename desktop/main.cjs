const {app,BrowserWindow,protocol,ipcMain,safeStorage,dialog,shell}=require('electron');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {VERSION,API_VERSION,deviceId,pairMessage,signRequest}=require('../shared/protocol.cjs');
const {Logger}=require('../shared/logging.cjs');
const {Updates}=require('./maintenance.cjs');
const {ProtectedState}=require('./state.cjs');
const {extractCodes,fileText}=require('./import.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'edup',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let logger,win;
const selfCheckIndex=process.argv.indexOf('--self-check');
if(selfCheckIndex>=0){
 app.whenReady().then(()=>{
  const result={version:VERSION,apiVersion:API_VERSION,packaged:app.isPackaged,userDataBasename:path.basename(app.getPath('userData')),windowsProtection:safeStorage.isEncryptionAvailable()};
  const text='EDUPLINK isolated self-check';result.protectionRoundtrip=safeStorage.decryptString(safeStorage.encryptString(text))===text;
  result.uiFiles=['index.html','app.js','analytics.js','maintenance.js','styles.css'].every(n=>fs.existsSync(path.join(__dirname,'../ui',n)));
  const temp=fs.mkdtempSync(path.join(app.getPath('temp'),'edup-self-check-'));
  try{const s=new ProtectedState(temp,safeStorage);s.writeCache({products:[{sku:text}],markets:[]});fs.writeFileSync(path.join(temp,'connection.json'),'isolated');s.backup({version:VERSION,sha256:'0'.repeat(64)});result.protectedRecovery=s.inspectUpgrade(VERSION).dataPreserved&&s.readCache().products[0].sku===text&&!fs.readFileSync(s.cache).includes(Buffer.from(text));}
  finally{if(path.dirname(path.resolve(temp))!==path.resolve(app.getPath('temp')))throw Error('SELF_CHECK_PATH');fs.rmSync(temp,{recursive:true,force:true});}
  result.ok=result.protectionRoundtrip&&result.uiFiles&&result.protectedRecovery;fs.writeFileSync(process.argv[selfCheckIndex+1],JSON.stringify(result));app.exit(result.ok?0:1);
 }).catch(()=>app.exit(1));
}else if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.whenReady().then(()=>{
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
 const updates=new Updates({version:VERSION,publicKey:fs.readFileSync(path.join(__dirname,'../assets/update-public.pem'),'utf8'),dir:path.join(userDir,'updates'),logger});
 function validateBase(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'|| !(u.protocol==='https:'||(process.env.EDUP_DEV==='1'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('HTTPS_SERVER_REQUIRED');return u.origin;}
 const settings=()=>({version:VERSION,apiVersion:API_VERSION,serverUrl:config.serverUrl,paired:config.paired,deviceId:id,recovery});
 const saveConfig=()=>fs.writeFileSync(configFile,JSON.stringify(config,null,2));
 protocol.handle('edup',req=>{
  const u=new URL(req.url),files={'/':'index.html','/app.js':'app.js','/analytics.js':'analytics.js','/maintenance.js':'maintenance.js','/styles.css':'styles.css'};
  if(u.host!=='console'||!files[u.pathname])return new Response('Not found',{status:404});
  const type=u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html';
  return new Response(fs.readFileSync(path.join(__dirname,'../ui',files[u.pathname])),{headers:{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:"}});
 });
 win=new BrowserWindow({width:1320,height:880,minWidth:980,minHeight:680,title:'EDUPLINK 运营工作台',icon:path.join(__dirname,'../assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const trustedUrl=url=>{try{const u=new URL(url);return u.protocol==='edup:'&&u.host==='console';}catch{return false;}};
 win.webContents.on('will-navigate',(e,url)=>{if(!trustedUrl(url))e.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
 win.webContents.on('render-process-gone',(_e,details)=>logger.write('renderer_gone',{code:details.reason}));
 win.webContents.on('unresponsive',()=>logger.write('window_unresponsive'));
 function checkSender(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trustedUrl(event.senderFrame.url))throw Error('IPC_SOURCE_INVALID');}
 async function request(route,body){
  if(!config.serverUrl)throw Error('请先在同步与维护中配置远程地址');
  const method=body===undefined?'GET':'POST',raw=body===undefined?'':JSON.stringify(body),time=String(Date.now()),nonce=crypto.randomBytes(16).toString('hex');
  const url=new URL('/api/'+route,validateBase(config.serverUrl));
  const signature=signRequest(identity.privateKey,{method,route:url.pathname,body:raw,time,nonce,version:VERSION});
  const start=Date.now();
  try{
   const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{'X-Edup-Device':id,'X-Edup-Time':time,'X-Edup-Nonce':nonce,'X-Edup-Signature':signature,'X-Edup-Version':VERSION,...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':nonce})},body:body===undefined?undefined:raw});
   const text=await r.text();if(text.length>4*1024*1024)throw Error('RESPONSE_TOO_LARGE');const data=JSON.parse(text);
   logger.write('api_result',{route,status:r.status,requestId:data.requestId||'',durationMs:Date.now()-start});
   if(!r.ok)throw Error((data.code||'HTTP_'+r.status)+(data.requestId?' / '+data.requestId:''));
   if(route==='health'&&data.apiVersion!==API_VERSION)throw Error('API_INCOMPATIBLE');
   return data;
  }catch(e){logger.write('api_failed',{route,code:e.name||'REQUEST_FAILED'});throw e;}
 }
 ipcMain.handle('edup:request',async(event,route,body)=>{checkSender(event);if(installing&&body!==undefined)throw Error('UPDATE_INSTALLING');if(!['snapshot','health','drafts','diagnostics'].includes(route)||(route==='drafts')!==(body!==undefined))throw Error('IPC_ROUTE_INVALID');return request(route,body);});
 ipcMain.handle('edup:maintenance',async(event,action,arg)=>{
  checkSender(event);
  if(installing)throw Error('UPDATE_INSTALLING');
  if(action==='settings')return settings();
  if(action==='extract-codes')return extractCodes(arg?.text);
  if(action==='extract-document'){
   const r=await dialog.showOpenDialog(win,{title:'选择含商品编码的文件',properties:['openFile'],filters:[{name:'商品编码文档',extensions:['txt','csv','tsv','docx','xlsx']}]});
   if(r.canceled)return {canceled:true};return {...extractCodes(fileText(r.filePaths[0])),filename:path.basename(r.filePaths[0])};
  }
  if(action==='read-cache')return protectedState.readCache();
  if(action==='write-cache')return protectedState.writeCache(arg);
  if(action==='configure'){const base=validateBase(arg?.serverUrl);if(base!==config.serverUrl){config={serverUrl:base,paired:false};saveConfig();}return settings();}
  if(action==='pair'){
   if(pairing)throw Error('PAIR_IN_PROGRESS');pairing=true;
   try{
   if(!config.serverUrl||typeof arg?.code!=='string')throw Error('PAIR_ARGUMENT');
   const code=arg.code.trim(),publicKey=identity.publicKey,signature=crypto.sign(null,Buffer.from(pairMessage(code,publicKey)),identity.privateKey).toString('base64');
   const r=await fetch(new URL('/api/pair',config.serverUrl),{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({code,publicKey,signature})});
   const data=await r.json();if(!r.ok)throw Error(data.code||'PAIR_FAILED');if(data.deviceId!==id)throw Error('PAIR_IDENTITY_MISMATCH');
   config.paired=true;saveConfig();logger.write('device_paired',{deviceId:id});return settings();
   }finally{pairing=false;}
  }
  if(action==='update-status')return updates.state;
  if(action==='check-update')return updates.check();
  if(action==='download-update')return updates.download();
  if(action==='install-update'){
   if(pairing)throw Error('PAIR_IN_PROGRESS');
   if(!app.isPackaged)throw Error('INSTALL_REQUIRES_PACKAGED_APP');
   const file=updates.verifiedInstaller();
   installing=true;try{const backup=protectedState.backup(updates.manifest);logger.write('upgrade_backup',{count:backup.files});const error=await shell.openPath(file);if(error)throw Error('INSTALL_DISPATCH_FAILED');logger.write('update_installer_started');app.quit();return {state:'installing'};}catch(e){installing=false;try{protectedState.cancelUpgrade();}catch{}throw e;}
  }
  if(action==='diagnostics'){
   const result=await dialog.showSaveDialog(win,{title:'导出诊断包（不含商品数据或密钥）',defaultPath:'EDUPLINK-diagnostics-'+new Date().toISOString().slice(0,10)+'.json',filters:[{name:'JSON',extensions:['json']}]});
   if(result.canceled||!result.filePath)return {saved:false};
   let server;try{server=await request('diagnostics');}catch{server={state:'unavailable'};}
   const payload={format:1,createdAt:new Date().toISOString(),client:{version:VERSION,apiVersion:API_VERSION,electron:process.versions.electron,platform:process.platform,arch:process.arch,paired:config.paired},logs:logger.recent(100),server};
   fs.writeFileSync(result.filePath,JSON.stringify(payload,null,2));return {saved:true};
  }
  throw Error('IPC_ACTION_INVALID');
 });
 win.webContents.once('did-finish-load',()=>{try{protectedState.confirmUi();}catch(e){logger.write('upgrade_receipt_failed',{code:e.message});}});
 win.loadURL('edup://console/');logger.write('client_started',{version:VERSION});
 const interval=setInterval(()=>updates.check(),6*60*60*1000);interval.unref();setTimeout(()=>updates.check(),10000).unref();
}).catch(e=>{logger?.write('startup_failed',{code:e.message});dialog.showErrorBox('EDUPLINK 启动失败','错误编号：'+e.message+'。请保留客户端日志以便诊断。');app.quit();});
}
process.on('uncaughtException',e=>{logger?.write('uncaught_exception',{code:e.name});app.quit();});
process.on('unhandledRejection',e=>logger?.write('unhandled_rejection',{code:e?.name||'PROMISE_REJECTED'}));
app.on('window-all-closed',()=>app.quit());
