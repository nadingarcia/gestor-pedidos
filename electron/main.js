import { app, BrowserWindow, ipcMain, Notification, dialog, Menu, powerSaveBlocker } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import AutoLaunch from 'auto-launch'

// 🔹 CORREÇÃO AQUI: Importação compatível com ESM
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

import log from 'electron-log'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

Menu.setApplicationMenu(null)

// 🔹 CONFIGURAÇÃO DE LOG E UPDATER
log.transports.file.level = 'info'
autoUpdater.logger = log

// IMPORTANTE:
autoUpdater.autoDownload = true 
autoUpdater.autoInstallOnAppQuit = true

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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

 mainWindow.once('ready-to-show', () => {
  mainWindow.show()
  
  if (!isDev) {
    try {
      log.info('App pronto. Verificando atualizações...')
      autoUpdater.checkForUpdatesAndNotify()
    } catch (err) {
      log.error('Erro ao verificar atualizações:', err)
    }
  }
})

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 🔹 EVENTOS DO AUTO-UPDATER

autoUpdater.on('checking-for-update', () => {
  log.info('Verificando se há atualizações...')
})

autoUpdater.on('update-available', (info) => {
  log.info('Atualização disponível:', info)
  if (mainWindow) mainWindow.webContents.send('update_available')
})

autoUpdater.on('update-not-available', () => {
  log.info('Nenhuma atualização disponível.')
})

autoUpdater.on('error', (err) => {
  log.error('Erro na atualização:', err)
})

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = "Velocidade de download: " + progressObj.bytesPerSecond
  log_message = log_message + ' - Baixado ' + progressObj.percent + '%'
  log.info(log_message)
})

autoUpdater.on('update-downloaded', () => {
  log.info('Atualização baixada.')
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Atualização Disponível',
    message: 'Uma nova versão do Gestor de Pedidos foi baixada. Deseja reiniciar e atualizar agora?',
    buttons: ['Sim, Reiniciar', 'Depois']
  }).then((returnValue) => {
    if (returnValue.response === 0) {
      autoUpdater.quitAndInstall(false, true)
    }
  })
})


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
ipcMain.handle('get-printers', async () => {
  try {
    if (!mainWindow) return { success: false, printers: [], error: 'mainWindow não disponível' }
    const printers = await mainWindow.webContents.getPrintersAsync()
    return { success: true, printers }
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
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    // Escreve em arquivo temporário (evita limite do data: URL)
    const os = await import('os')
    const fs = await import('fs')
    const tmpPath = path.join(os.default.tmpdir(), `nexfood_print_${Date.now()}.html`)
    fs.default.writeFileSync(tmpPath, html, 'utf-8')

    await win.loadFile(tmpPath)

    // Aguarda renderização completa antes de imprimir
    await new Promise(resolve => setTimeout(resolve, 500))

    return await new Promise((resolve) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerName || undefined,
          margins: { marginType: 'none' },
          pageSize: {
            width: 72000,  // 72mm em micrômetros
            height: 297000 // altura grande, a impressora corta automaticamente
          },
          // Garante que não vai escalar/encolher o conteúdo
          scaleFactor: 100,
        },
        (success, failureReason) => {
          // Limpa arquivo temp
          try { fs.default.unlinkSync(tmpPath) } catch {}
          win.destroy()

          if (!success) {
            log.error('Erro na impressão:', failureReason)
            resolve({ success: false, error: failureReason })
          } else {
            resolve({ success: true })
          }
        }
      )
    })

  } catch (error) {
    log.error('Erro ao imprimir:', error)
    return { success: false, error: error.message }
  }
})

let powerBlockerId = null

ipcMain.handle('set-power-blocker', (_, enable) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { active: false }  // ← adiciona essa linha
  
  if (enable && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    log.info('Power blocker ativo, id:', powerBlockerId)
  } else if (!enable && powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId)
    powerBlockerId = null
    log.info('Power blocker desativado')
  }
  return { active: powerBlockerId !== null }
})

// 🔹 Display da cozinha
let kitchenWindow = null

ipcMain.handle('open-kitchen-display', () => {
  if (kitchenWindow && !kitchenWindow.isDestroyed()) {
    kitchenWindow.focus()
    return { success: true, alreadyOpen: true }
  }

  kitchenWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Cozinha — NexFood',
    icon: path.join(__dirname, '../public/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    backgroundColor: '#111827',
    show: false,
  })

  const isDev = process.env.NODE_ENV === 'development'
  const url = isDev
    ? 'http://localhost:5173/#/kitchen'
    : `file://${path.join(__dirname, '../dist/index.html')}#/kitchen`

  kitchenWindow.loadURL(url)
  kitchenWindow.once('ready-to-show', () => {
    kitchenWindow.show()
    kitchenWindow.setFullScreen(true)
  })
  kitchenWindow.webContents.on('did-finish-load', () => {
  mainWindow?.webContents.send('kitchen-ready')
})
  kitchenWindow.on('closed', () => { kitchenWindow = null })

  return { success: true }
})

// Recebe pedidos do renderer principal e repassa para a janela da cozinha
ipcMain.on('push-kitchen-orders', (_, orders) => {
  if (kitchenWindow && !kitchenWindow.isDestroyed()) {
    kitchenWindow.webContents.send('kitchen-orders', orders)
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