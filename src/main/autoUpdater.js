const { autoUpdater } = require('electron-updater')
const { ipcMain } = require('electron')

const NETWORK_PATTERNS = [
  'ERR_NETWORK_CHANGED', 'ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
]

function classifyError(err) {
  const msg = err?.message || String(err)
  if (NETWORK_PATTERNS.some(p => msg.includes(p))) {
    return 'Could not reach the update server — check your internet connection and try again.'
  }
  if (msg.includes('Cannot parse releases feed') || msg.includes('Unable to find latest version')) {
    return 'Could not retrieve release information from GitHub. This is usually a temporary network issue — please try again shortly.'
  }
  if (msg.includes('ENOENT') || msg.includes('no such file')) {
    return 'Update file could not be found. Please download the latest version manually.'
  }
  return 'An error occurred while checking for updates. Please try again later.'
}

function setupAutoUpdater(win, isDev) {
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // electron-updater requires a packaged app to function — skip in dev
  if (isDev) {
    ipcMain.handle('updater:check', async () => {
      send('updater:checking')
      await new Promise(r => setTimeout(r, 800))
      send('updater:not-available')
      return { devMode: true }
    })
    ipcMain.handle('updater:download', () => {})
    ipcMain.handle('updater:install', () => {})
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => send('updater:checking'))

  autoUpdater.on('update-available', (info) => {
    send('updater:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes.slice(0, 1000)
        : '',
    })
  })

  autoUpdater.on('update-not-available', () => send('updater:not-available'))

  let retryScheduled = false
  autoUpdater.on('error', (err) => {
    const friendly = classifyError(err)
    const isNetworkError = NETWORK_PATTERNS.some(p => (err?.message || '').includes(p))

    // For transient network errors on the background startup check, retry once
    // after 60 s without surfacing an error to the user.
    if (isNetworkError && !retryScheduled) {
      retryScheduled = true
      setTimeout(() => {
        retryScheduled = false
        autoUpdater.checkForUpdates().catch(() => {})
      }, 60_000)
      return
    }

    send('updater:error', friendly)
  })

  autoUpdater.on('download-progress', (p) => {
    send('updater:progress', {
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('updater:downloaded', { version: info.version })
  })

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return result ?? {}
    } catch (err) {
      return { error: classifyError(err) }
    }
  })

  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate())

  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall(false, true))

  // Silently check on startup after 5 s
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
}

module.exports = { setupAutoUpdater }
