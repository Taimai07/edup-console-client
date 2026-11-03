// Exercise the production protocol and renderer graph without user data or network.
const path=require('node:path');
const {createUIHandler}=require('./ui-assets.cjs');
async function checkRenderer({app,BrowserWindow,protocol,ipcMain},dir){
 const failures=[];protocol.handle('edup',createUIHandler(dir,{missing:p=>failures.push(p)}));
 const w=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const handles=['edup:request','edup:maintenance','edup:ai','edup:ui-ready'];let ready;
 const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('RENDERER_NOT_READY')),15000);ready=()=>{clearTimeout(timer);resolve();};w.webContents.once('render-process-gone',()=>{clearTimeout(timer);reject(Error('RENDERER_EXITED'));});});
 ipcMain.handle('edup:request',()=>{throw Error('OFFLINE_ACCEPTANCE');});
 ipcMain.handle('edup:maintenance',(_e,action)=>action==='settings'?{version:'self-check',paired:false,serverUrl:'https://console.eduplinkaudio.com',proxy:{mode:'system'}}:action==='read-cache'?null:{});
 ipcMain.handle('edup:ai',()=>({threads:[],configured:false}));
 ipcMain.handle('edup:ui-ready',event=>{if(event.sender!==w.webContents||event.senderFrame!==w.webContents.mainFrame)throw Error('CHECK_SENDER');ready();return {ready:true};});
 try{await w.loadURL('edup://console/');await promise;const state=await w.webContents.executeJavaScript("({ready:document.documentElement.dataset.edupReady==='true',navigation:document.querySelectorAll('#nav button').length,hasSettings:[...document.querySelectorAll('#nav button')].some(x=>x.textContent==='同步与维护')})");if(!state.ready||state.navigation!==7||!state.hasSettings||failures.some(x=>/\.(js|css|html)$/.test(x)))throw Error('RENDERER_CHECK_FAILED');return {...state,offline:true};}
 finally{for(const name of handles)ipcMain.removeHandler(name);protocol.unhandle('edup');w.destroy();}
}
module.exports={checkRenderer};
