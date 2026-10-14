const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cineDesktop',{
  hide:()=>ipcRenderer.invoke('cine:hide')
});

