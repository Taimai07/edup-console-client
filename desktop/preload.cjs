const {contextBridge,ipcRenderer}=require('electron');
if(window.top===window)contextBridge.exposeInMainWorld('edup',{ready:()=>ipcRenderer.invoke('edup:ui-ready'),request:(route,body)=>ipcRenderer.invoke('edup:request',route,body),maintenance:(action,arg)=>ipcRenderer.invoke('edup:maintenance',action,arg),ai:(op,args)=>ipcRenderer.invoke('edup:ai',op,args)});
