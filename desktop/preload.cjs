const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('edup',{request:(route,body)=>ipcRenderer.invoke('edup:request',route,body),maintenance:(action,arg)=>ipcRenderer.invoke('edup:maintenance',action,arg)});
