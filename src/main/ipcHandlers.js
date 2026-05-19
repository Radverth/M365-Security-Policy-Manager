const { ipcMain, app, shell, dialog, BrowserWindow } = require('electron')
const { checkPowerShell, runScript } = require('./powershell')
const { getModuleStatus, installModules, updateModules } = require('./moduleManager')
const itGlue = require('./itGlue')
const { buildScript, buildConnectGraph } = require('./policyBuilder')
const store = require('./store')
const logger = require('./logger')
const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')


function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function generateReportHtml(orgName, policies, date) {
  function pickVal(obj, ...keys) {
    for (const k of keys) { if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k] }
    return null
  }

  function fmtUsers(u) {
    if (!u) return '—'
    const inc = pickVal(u, 'IncludeUsers', 'includeUsers') || []
    const incG = pickVal(u, 'IncludeGroups', 'includeGroups') || []
    const excU = pickVal(u, 'ExcludeUsers', 'excludeUsers') || []
    const excG = pickVal(u, 'ExcludeGroups', 'excludeGroups') || []
    if (inc.includes('All') || inc.includes('all')) {
      const ex = [...(excU.length ? [`${excU.length} user(s) excl.`] : []), ...(excG.length ? [`${excG.length} groups excl.`] : [])]
      return ex.length ? `All Users (${ex.join(', ')})` : 'All Users'
    }
    const parts = [...(incG.length ? [`${incG.length} group(s)`] : []), ...(inc.length ? [`${inc.length} user(s)`] : [])]
    return parts.join(', ') || '—'
  }

  function fmtApps(a) {
    if (!a) return '—'
    const inc = pickVal(a, 'IncludeApplications', 'includeApplications') || []
    const exc = pickVal(a, 'ExcludeApplications', 'excludeApplications') || []
    if (inc.includes('All') || inc.includes('all')) return exc.length ? `All Apps (${exc.length} excl.)` : 'All Apps'
    return inc.length ? `${inc.length} app(s)` : '—'
  }

  const GRANT_LABELS = {
    mfa: 'MFA', compliantDevice: 'Compliant Device', domainJoinedDevice: 'Domain-Joined',
    approvedApplication: 'Approved App', block: 'Block Access', passwordChange: 'Password Change',
    compliantApplication: 'Compliant App',
  }

  function fmtGrant(g) {
    if (!g) return '—'
    const controls = (pickVal(g, 'BuiltInControls', 'builtInControls') || []).map(c => GRANT_LABELS[c] || c)
    return controls.join(' / ') || '—'
  }

  function stateStyle(state) {
    if (state === 'enabled') return 'background:#dcfce7;color:#15803d'
    if (state === 'disabled') return 'background:#f3f4f6;color:#6b7280'
    if (state === 'enabledForReportingButNotEnforced') return 'background:#fef3c7;color:#d97706'
    return 'background:#f3f4f6;color:#6b7280'
  }

  function stateLabel(state) {
    if (state === 'enabled') return 'Enabled'
    if (state === 'disabled') return 'Disabled'
    if (state === 'enabledForReportingButNotEnforced') return 'Report Only'
    return state || 'Unknown'
  }

  function leftBorder(state) {
    if (state === 'enabled') return '#22c55e'
    if (state === 'disabled') return '#e5e7eb'
    if (state === 'enabledForReportingButNotEnforced') return '#f59e0b'
    return '#e5e7eb'
  }

  const enabled = policies.filter(p => (p.State || p.state) === 'enabled').length
  const reportOnly = policies.filter(p => (p.State || p.state) === 'enabledForReportingButNotEnforced').length
  const disabled = policies.filter(p => (p.State || p.state) === 'disabled').length

  const rows = policies.map((p, i) => {
    const state = p.State || p.state || 'unknown'
    const name = p.DisplayName || p.displayName || 'Unnamed'
    const id = p.Id || p.id || ''
    const cond = pickVal(p, 'Conditions', 'conditions') || {}
    const users = fmtUsers(pickVal(cond, 'Users', 'users'))
    const apps = fmtApps(pickVal(cond, 'Applications', 'applications'))
    const grant = fmtGrant(pickVal(p, 'GrantControls', 'grantControls'))
    const modified = (p.ModifiedDateTime || p.modifiedDateTime)
      ? new Date(p.ModifiedDateTime || p.modifiedDateTime).toLocaleDateString('en-GB') : '—'
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb'
    const border = leftBorder(state)
    return `<tr style="background:${rowBg}">
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;border-left:3px solid ${border}">
        <div style="font-size:11px;font-weight:600;color:#111827;line-height:1.3">${escHtml(name)}</div>
        <div style="font-size:9px;color:#d1d5db;font-family:monospace;margin-top:2px">${escHtml(id)}</div>
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;white-space:nowrap">
        <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:9px;font-weight:700;${stateStyle(state)}">${stateLabel(state)}</span>
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:10px;color:#374151">${escHtml(users)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:10px;color:#374151">${escHtml(apps)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:10px;color:#374151">${escHtml(grant)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:10px;color:#9ca3af;white-space:nowrap">${modified}</td>
    </tr>`
  }).join('')

  const statCards = [
    { label: 'Total Policies', value: policies.length, color: '#1a2d4a' },
    { label: 'Enabled', value: enabled, color: '#16a34a' },
    { label: 'Report Only', value: reportOnly, color: '#d97706' },
    { label: 'Disabled', value: disabled, color: '#9ca3af' },
  ].map(s => `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px;text-align:center">
      <div style="font-size:30px;font-weight:700;color:${s.color};line-height:1">${s.value}</div>
      <div style="font-size:9px;font-weight:600;color:#9ca3af;margin-top:8px;text-transform:uppercase;letter-spacing:0.5px">${s.label}</div>
    </div>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { margin: 15mm 12mm; size: A4 portrait; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #fff; color: #1f2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { width: 100%; border-collapse: collapse; }
.page-break { page-break-before: always; padding-top: 8px; }
.cover { min-height: 250mm; display: flex; flex-direction: column; gap: 28px; }
</style>
</head>
<body>
<div class="cover">
  <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#1a2d4a;border-radius:12px;overflow:hidden">
    <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;height:5px;background:linear-gradient(90deg,#b87820 0%,#E8A830 35%,#f5d080 65%,#E8A830 100%)"></div>
    <div style="padding:30px 38px 34px">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px">
        <div style="flex-shrink:0">
          <div style="font-size:36px;font-weight:200;color:#ffffff;letter-spacing:-1.5px;line-height:1">affinity</div>
          <div style="font-size:11px;color:#E8A830;margin-top:8px;letter-spacing:0.5px;font-weight:400">Technology. Together.</div>
        </div>
        <div style="flex:1;border-bottom:1px solid rgba(255,255,255,0.12);margin-bottom:6px"></div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:10px">M365 Security Policy Report</div>
          <div style="font-size:22px;font-weight:600;color:#ffffff;line-height:1.2;margin-bottom:5px">${escHtml(orgName || 'Tenant')}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.55)">${escHtml(date)}</div>
        </div>
      </div>
    </div>
  </div>

  <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
    ${statCards}
  </div>

  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px">
    <span style="font-size:11px;font-weight:600;color:#374151">Note: </span>
    <span style="font-size:11px;color:#6b7280">This report covers Conditional Access policies only. GUIDs shown where display names are unavailable.</span>
  </div>
</div>

<div class="page-break">
  <div style="margin-bottom:14px;display:flex;align-items:baseline;justify-content:space-between">
    <div>
      <div style="font-size:14px;font-weight:700;color:#1a2d4a">Conditional Access Policies</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:2px">${policies.length} policies &mdash; ${escHtml(date)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#f3f4f6">
        <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #e5e7eb">Policy Name</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap">Status</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #e5e7eb">Users</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #e5e7eb">Applications</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #e5e7eb">Grant Controls</th>
        <th style="padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap">Modified</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div style="margin-top:20px;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
    <p style="font-size:9px;color:#9ca3af">Generated by M365 Security Policy Manager &middot; Affinity Technology &middot; ${escHtml(date)} &middot; Confidential</p>
  </div>
</div>
</body>
</html>`
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

    // Always use device code flow — WAM (the Windows broker fallback) requires a
    // parent window handle that is unavailable in a console-less subprocess.
    // -ContextScope CurrentUser persists the MSAL token to disk so subsequent
    // processes can reuse it silently (avoids "Session expired" on toggle/edit).
    const connectArgs = `-UseDeviceAuthentication -ContextScope CurrentUser -Scopes "Policy.ReadWrite.ConditionalAccess Policy.Read.All" -NoWelcome ${loginHint}`

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
  $mgCtx = Get-MgContext -ErrorAction SilentlyContinue
  if ($mgCtx) {
    Write-Output "CONTEXT_JSON_START"
    @{ Account = $mgCtx.Account; TenantId = $mgCtx.TenantId } | ConvertTo-Json
    Write-Output "CONTEXT_JSON_END"
  }
  # Do NOT Disconnect — MSAL token stays on disk for silent reuse by toggle/edit
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
    let policies = []
    let context = null
    try {
      const jsonBlock = output.match(/POLICY_JSON_START\r?\n([\s\S]*?)\r?\nPOLICY_JSON_END/)
      if (jsonBlock) {
        const parsed = JSON.parse(jsonBlock[1])
        policies = Array.isArray(parsed) ? parsed : [parsed]
      }
    } catch {}
    try {
      const ctxBlock = output.match(/CONTEXT_JSON_START\r?\n([\s\S]*?)\r?\nCONTEXT_JSON_END/)
      if (ctxBlock) context = JSON.parse(ctxBlock[1])
    } catch {}
    return { policies, context }
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

  const buildReconnect = (tenantId) => {
    const tidFlag = tenantId ? `-TenantId '${safe(tenantId)}'` : ''
    return `$ProgressPreference = 'SilentlyContinue'
Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue
try {
  Connect-MgGraph -Scopes 'Policy.ReadWrite.ConditionalAccess' -ContextScope CurrentUser -NoWelcome -Silent ${tidFlag} -ErrorAction Stop
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
  }

  ipcMain.handle('policies:disconnect', async () => {
    const script = `Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
try { Disconnect-MgGraph -ErrorAction SilentlyContinue } catch {}
Write-Output "DISCONNECTED"`
    await runScript(script, null, null)
    return { success: true }
  })

  ipcMain.handle('policies:update', async (_, id, patch, tenantId) => {
    logger.info(`IPC: policies:update id=${id}`)
    const safeId = safe(id)
    const patchJson = JSON.stringify(patch)
    const script = `${buildReconnect(tenantId)}
try {
  $patchJson = @'
${patchJson}
'@
  $params = $patchJson | ConvertFrom-Json -AsHashtable
  Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body ($params | ConvertTo-Json -Depth 10) -ContentType 'application/json'
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`
    const lines = []
    const { exitCode } = await runScript(script, (line) => lines.push(line), null)
    const hasSuccess = lines.some(l => l.trim() === 'SUCCESS')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: hasSuccess || exitCode === 0 }
  })

  ipcMain.handle('policies:delete', async (_, id, tenantId) => {
    logger.info(`IPC: policies:delete id=${id}`)
    const safeId = safe(id)
    const script = `${buildReconnect(tenantId)}
try {
  Remove-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${safeId}' -Confirm:$false
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`
    const lines = []
    const { exitCode } = await runScript(script, (line) => lines.push(line), null)
    const hasSuccess = lines.some(l => l.trim() === 'SUCCESS')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: hasSuccess || exitCode === 0 }
  })

  ipcMain.handle('policies:toggleState', async (_, id, state, tenantId) => {
    logger.info(`IPC: policies:toggleState id=${id} state=${state}`)
    const safeId = safe(id)
    const safeState = safe(state)
    const script = `${buildReconnect(tenantId)}
try {
  Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body (@{ state = '${safeState}' } | ConvertTo-Json) -ContentType 'application/json'
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
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
  ipcMain.handle('app:savePDF', async (_, orgName, policiesData) => {
    const sanitised = (orgName || 'report')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80)
    const timestamp = new Date().toISOString().slice(0, 10)
    const defaultFilename = `SecurityReport_${sanitised}_${timestamp}.pdf`

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Save Security Report',
      defaultPath: path.join(app.getPath('documents'), defaultFilename),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { cancelled: true }

    const policies = Array.isArray(policiesData) ? policiesData : []
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const html = generateReportHtml(orgName, policies, date)
    const tmpPath = path.join(app.getPath('temp'), `_affinity_report_${Date.now()}.html`)
    const printWin = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    try {
      fs.writeFileSync(tmpPath, html, 'utf-8')
      await printWin.loadFile(tmpPath)
      const buffer = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'printableArea' },
      })
      fs.writeFileSync(filePath, buffer)
      return { path: filePath }
    } catch (err) {
      return { error: err.message }
    } finally {
      printWin.destroy()
      try { fs.unlinkSync(tmpPath) } catch {}
    }
  })

}

module.exports = { registerIpcHandlers }
