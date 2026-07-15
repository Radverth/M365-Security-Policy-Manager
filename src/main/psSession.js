// src/main/psSession.js
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const SCOPES = 'Policy.ReadWrite.ConditionalAccess Policy.Read.All DeviceManagementConfiguration.ReadWrite.All Organization.ReadWrite.All Directory.ReadWrite.All RoleManagement.ReadWrite.Directory AuditLog.Read.All User.Read.All Group.Read.All'

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

    // Buffer partial lines across data chunks. A single output line (e.g. the
    // compressed policy JSON on a large tenant) can be far bigger than one
    // 64 KB pipe chunk — splitting each chunk independently and trimming the
    // fragment edges silently corrupted whitespace inside the JSON. Fragments
    // are only emitted once their newline arrives; a short idle flush covers
    // prompts (like device-code messages) that don't end with a newline.
    // pwsh writes ANSI terminal-mode sequences to stdout between commands on
    // Linux/macOS — strip them so they can't contaminate lines or markers.
    const stripCtrl = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b[()][AB]/g, '')
    const emitLine = (raw) => {
      const line = stripCtrl(raw).trim()
      if (!line) return
      if (!this._suppressUiOutput) sendToWin('ps:output', line)
      for (const h of [...this.lineHandlers]) h(line)
    }
    this._stdoutBuf = ''
    this._flushTimer = null
    this.proc.stdout.on('data', (data) => {
      clearTimeout(this._flushTimer)
      this._stdoutBuf += data.toString()
      const parts = this._stdoutBuf.split(/\r?\n/)
      this._stdoutBuf = parts.pop() // keep the incomplete tail
      for (const raw of parts) emitLine(raw)
      if (this._stdoutBuf) {
        this._flushTimer = setTimeout(() => {
          const tail = this._stdoutBuf
          this._stdoutBuf = ''
          emitLine(tail)
        }, 300)
      }
    })

    this.proc.stderr.on('data', (data) => {
      for (const raw of data.toString().split(/\r?\n/)) {
        const line = raw.trim()
        if (line) sendToWin('ps:error', line)
      }
    })

    // kill() detaches this.proc before the process actually exits, and a
    // replacement session may already be running by the time the exit event
    // fires — only reset state if this process is still the current one.
    const proc = this.proc
    this.proc.on('exit', () => {
      if (this.proc !== proc) return
      clearTimeout(this._flushTimer)
      if (this._stdoutBuf) { const tail = this._stdoutBuf; this._stdoutBuf = ''; emitLine(tail) }
      this.proc = null; this.context = null; this.lineHandlers = []
      this._ready = false; this._readyPromise = null
      sendToWin('session:disconnected')
    })
    this.proc.on('error', () => {
      if (this.proc !== proc) return
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
        // BOM required — Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI
        fs.writeFileSync(tmpFile, '\ufeff' + script + '\n', 'utf-8')
        this.proc.stdin.write(`& '${tmpFile.replace(/'/g, "''")}'\nWrite-Output "${marker}"\n`)
      } catch (err) { cleanup(); reject(err) }
    })
  }

  async run(script, onLine, timeoutMs = 60000) {
    if (!this.alive) throw new Error('No active session — connect a tenant first')
    await this._ensureReady()
    return this._exec(script, onLine, timeoutMs)
  }

  _parseContext(output) {
    const ctxMatch = output.match(/CONTEXT_JSON_START\r?\n([\s\S]*?)\r?\nCONTEXT_JSON_END/)
    if (!ctxMatch) return null
    try { return JSON.parse(ctxMatch[1]) } catch { return null }
  }

  // Silent auth only — reuses the MSAL token cache so returning users skip the
  // device code prompt. Returns the context, or null if there is no usable
  // cached token. Never prompts, so it is safe to call unattended (e.g. the
  // automatic reconnect after a module update restarts the session).
  async connectSilent() {
    if (!this.alive) throw new Error('Session not started')
    await this._ensureReady()

    // Suppress UI output so JSON markers don't appear in the log panel.
    this._suppressUiOutput = true
    let silentCtx = null
    try {
      const silentOut = await this._exec(`
try {
  Connect-MgGraph -ContextScope CurrentUser -Scopes "${SCOPES}" -NoWelcome -Silent -ErrorAction Stop
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
      silentCtx = this._parseContext(silentOut)
    } catch {}
    this._suppressUiOutput = false

    if (silentCtx) this.context = silentCtx
    return silentCtx
  }

  async connect(credentials, authMode) {
    if (!this.alive) throw new Error('Session not started')
    await this._ensureReady()

    const loginHint = (authMode !== 'interactive' && credentials?.username)
      ? `-LoginHint '${String(credentials.username).replace(/'/g, "''")}'`
      : ''
    const scopes = SCOPES

    const silentCtx = await this.connectSilent()
    if (silentCtx) {
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
  $errMsg = $_.Exception.Message
  if ($errMsg -match 'Assembly with same name is already loaded') {
    Write-Output "ERROR: A different version of the Microsoft Graph modules is already loaded in this PowerShell session. Restart the app and close any other PowerShell windows, then try again. If it persists, open the Modules page and update all Graph modules to the same version."
  } else {
    Write-Output "ERROR: $errMsg"
  }
}
`, null, 180000)
    const errLine = output.split('\n').find(l => l.trim().startsWith('ERROR:'))
    if (errLine) throw new Error(errLine.trim().slice('ERROR:'.length).trim())
    const ctx = this._parseContext(output)
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
      // The exit handler no longer fires for a detached process, so notify
      // the renderer here instead.
      if (this._win && !this._win.isDestroyed()) this._win.webContents.send('session:disconnected')
    }
  }
}

module.exports = new PersistentPsSession()
