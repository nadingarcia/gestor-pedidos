import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import AutoLaunch from 'auto-launch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Corrige erro de GPU no Linux
app.disableHardwareAcceleration()

let mainWindow

const autoLauncher = new AutoLaunch({
  name: 'Gestor de Pedidos NexFood',
  path: app.getPath('exe'),
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Gestor de Pedidos - NexFood',
    icon: path.join(__dirname, '../public/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    backgroundColor: '#0f172a',
    show: false,
  })

  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    //mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 🔹 Auto launch
ipcMain.handle('set-auto-launch', async (event, enable) => {
  try {
    if (enable) {
      await autoLauncher.enable()
      return { success: true, message: 'Auto-inicialização habilitada' }
    } else {
      await autoLauncher.disable()
      return { success: true, message: 'Auto-inicialização desabilitada' }
    }
  } catch (error) {
    console.error('Erro ao configurar auto-inicialização:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('check-auto-launch', async () => {
  try {
    const isEnabled = await autoLauncher.isEnabled()
    return { enabled: isEnabled }
  } catch (error) {
    console.error('Erro ao verificar auto-inicialização:', error)
    return { enabled: false }
  }
})

// 🔹 Impressoras
// main.js (trecho relevante)
ipcMain.handle('get-printers', async () => {
  try {
    if (!mainWindow) return { success: false, printers: [], error: 'mainWindow não disponível' }
    const printers = await mainWindow.webContents.getPrintersAsync()
    return { success: true, printers } // <-- formato consistente
  } catch (error) {
    console.error('Erro ao buscar impressoras:', error)
    return { success: false, printers: [], error: error.message }
  }
})


// 🔹 Impressão
ipcMain.handle('print-order', async (event, { printerName, html }) => {
  try {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    })

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    const options = {
      silent: true,
      printBackground: true,
      deviceName: printerName || undefined,
    }

    win.webContents.print(options, (success, failureReason) => {
      if (!success) console.error('Erro na impressão:', failureReason)
      win.close()
    })

    return { success: true, message: 'Impressão iniciada' }
  } catch (error) {
    console.error('Erro ao imprimir:', error)
    return { success: false, error: error.message }
  }
})

// 🔹 Notificações
ipcMain.handle('send-notification', async (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        icon: path.join(__dirname, '../public/logo.png'),
      })
      notification.show()
      return { success: true }
    } else {
      return { success: false, error: 'Notificações não suportadas' }
    }
  } catch (error) {
    console.error('Erro ao enviar notificação:', error)
    return { success: false, error: error.message }
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
