const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('edup',{
  ai:(op,args)=>ipcRenderer.invoke('fixture:business',op,args),
  maintenance:(op,args)=>ipcRenderer.invoke('fixture:browser',op,args)
});
