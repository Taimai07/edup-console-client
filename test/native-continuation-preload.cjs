const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('edup',{ai:(op,args)=>ipcRenderer.invoke('fixture:call',op,args)});
