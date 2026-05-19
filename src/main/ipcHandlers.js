const { ipcMain, app, shell } = require('electron')
const { checkPowerShell, runScript } = require('./powershell')
const { getModuleStatus, installModules, updateModules } = require('./moduleManager')
const itGlue = require('./itGlue')
const { buildScript, buildConnectGraph } = require('./policyBuilder')
const store = require('./store')
const logger = require('./logger')
const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')

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
    // Always use device code flow — WAM (the Windows broker fallback) requires a
    // parent window handle that is unavailable in a console-less subprocess.
    const connectArgs = `-UseDeviceAuthentication -Scopes "Policy.ReadWrite.ConditionalAccess Policy.Read.All" -NoWelcome ${loginHint}`

    const script = `
$ProgressPreference = 'SilentlyContinue'
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
  Write-Output "ERROR: Microsoft.Graph module not found - install it on the Modules page"
  exit 1
}
Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue
try {
  Write-Output "Connecting to Microsoft Graph..."
  Connect-MgGraph ${connectArgs}
  Write-Output "Connected. Fetching policies..."
  $policies = Get-MgIdentityConditionalAccessPolicy -All
  Write-Output "POLICY_JSON_START"
  $policies | ConvertTo-Json -Depth 10
  Write-Output "POLICY_JSON_END"
  Disconnect-MgGraph | Out-Null
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
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
  $errMsg = $_.Exception.Message
  if ($errMsg -match 'listener|window handle') {
    $mgCtx = Get-MgContext -ErrorAction SilentlyContinue
    if (-not $mgCtx) {
      Write-Output "ERROR: Session expired - please reload policies to reconnect."
      exit 1
    }
  } else {
    Write-Output "ERROR: Session expired - please reload policies to reconnect."
    exit 1
  }
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
