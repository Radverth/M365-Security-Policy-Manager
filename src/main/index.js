const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')
const { registerIpcHandlers } = require('./ipcHandlers')
const { setupAutoUpdater } = require('./autoUpdater')
const logger = require('./logger')
const psSession = require('./psSession')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

async function gracefulDisconnect(win) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    try { win.webContents.send('app:disconnecting') } catch {}
  }
  await Promise.race([
    psSession.disconnect(),
    new Promise(r => setTimeout(r, 3000)),
  ]).catch(() => {})
}

function createWindow() {
  Menu.setApplicationMenu(null)

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#F8F9FC',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../../dist-renderer/index.html'))
  }

  registerIpcHandlers(win)
  setupAutoUpdater(win, isDev)

  // Pre-warm: start the PowerShell session and load Graph modules in the background
  // so the ~10s module loading is complete by the time the user clicks Connect.
  psSession.start(win).catch(err => logger.warn('psSession pre-warm failed:', err.message))

  // Intercept window close while a session is active — the window is still
  // alive here so IPC reaches the renderer, the overlay shows, then we destroy.
  win.on('close', (e) => {
    if (!psSession.alive) return
    e.preventDefault()
    logger.info('Window closing — disconnecting Graph session')
    gracefulDisconnect(win).then(() => win.destroy())
  })
}

app.whenReady().then(() => {
  logger.info(`App started v${app.getVersion()} platform=${process.platform}`)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Fallback for macOS Cmd+Q (quit triggered before any window closes) or
// any other quit path where win.on('close') hasn't already disconnected.
let _quitting = false
app.on('before-quit', (e) => {
  if (_quitting || !psSession.alive) return
  e.preventDefault()
  _quitting = true
  logger.info('App quitting — disconnecting Graph session')
  const [win] = BrowserWindow.getAllWindows()
  gracefulDisconnect(win).then(() => app.quit())
})
