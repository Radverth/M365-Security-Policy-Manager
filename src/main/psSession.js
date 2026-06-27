// src/main/psSession.js
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

class PersistentPsSession {
  constructor() {
    this.proc = null
    this.lineHandlers = []
    this.context = null  // { Account, TenantId }
    this._suppressUiOutput = false
    this._win = null
    this._ready = false        // true once bootstrap completes
    this._readyPromise = null  // resolves when bootstrap completes
  }

  get alive() {
    try { return !!(this.proc && !this.proc.killed && this.proc.stdin?.writable) }
    catch { return false }
  }

  // Waits for bootstrap to finish before running any scripts.
  // Safe to call when already ready — resolves immediately.
  _ensureReady() {
    if (this._ready) return Promise.resolve()
    if (this._readyPromise) return this._readyPromise
    return Promise.reject(new Error('Session not started'))
  }

  async start(win) {
    if (this._readyPromise) return this._readyPromise  // prevent double-start
    this._win = win

    const sendToWin = (channel, msg) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, msg)
    }

    // Try pwsh (PS7) first; fall back to powershell.exe (PS5) if pwsh is not installed.
    // Resolves with the spawned process, or null if the executable was not found (ENOENT).
    const trySpawn = (exe) => new Promise((resolve) => {
      if (!exe) return resolve(null)
      const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })
      p.once('error', (e) => resolve(e.code === 'ENOENT' ? null : p))
      p.once('spawn', () => { p.removeAllListeners('error'); resolve(p) })
    })

    const ps7 = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh'
    const ps5 = process.platform === 'win32' ? 'powershell.exe' : null

    this.proc = await trySpawn(ps7)
    if (!this.proc) {
      sendToWin('ps:error', 'PowerShell 7 (pwsh) not found — falling back to Windows PowerShell 5. Module loading will be slower (~30-60s) and some features may be limited.')
      this.proc = await trySpawn(ps5)
    }
    if (!this.proc) throw new Error('PowerShell not found. Please install PowerShell 7 from https://aka.ms/powershell')

    this.proc.stdout.on('data', (data) => {
      for (const raw of data.toString().split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        if (!this._suppressUiOutput) sendToWin('ps:output', line)
        for (const h of [...this.lineHandlers]) h(line)
      }
    })

    this.proc.stderr.on('data', (data) => {
      for (const raw of data.toString().split(/\r?\n/)) {
        const line = raw.trim()
        if (line) sendToWin('ps:error', line)
      }
    })

    this.proc.on('exit', () => {
      this.proc = null; this.context = null; this.lineHandlers = []
      this._ready = false; this._readyPromise = null
      sendToWin('session:disconnected')
    })
    this.proc.on('error', () => {
      this.proc = null; this.context = null; this.lineHandlers = []
      this._ready = false; this._readyPromise = null
    })

    // Bootstrap: load Graph modules. On PS7, load all six concurrently (~10s).
    // On PS5, fall back to sequential imports (~30-60s). The PS version check runs
    // inside PowerShell itself so the same script works regardless of which executable
    // was selected above.
    this._readyPromise = this._exec(
      `$ProgressPreference='SilentlyContinue'
$VerbosePreference='SilentlyContinue'
$_mods = @(
  'Microsoft.Graph.Authentication',
  'Microsoft.Graph.Identity.SignIns',
  'Microsoft.Graph.Users',
  'Microsoft.Graph.Groups',
  'Microsoft.Graph.Identity.DirectoryManagement',
  'Microsoft.Graph.DeviceManagement'
)
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $_mods | ForEach-Object -Parallel { Import-Module $_ -ErrorAction SilentlyContinue } -ThrottleLimit 6
} else {
  $_mods | ForEach-Object { Import-Module $_ -ErrorAction SilentlyContinue }
}
`,
      null, 90000
    ).then(() => { this._ready = true })

    return this._readyPromise
  }

  _exec(script, onLine, timeoutMs = 60000) {
    const marker = `__END_${Date.now()}_${Math.random().toString(36).slice(2)}__`
    const tmpFile = path.join(os.tmpdir(), `_ps_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`)
    return new Promise((resolve, reject) => {
      const lines = []
      let timer
      const cleanup = () => {
        clearTimeout(timer)
        const idx = this.lineHandlers.indexOf(handler)
        if (idx > -1) this.lineHandlers.splice(idx, 1)
        try { fs.unlinkSync(tmpFile) } catch {}
      }
      const handler = (line) => {
        if (line.trim() === marker) { cleanup(); resolve(lines.join('\n')) }
        else { lines.push(line); onLine?.(line) }
      }
      this.lineHandlers.push(handler)
      timer = setTimeout(() => { cleanup(); reject(new Error('PowerShell command timed out')) }, timeoutMs)
      try {
        fs.writeFileSync(tmpFile, script + '\n', 'utf-8')
        this.proc.stdin.write(`& '${tmpFile.replace(/'/g, "''")}'\nWrite-Output "${marker}"\n`)
      } catch (err) { cleanup(); reject(err) }
    })
  }

  async run(script, onLine, timeoutMs = 60000) {
    if (!this.alive) throw new Error('No active session — connect a tenant first')
    await this._ensureReady()
    return this._exec(script, onLine, timeoutMs)
  }

  async connect(credentials, authMode) {
    if (!this.alive) throw new Error('Session not started')
    await this._ensureReady()

    const loginHint = (authMode !== 'interactive' && credentials?.username)
      ? `-LoginHint '${String(credentials.username).replace(/'/g, "''")}'`
      : ''
    const scopes = 'Policy.ReadWrite.ConditionalAccess Policy.Read.All DeviceManagementConfiguration.ReadWrite.All Organization.ReadWrite.All Directory.ReadWrite.All RoleManagement.ReadWrite.Directory AuditLog.Read.All User.Read.All Group.Read.All'

    const parseContext = (output) => {
      const ctxMatch = output.match(/CONTEXT_JSON_START\r?\n([\s\S]*?)\r?\nCONTEXT_JSON_END/)
      if (!ctxMatch) return null
      try { return JSON.parse(ctxMatch[1]) } catch { return null }
    }

    // Try silent auth first — reuses the MSAL token cache so returning users skip the device code prompt.
    // Suppress UI output so JSON markers don't appear in the log panel.
    this._suppressUiOutput = true
    let silentCtx = null
    try {
      const silentOut = await this._exec(`
try {
  Connect-MgGraph -ContextScope CurrentUser -Scopes "${scopes}" -NoWelcome -Silent -ErrorAction Stop
  $ctx = Get-MgContext
  if ($ctx -and ($ctx.Scopes -contains 'Policy.ReadWrite.ConditionalAccess')) {
    Write-Output "CONTEXT_JSON_START"
    @{ Account = $ctx.Account; TenantId = $ctx.TenantId } | ConvertTo-Json
    Write-Output "CONTEXT_JSON_END"
  } elseif ($ctx) {
    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}
`, null, 30000)
      silentCtx = parseContext(silentOut)
    } catch {}
    this._suppressUiOutput = false

    if (silentCtx) {
      this.context = silentCtx
      if (this._win && !this._win.isDestroyed()) this._win.webContents.send('ps:output', `CONNECTED: Authenticated as ${silentCtx.Account} (cached)`)
      return silentCtx
    }

    // Silent failed — fall back to device code.
    const output = await this._exec(`
try {
  Write-Output "Connecting to Microsoft Graph..."
  Connect-MgGraph -UseDeviceAuthentication -ContextScope CurrentUser -Scopes "${scopes}" -NoWelcome ${loginHint} -ErrorAction Stop
  $ctx = Get-MgContext
  if ($ctx) {
    Write-Output "CONTEXT_JSON_START"
    @{ Account = $ctx.Account; TenantId = $ctx.TenantId } | ConvertTo-Json
    Write-Output "CONTEXT_JSON_END"
    Write-Output "CONNECTED: Authenticated as $($ctx.Account)"
  } else {
    Write-Output "ERROR: Could not retrieve context after authentication"
  }
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}
`, null, 180000)
    const errLine = output.split('\n').find(l => l.trim().startsWith('ERROR:'))
    if (errLine) throw new Error(errLine.trim().slice('ERROR:'.length).trim())
    const ctx = parseContext(output)
    if (!ctx) throw new Error('Authentication failed — no session context returned')
    this.context = ctx
    return ctx
  }

  async disconnect() {
    if (this.alive) {
      try {
        await this._exec('Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null', null, 10000)
      } catch {}
    }
    this.kill()
  }

  kill() {
    const p = this.proc
    this.proc = null; this.context = null; this.lineHandlers = []
    this._ready = false; this._readyPromise = null
    if (p && !p.killed) {
      try { p.stdin.write('exit\n') } catch {}
      setTimeout(() => { try { p.kill() } catch {} }, 800)
    }
  }
}

module.exports = new PersistentPsSession()
