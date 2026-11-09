import { app, BrowserWindow, ipcMain, Notification, dialog, Menu, powerSaveBlocker, shell } from 'electron'
import path from 'path'
import os from 'os'
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
const hasSingleInstanceLock = app.requestSingleInstanceLock()

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
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
    backgroundColor: '#0f172a',
    show: false,
  })

  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    mainWindow.loadURL('http://localhost:5175')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()
    if (url !== currentUrl && (url.startsWith('http://') || url.startsWith('https://'))) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // No Linux com Wayland (e aceleração desligada) o 'ready-to-show' pode nunca chegar: a página carrega,
  // mas a janela ficava escondida para sempre, e a busca de atualização junto. Mostra no primeiro sinal.
  let janelaMostrada = false
  const mostrarJanela = () => {
    if (janelaMostrada || !mainWindow || mainWindow.isDestroyed()) return
    janelaMostrada = true
    mainWindow.show()

    if (!isDev) {
      try {
        log.info('App pronto. Verificando atualizações...')
        autoUpdater.checkForUpdatesAndNotify()
      } catch (err) {
        log.error('Erro ao verificar atualizações:', err)
      }
    }
  }
  mainWindow.once('ready-to-show', mostrarJanela)
  mainWindow.webContents.once('did-finish-load', () => setTimeout(mostrarJanela, 300))
  setTimeout(mostrarJanela, 5000)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow()
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  mainWindow.flashFrame(false)
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    log.info('Segunda instância bloqueada; focando a janela principal.')
    showMainWindow()
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
  if (mainWindow) mainWindow.webContents.send('update_download_progress', {
    percent: progressObj.percent,
    transferred: progressObj.transferred,
    total: progressObj.total,
  })
})

// Atualizar pelo celular: o dono pede, o gestor baixa e reinicia sozinho (sem a pergunta "Deseja reiniciar?")
let atualizacaoBaixada = null
let instalarAoBaixar = false
// Silencioso (/S) e reabrindo sozinho: sem isso o NSIS assistido (oneClick: false) abre o assistente e fica esperando alguém clicar
const instalarAtualizacao = () => autoUpdater.quitAndInstall(true, true)
const reiniciarParaAtualizar = () => setTimeout(instalarAtualizacao, 3000)

autoUpdater.on('update-downloaded', (info) => {
  log.info('Atualização baixada.')
  atualizacaoBaixada = info?.version || 'nova'
  if (mainWindow) mainWindow.webContents.send('update_downloaded')
  if (instalarAoBaixar) {
    log.info('Atualização pedida pelo celular: reiniciando para instalar.')
    reiniciarParaAtualizar()
    return
  }
  
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Atualização Disponível',
    message: 'Uma nova versão do Gestor de Pedidos foi baixada. Deseja reiniciar e atualizar agora?',
    buttons: ['Sim, Reiniciar', 'Depois']
  }).then((returnValue) => {
    if (returnValue.response === 0) {
      instalarAtualizacao()
    }
  })
})

// Responde na hora; quando já está baixada, reinicia 3 s depois (dá tempo de avisar o celular)
ipcMain.handle('atualizar-agora', async () => {
  if (!app.isPackaged) return { estado: 'dev', versao: app.getVersion() }
  try {
    if (atualizacaoBaixada) {
      reiniciarParaAtualizar()
      return { estado: 'instalando', versao: atualizacaoBaixada }
    }
    const resultado = await autoUpdater.checkForUpdates()
    const nova = resultado?.updateInfo?.version
    if (!resultado?.isUpdateAvailable || !nova) return { estado: 'atualizado', versao: app.getVersion() }
    instalarAoBaixar = true // autoDownload já começou a baixar; instala quando terminar
    return { estado: 'baixando', versao: nova }
  } catch (err) {
    log.error('Erro ao atualizar pelo celular:', err)
    return { estado: 'erro', erro: err?.message || 'Falha ao procurar atualização' }
  }
})

ipcMain.handle('install-update', () => {
  instalarAtualizacao()
  return { success: true }
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
const LIMITE_IMPRESSAO_MS = 30 * 1000

ipcMain.handle('print-order', (event, { printerName, html }) => new Promise((resolve) => {
  let win = null
  let tmpPath = null
  let encerrado = false
  let fs = null

  // Primeiro resultado vale: resposta que chegar depois do tempo limite é ignorada
  const encerrar = (resultado) => {
    if (encerrado) return
    encerrado = true
    clearTimeout(tempoLimite)
    if (tmpPath) { try { fs.default.unlinkSync(tmpPath) } catch {} }
    if (win && !win.isDestroyed()) win.destroy()
    resolve(resultado)
  }

  // webContents.print pode nunca chamar o callback: sem isto, o pedido ficava "Imprimindo" para sempre
  const tempoLimite = setTimeout(() => {
    log.error('Impressão sem resposta em', LIMITE_IMPRESSAO_MS, 'ms na impressora', printerName)
    encerrar({ success: false, error: 'A impressora não respondeu' })
  }, LIMITE_IMPRESSAO_MS)

  ;(async () => {
    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      })

      // Escreve em arquivo temporário (evita limite do data: URL)
      const os = await import('os')
      fs = await import('fs')
      tmpPath = path.join(os.default.tmpdir(), `nexfood_print_${Date.now()}.html`)
      fs.default.writeFileSync(tmpPath, html, 'utf-8')

      await win.loadFile(tmpPath)

      // Aguarda renderização completa antes de imprimir
      await new Promise(resolve => setTimeout(resolve, 500))
      if (encerrado) return

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
          if (encerrado) return
          if (!success) log.error('Erro na impressão:', failureReason)
          encerrar(success ? { success: true } : { success: false, error: failureReason })
        }
      )
    } catch (error) {
      if (!encerrado) log.error('Erro ao imprimir:', error)
      encerrar({ success: false, error: error.message })
    }
  })()
}))

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
    ? 'http://localhost:5175/#/kitchen'
    : `file://${path.join(__dirname, '../dist/index.html')}#/kitchen`

  kitchenWindow.loadURL(url)
  // Mesmo cuidado da janela principal: sem 'ready-to-show', mostra quando a página termina de carregar
  let cozinhaMostrada = false
  const mostrarCozinha = () => {
    if (cozinhaMostrada || !kitchenWindow || kitchenWindow.isDestroyed()) return
    cozinhaMostrada = true
    kitchenWindow.show()
    kitchenWindow.setFullScreen(true)
  }
  kitchenWindow.once('ready-to-show', mostrarCozinha)
  kitchenWindow.webContents.once('did-finish-load', () => setTimeout(mostrarCozinha, 300))
  setTimeout(mostrarCozinha, 5000)
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
ipcMain.handle('get-hostname', () => os.hostname())

// O dono chamou pelo celular: tira a janela de minimizada, traz para frente por alguns segundos e pisca na barra
ipcMain.handle('chamar-atencao', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.flashFrame(true)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false)
  }, 5000)
  return { success: true }
})

ipcMain.handle('send-notification', async (event, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        icon: path.join(__dirname, '../public/logo.png'),
      })
      notification.on('click', () => {
        showMainWindow()
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

// Cole logo antes de: app.whenReady().then(createWindow)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

if (hasSingleInstanceLock) {
  app.whenReady().then(createWindow)
} else {
  app.quit()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
