// electron/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auto launch
  setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),
  checkAutoLaunch: () => ipcRenderer.invoke('check-auto-launch'),

  // Impressoras
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Impressão
  printOrder: (printerName, html) => ipcRenderer.invoke('print-order', { printerName, html }),

  // Notificações
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', { title, body }),

  // Pequeno utilitário
  isElectron: true
});
