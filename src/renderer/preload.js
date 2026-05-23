const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('familiar', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (next) => ipcRenderer.invoke('settings:set', next),
  openStorage: () => ipcRenderer.invoke('storage:open'),
  captureNow: () => ipcRenderer.invoke('capture:now'),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
});
