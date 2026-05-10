// src/utils/electronBridge.js
const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;

const safeInvoke = async (fn, ...args) => {
  try {
    if (!isElectron()) return { success: false, error: 'Não está no Electron' };
    const res = await fn(...args);
    return res;
  } catch (error) {
    console.error('electronBridge error:', error);
    return { success: false, error: error.message };
  }
}

export const electronAPI = {
  setAutoLaunch: (enable) => safeInvoke(window.electronAPI.setAutoLaunch, enable),
  checkAutoLaunch: () => safeInvoke(window.electronAPI.checkAutoLaunch),
  getPrinters: () => safeInvoke(window.electronAPI.getPrinters),
  printOrder: (printerName, htmlContent) => safeInvoke(window.electronAPI.printOrder, printerName, htmlContent),
  setPowerBlocker: (enable) => safeInvoke(window.electronAPI.setPowerBlocker, enable),
  openKitchenDisplay: () => safeInvoke(window.electronAPI.openKitchenDisplay),
  pushKitchenOrders: (orders) => {
    if (!isElectron()) return
    window.electronAPI.pushKitchenOrders(orders)
  },
  onKitchenOrders: (cb) => {
    if (!isElectron()) return
    window.electronAPI.onKitchenOrders(cb)
  },
  offKitchenOrders: () => {
    if (!isElectron()) return
    window.electronAPI.offKitchenOrders()
  },
  onKitchenReady: (cb) => {
  if (!isElectron()) return
  window.electronAPI.onKitchenReady(cb)
  },
  offKitchenReady: () => {
    if (!isElectron()) return
    window.electronAPI.offKitchenReady()
  },

  sendNotification: (title, body) => safeInvoke(window.electronAPI.sendNotification, title, body),
  isElectron,
};

export default electronAPI;
