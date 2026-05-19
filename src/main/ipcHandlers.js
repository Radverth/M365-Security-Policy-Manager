const { ipcMain, app, shell } = require('electron')
const { checkPowerShell, runScript, runScriptVisible } = require('./powershell')
const { getModuleStatus, installModules, updateModules } = require('./moduleManager')
const itGlue = require('./itGlue')
const { buildScript, buildConnectGraph } = require('./policyBuilder')
const store = require('./store')
const logger = require('./logger')
const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')

// All scopes needed across any Graph operation in this app
const WAM_SCOPES = 'Policy.ReadWrite.ConditionalAccess Policy.Read.All DeviceManagementConfiguration.ReadWrite.All Organization.ReadWrite.All Directory.ReadWrite.All RoleManagement.ReadWrite.Directory AuditLog.Read.All'

// Run a visible PS window so WAM has a window handle to attach its dialog to.
// After success, the MSAL token cache on disk holds the token, and subsequent
// hidden -Silent calls in the same user session can reuse it without re-prompting.
async function doWamAuth(win) {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' }

  win.webContents.send('ps:output', 'Opening Microsoft sign-in window...')
  logger.info('WAM auth: launching visible PS for interactive sign-in')

  const script = `
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference  = 'SilentlyContinue'
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
  Write-Output "WAM_FAIL: Microsoft.Graph module not found"
  exit 1
}
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
try {
  Connect-MgGraph -Scopes "${WAM_SCOPES}" -NoWelcome -ErrorAction Stop
  Write-Output "WAM_OK"
} catch {
  Write-Output "WAM_FAIL: $($_.Exception.Message)"
  exit 1
}
`
  try {
    const { output } = await runScriptVisible(script)
    if (output.includes('WAM_OK')) {
      logger.info('WAM auth: success')
      win.webContents.send('ps:output', 'Signed in successfully.')
      return { ok: true }
    }
    const failLine = output.split('\n').find(l => l.startsWith('WAM_FAIL:'))
    const reason = failLine ? failLine.slice('WAM_FAIL:'.length).trim() : 'unknown'
    logger.warn(`WAM auth: failed - ${reason}`)
    win.webContents.send('ps:output', `ERROR: Sign-in failed - ${reason}`)
    return { ok: false, reason }
  } catch (err) {
    logger.error(`WAM auth error: ${err.message}`)
    return { ok: false, reason: err.message }
  }
}

function registerIpcHandlers(win) {
  // Store
  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))
  ipcMain.handle('store:delete', (_, key) => store.delete(key))

  // App
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_, url) => shell.openExternal(url))
  ipcMain.handle('app:getLogDir', () => logger.getLogDir())

  // PowerShell check
  ipcMain.handle('modules:checkPs', async () => {
    logger.info('IPC: modules:checkPs')
    return checkPowerShell()
  })

  // Module status
  ipcMain.handle('modules:getStatus', async () => {
    try {
      return await getModuleStatus(win)
    } catch (err) {
      return []
    }
  })

  // Module install
  ipcMain.handle('modules:install', async (_, moduleNames) => {
    logger.info(`IPC: modules:install [${moduleNames.join(', ')}]`)
    const logs = []
    await installModules(
      moduleNames,
      (line) => {
        logs.push(line)
        win.webContents.send('ps:output', line)
      },
      (line) => {
        logs.push(`ERROR: ${line}`)
        win.webContents.send('ps:error', line)
      }
    )
    return logs
  })

  // Module update
  ipcMain.handle('modules:update', async (_, moduleNames) => {
    logger.info(`IPC: modules:update [${moduleNames.join(', ')}]`)
    const logs = []
    await updateModules(
      moduleNames,
      (line) => {
        logs.push(line)
        win.webContents.send('ps:output', line)
      },
      (line) => {
        logs.push(`ERROR: ${line}`)
        win.webContents.send('ps:error', line)
      }
    )
    return logs
  })

  // Install PowerShell (Linux)
  ipcMain.handle('modules:installPowerShell', async () => {
    if (process.platform === 'win32') return { success: false, message: 'Not applicable on Windows' }

    return new Promise((resolve) => {
      let scriptPath
      if (app.isPackaged) {
        scriptPath = path.join(process.resourcesPath, 'scripts', 'install-powershell.sh')
      } else {
        scriptPath = path.join(__dirname, '../../scripts/install-powershell.sh')
      }

      try {
        fs.chmodSync(scriptPath, '755')
      } catch (e) {
        // ignore
      }

      const proc = execFile('bash', [scriptPath], { shell: false })

      proc.stdout.on('data', (d) => {
        d.toString().split('\n').forEach(line => {
          if (line.trim()) win.webContents.send('ps:output', line)
        })
      })
      proc.stderr.on('data', (d) => {
        d.toString().split('\n').forEach(line => {
          if (line.trim()) win.webContents.send('ps:error', line)
        })
      })
      proc.on('close', (code) => {
        resolve({ success: code === 0 })
      })
      proc.on('error', (err) => {
        resolve({ success: false, message: err.message })
      })
    })
  })

  // IT Glue
  ipcMain.handle('itglue:test', async (_, apiKey) => itGlue.testConnection(apiKey))
  ipcMain.handle('itglue:getOrgs', async () => { try { return await itGlue.getOrganizations() } catch { return [] } })
  ipcMain.handle('itglue:getPasswords', async (_, orgId) => { try { return await itGlue.getPasswords(orgId) } catch { return [] } })

  // Policies
  ipcMain.handle('policies:list', async (_, credentials, authMode) => {
    logger.info(`IPC: policies:list authMode=${authMode} hasUser=${!!(credentials?.username)}`)
    const loginHint = (authMode !== 'interactive' && credentials?.username)
      ? `-LoginHint '${credentials.username.replace(/'/g, "''")}'`
      : ''

    // On Windows, WAM auth runs in a visible PS window first so the MSAL token is cached.
    // The main script then uses -Silent to reuse that token without prompting again.
    // On Linux/Mac (no WAM), fall back to device code directly.
    if (authMode === 'interactive' && process.platform === 'win32') {
      const wam = await doWamAuth(win)
      if (!wam.ok) return []
    }

    const connectBlock = authMode === 'interactive'
      ? process.platform === 'win32'
        ? `
Write-Output "Connecting to Microsoft Graph..."
Connect-MgGraph -Scopes "Policy.ReadWrite.ConditionalAccess Policy.Read.All" -NoWelcome -Silent -ErrorAction Stop
Write-Output "Connected."`
        : `
Write-Output "Follow the device code prompt below..."
Connect-MgGraph -UseDeviceAuthentication -Scopes "Policy.ReadWrite.ConditionalAccess Policy.Read.All" -NoWelcome -ErrorAction Stop
Write-Output "Connected."`
      : `
Write-Output "Connecting to Microsoft Graph..."
Connect-MgGraph -Scopes "Policy.ReadWrite.ConditionalAccess Policy.Read.All" -NoWelcome ${loginHint}
Write-Output "Connected."`

    const script = `
$ProgressPreference = 'SilentlyContinue'
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
  Write-Output "ERROR: Microsoft.Graph module not found - install it on the Modules page"
  exit 1
}
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue
try {
  ${connectBlock}
  Write-Output "Fetching policies..."
  $policies = Get-MgIdentityConditionalAccessPolicy -All
  Write-Output "POLICY_JSON_START"
  $policies | ConvertTo-Json -Depth 10
  Write-Output "POLICY_JSON_END"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
} finally {
  try { Disconnect-MgGraph -ErrorAction SilentlyContinue } catch {}
}
`
    const lines = []
    const { output } = await runScript(
      script,
      (line) => { lines.push(line); win.webContents.send('ps:output', line) },
      (line) => win.webContents.send('ps:error', line)
    )
    try {
      const jsonBlock = output.match(/POLICY_JSON_START\r?\n([\s\S]*?)\r?\nPOLICY_JSON_END/)
      if (jsonBlock) {
        const parsed = JSON.parse(jsonBlock[1])
        return Array.isArray(parsed) ? parsed : [parsed]
      }
    } catch {}
    return []
  })

  ipcMain.handle('policies:create', async (_, options) => {
    const { policies, credentials, prefix, authMode, policyConfigs, useDeviceCode } = options
    logger.info(`IPC: policies:create count=${policies?.length} authMode=${authMode} prefix=${prefix}`)
    if (authMode === 'interactive' && process.platform === 'win32') {
      const wam = await doWamAuth(win)
      if (!wam.ok) return { logs: [`ERROR: Sign-in failed - ${wam.reason}`], results: {} }
    }
    const script = buildScript(policies, credentials, prefix, authMode, policyConfigs || {}, { useDeviceCode })
    const logs = []
    const results = {}

    await runScript(
      script,
      (line) => {
        logs.push(line)
        win.webContents.send('ps:output', line)

        if (line.startsWith('SUCCESS:')) {
          const id = line.match(/[A-Z]{2}\d{3}/)?.[0]
          if (id) results[id] = 'success'
        } else if (line.startsWith('FAILURE:')) {
          const id = line.match(/[A-Z]{2}\d{3}/)?.[0]
          if (id) results[id] = 'failure'
        }
      },
      (line) => {
        win.webContents.send('ps:error', line)
      }
    )

    return { logs, results }
  })

  const safe = s => String(s || '').replace(/'/g, "''")

  const MG_RECONNECT = `
$ProgressPreference = 'SilentlyContinue'
Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue
try {
  Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess' -NoWelcome -Silent -ErrorAction Stop
} catch {
  Write-Output "ERROR: Session expired - reload policies to sign in again."
  exit 1
}`

  ipcMain.handle('policies:update', async (_, id, patch) => {
    logger.info(`IPC: policies:update id=${id}`)
    const safeId = safe(id)
    const patchJson = JSON.stringify(patch)
    const script = `${MG_RECONNECT}
try {
  $patchJson = @'
${patchJson}
'@
  $params = $patchJson | ConvertFrom-Json -AsHashtable
  Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body ($params | ConvertTo-Json -Depth 10) -ContentType 'application/json'
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
} finally {
  try { Disconnect-MgGraph -ErrorAction SilentlyContinue } catch {}
}
`
    const lines = []
    const { exitCode } = await runScript(script, (line) => lines.push(line), null)
    const hasSuccess = lines.some(l => l.trim() === 'SUCCESS')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: hasSuccess || exitCode === 0 }
  })

  ipcMain.handle('policies:delete', async (_, id) => {
    logger.info(`IPC: policies:delete id=${id}`)
    const safeId = safe(id)
    const script = `${MG_RECONNECT}
try {
  Remove-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${safeId}' -Confirm:$false
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
} finally {
  try { Disconnect-MgGraph -ErrorAction SilentlyContinue } catch {}
}
`
    const lines = []
    const { exitCode } = await runScript(script, (line) => lines.push(line), null)
    const hasSuccess = lines.some(l => l.trim() === 'SUCCESS')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: hasSuccess || exitCode === 0 }
  })

  ipcMain.handle('policies:toggleState', async (_, id, state) => {
    logger.info(`IPC: policies:toggleState id=${id} state=${state}`)
    const safeId = safe(id)
    const safeState = safe(state)
    const script = `${MG_RECONNECT}
try {
  Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body (@{ state = '${safeState}' } | ConvertTo-Json) -ContentType 'application/json'
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
} finally {
  try { Disconnect-MgGraph -ErrorAction SilentlyContinue } catch {}
}
`
    const lines = []
    const { exitCode } = await runScript(script, (line) => lines.push(line), null)
    const hasSuccess = lines.some(l => l.trim() === 'SUCCESS')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: hasSuccess || exitCode === 0 }
  })

  // Report: audit CA policies
  ipcMain.handle('report:audit', async (_, options) => {
    const { credentials, authMode } = options || {}
    logger.info(`IPC: report:audit authMode=${authMode}`)

    if (authMode === 'interactive' && process.platform === 'win32') {
      const wam = await doWamAuth(win)
      if (!wam.ok) return { error: `Sign-in failed - ${wam.reason}` }
    }

    const connectBlock = buildConnectGraph(credentials, authMode)

    const script = `
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue
Write-Output "CONNECTING: Authenticating..."
${connectBlock}
Write-Output "CONNECTED: Reading Conditional Access policies..."
try {
  $policies = Get-MgIdentityConditionalAccessPolicy -All
  $count = @($policies).Count
  Write-Output "POLICY_JSON_START"
  $policies | ConvertTo-Json -Depth 10
  Write-Output "POLICY_JSON_END"
  Write-Output "DONE: $count policies found"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
} finally {
  try { Disconnect-MgGraph -ErrorAction SilentlyContinue } catch {}
}
`
    const lines = []
    await runScript(
      script,
      (line) => {
        lines.push(line)
        win.webContents.send('ps:output', line)
      },
      (line) => {
        win.webContents.send('ps:error', line)
      }
    )

    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) return { error: errorLine.slice('ERROR:'.length).trim() }

    const startIdx = lines.indexOf('POLICY_JSON_START')
    const endIdx = lines.indexOf('POLICY_JSON_END')
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        const json = lines.slice(startIdx + 1, endIdx).join('\n')
        const parsed = JSON.parse(json)
        return { policies: Array.isArray(parsed) ? parsed : [parsed] }
      } catch (err) {
        return { error: 'Failed to parse policy data: ' + err.message }
      }
    }

    return { error: 'No data returned from PowerShell' }
  })

  // App: save PDF
  ipcMain.handle('app:savePDF', async (_, orgName) => {
    const sanitisedFilename = (orgName || 'report')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80)
    const timestamp = new Date().toISOString().slice(0, 10)
    const filename = `SecurityReport_${sanitisedFilename}_${timestamp}.pdf`
    const savedPath = path.join(app.getPath('documents'), filename)

    try {
      const buffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'minimum' },
      })
      fs.writeFileSync(savedPath, buffer)
      return { path: savedPath }
    } catch (err) {
      return { error: err.message }
    }
  })

}

module.exports = { registerIpcHandlers }
