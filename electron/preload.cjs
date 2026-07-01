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

  setPowerBlocker: (enable) => ipcRenderer.invoke('set-power-blocker', enable),

  openKitchenDisplay: () => ipcRenderer.invoke('open-kitchen-display'),
  pushKitchenOrders: (orders) => ipcRenderer.send('push-kitchen-orders', orders),
  onKitchenOrders: (cb) => ipcRenderer.on('kitchen-orders', (_, orders) => cb(orders)),
  offKitchenOrders: () => ipcRenderer.removeAllListeners('kitchen-orders'),
  onKitchenReady: (cb) => ipcRenderer.on('kitchen-ready', () => cb()),
  offKitchenReady: () => ipcRenderer.removeAllListeners('kitchen-ready'),

  // Notificações
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', { title, body }),
  onUpdateAvailable: (cb) => ipcRenderer.on('update_available', (_, info) => cb(info)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update_download_progress', (_, progress) => cb(progress)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update_downloaded', () => cb()),
  offUpdaterEvents: () => {
    ipcRenderer.removeAllListeners('update_available');
    ipcRenderer.removeAllListeners('update_download_progress');
    ipcRenderer.removeAllListeners('update_downloaded');
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  

  // Pequeno utilitário
  isElectron: true
});
