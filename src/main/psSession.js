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
  }

  get alive() {
    try { return !!(this.proc && !this.proc.killed && this.proc.stdin?.writable) }
    catch { return false }
  }

  async start(win) {
    const pwshPath = process.platform === 'win32' ? 'pwsh.exe' : 'pwsh'
    this.proc = spawn(pwshPath, ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    this.proc.stdout.on('data', (data) => {
      for (const raw of data.toString().split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        win?.webContents?.send('ps:output', line)
        for (const h of [...this.lineHandlers]) h(line)
      }
    })

    this.proc.stderr.on('data', (data) => {
      for (const raw of data.toString().split(/\r?\n/)) {
        const line = raw.trim()
        if (line) win?.webContents?.send('ps:error', line)
      }
    })

    this.proc.on('exit', () => {
      this.proc = null; this.context = null; this.lineHandlers = []
      win?.webContents?.send('session:disconnected')
    })
    this.proc.on('error', () => {
      this.proc = null; this.context = null; this.lineHandlers = []
    })

    // Bootstrap - load modules
    await this._exec(
      `$ProgressPreference='SilentlyContinue'\n$VerbosePreference='SilentlyContinue'\nImport-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue\nImport-Module Microsoft.Graph.Identity.SignIns -ErrorAction SilentlyContinue\n`,
      null, 30000
    )
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
    return this._exec(script, onLine, timeoutMs)
  }

  async connect(credentials, authMode) {
    if (!this.alive) throw new Error('Session not started')
    const loginHint = (authMode !== 'interactive' && credentials?.username)
      ? `-LoginHint '${String(credentials.username).replace(/'/g, "''")}'`
      : ''
    const scopes = 'Policy.ReadWrite.ConditionalAccess Policy.Read.All DeviceManagementConfiguration.ReadWrite.All Organization.ReadWrite.All Directory.ReadWrite.All RoleManagement.ReadWrite.Directory AuditLog.Read.All'
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
    const ctxMatch = output.match(/CONTEXT_JSON_START\r?\n([\s\S]*?)\r?\nCONTEXT_JSON_END/)
    if (!ctxMatch) throw new Error('Authentication failed — no session context returned')
    const ctx = JSON.parse(ctxMatch[1])
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
    if (p && !p.killed) {
      try { p.stdin.write('exit\n') } catch {}
      setTimeout(() => { try { p.kill() } catch {} }, 800)
    }
  }
}

module.exports = new PersistentPsSession()
