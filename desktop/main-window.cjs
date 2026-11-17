const {BrowserWindow,protocol,dialog,Menu}=require('electron');
const path=require('node:path');
const {VERSION}=require('../shared/protocol.cjs');
const {createUIHandler}=require('./ui-assets.cjs');
const {template:menuTemplate}=require('./menu.cjs');
// The one window, the edup:// protocol, the menu, and the check that an IPC call really came from our own page.
function createWindow({logger}){
 protocol.handle('edup',createUIHandler(path.join(__dirname,'../ui'),{missing:route=>logger.write('ui_asset_missing',{route,code:'UI_ASSET_NOT_FOUND'})}));
 const win=new BrowserWindow({show:false,width:1320,height:880,minWidth:980,minHeight:680,title:'EDUPLINK 运营工作台',icon:path.join(__dirname,'../assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({about:()=>dialog.showMessageBox(win,{type:'info',title:'关于运营工作台',message:'EDUPLINK 运营工作台',detail:'版本 '+VERSION+'\n个人自用',buttons:['确定']})})));
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const trustedUrl=url=>{try{const u=new URL(url);return u.protocol==='edup:'&&u.host==='console';}catch{return false;}};
 win.webContents.on('will-navigate',(e,url)=>{if(!trustedUrl(url))e.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));
 win.webContents.on('render-process-gone',(_e,details)=>logger.write('renderer_gone',{code:details.reason}));
 win.webContents.on('unresponsive',()=>logger.write('window_unresponsive'));
 function checkSender(event){if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trustedUrl(event.senderFrame.url))throw Error('IPC_SOURCE_INVALID');}
 return {win,checkSender};
}
module.exports={createWindow};
