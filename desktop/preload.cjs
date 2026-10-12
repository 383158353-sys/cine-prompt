const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cineDesktop',{
  getWindowState:()=>ipcRenderer.invoke('cine:getWindowState'),
  setAlwaysOnTop:value=>ipcRenderer.invoke('cine:setAlwaysOnTop',value),
  hide:()=>ipcRenderer.invoke('cine:hide')
});

