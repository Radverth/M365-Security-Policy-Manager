const { ipcMain, app } = require('electron')
const { checkPowerShell, runScript } = require('./powershell')
const { getModuleStatus, installModules, updateModules } = require('./moduleManager')
const itGlue = require('./itGlue')
const { buildScript } = require('./policyBuilder')
const store = require('./store')
const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')

function registerIpcHandlers(win) {
  // Store
  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))
  ipcMain.handle('store:delete', (_, key) => store.delete(key))

  // PowerShell check
  ipcMain.handle('modules:checkPs', async () => checkPowerShell())

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
  ipcMain.handle('itglue:getOrgs', async () => itGlue.getOrganizations())
  ipcMain.handle('itglue:getPasswords', async (_, orgId) => itGlue.getPasswords(orgId))

  // Policies
  ipcMain.handle('policies:list', async (_, credentials, authMode) => {
    const connectLine = (authMode === 'interactive' || credentials?.interactive)
      ? `Connect-MgGraph -Scopes "Policy.Read.All" -NoWelcome`
      : `Connect-MgGraph ${credentials.tenantId ? `-TenantId '${credentials.tenantId}'` : ''} -Credential (New-Object System.Management.Automation.PSCredential('${credentials.username}', (ConvertTo-SecureString '${credentials.password}' -AsPlainText -Force))) -NoWelcome`

    const script = `
$ProgressPreference = 'SilentlyContinue'
try {
  ${connectLine}
  $policies = Get-MgIdentityConditionalAccessPolicy
  $policies | Select-Object Id, DisplayName, State, CreatedDateTime, ModifiedDateTime | ConvertTo-Json -Depth 3
  Disconnect-MgGraph | Out-Null
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`
    const { output } = await runScript(script, null, null)
    try {
      const match = output.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0])
    } catch {}
    return []
  })

  ipcMain.handle('policies:create', async (_, options) => {
    const { policies, credentials, prefix, authMode } = options
    const script = buildScript(policies, credentials, prefix, authMode)
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

  ipcMain.handle('policies:update', async (_, id, patch) => {
    const script = `
$params = '${JSON.stringify(patch)}' | ConvertFrom-Json -AsHashtable
Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${id}' -BodyParameter $params
Write-Output "SUCCESS"
`
    const { exitCode } = await runScript(script, null, null)
    return { success: exitCode === 0 }
  })

  ipcMain.handle('policies:delete', async (_, id) => {
    const script = `Remove-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${id}' -Confirm:$false\nWrite-Output "SUCCESS"`
    const { exitCode } = await runScript(script, null, null)
    return { success: exitCode === 0 }
  })

  ipcMain.handle('policies:toggleState', async (_, id, state) => {
    const script = `Update-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${id}' -State '${state}'\nWrite-Output "SUCCESS"`
    const { exitCode } = await runScript(script, null, null)
    return { success: exitCode === 0 }
  })
}

module.exports = { registerIpcHandlers }
