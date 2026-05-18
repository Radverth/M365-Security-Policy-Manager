const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const store = require('./store')

function getPwshPath() {
  const configured = store.get('powershellPath')
  if (configured && fs.existsSync(configured)) return configured

  if (process.platform === 'win32') {
    // Check well-known absolute paths first (avoids PATH lookup failures in packaged Electron)
    const absoluteCandidates = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ]
    for (const c of absoluteCandidates) {
      try { if (fs.existsSync(c)) return c } catch {}
    }
    // Fall back to PATH-based names (works when the app inherits a full user PATH)
    return 'pwsh.exe'
  }

  // Linux/macOS — try common locations
  const linuxCandidates = ['/usr/bin/pwsh', '/usr/local/bin/pwsh', '/snap/bin/pwsh']
  for (const c of linuxCandidates) {
    try { if (fs.existsSync(c)) return c } catch {}
  }
  return 'pwsh'
}

function checkPowerShell() {
  return new Promise((resolve) => {
    const pwsh = getPwshPath()
    const proc = spawn(pwsh, ['--version'], { stdio: 'pipe' })
    let output = ''
    proc.stdout.on('data', (d) => { output += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ found: true, path: pwsh, version: output.trim() })
      } else if (process.platform === 'win32' && pwsh !== 'powershell.exe') {
        // pwsh.exe found but exited non-zero — try Windows PowerShell 5 fallback
        const fallback = 'powershell.exe'
        const fb = spawn(fallback, ['-Command', '$PSVersionTable.PSVersion.ToString()'], { stdio: 'pipe' })
        let fbOut = ''
        fb.stdout.on('data', (d) => { fbOut += d.toString() })
        fb.on('close', (c2) => resolve({ found: c2 === 0, path: fallback, version: fbOut.trim() }))
        fb.on('error', () => resolve({ found: false, path: pwsh, version: '' }))
      } else {
        resolve({ found: false, path: pwsh, version: '' })
      }
    })
    proc.on('error', () => {
      if (process.platform === 'win32') {
        // pwsh.exe not found — try Windows PowerShell 5
        const fallback = 'powershell.exe'
        const fb = spawn(fallback, ['-Command', '$PSVersionTable.PSVersion.ToString()'], { stdio: 'pipe' })
        let fbOut = ''
        fb.stdout.on('data', (d) => { fbOut += d.toString() })
        fb.on('close', (c2) => resolve({ found: c2 === 0, path: fallback, version: fbOut.trim() }))
        fb.on('error', () => resolve({ found: false, path: pwsh, version: '' }))
      } else {
        resolve({ found: false, path: pwsh, version: '' })
      }
    })
  })
}

function runScript(script, onData, onError) {
  return new Promise((resolve, reject) => {
    const pwsh = getPwshPath()
    const execPolicy = store.get('executionPolicy') || 'RemoteSigned'

    // Write script to a temp file — far more reliable on Linux than piping to stdin,
    // because stdin-pipe mode block-buffers stdout meaning no output reaches Node
    // until the process exits (terrible for long-running installs).
    const tmpFile = path.join(
      os.tmpdir(),
      `m365ps-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`
    )

    // Force line-by-line stdout flushing so the Node data events fire in real time
    const fullScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n[Console]::Out.AutoFlush = $true\n${script}`

    try {
      fs.writeFileSync(tmpFile, fullScript, 'utf8')
    } catch (err) {
      reject(err)
      return
    }

    const proc = spawn(pwsh, [
      '-NonInteractive',
      '-NoProfile',
      '-ExecutionPolicy', execPolicy,
      '-File', tmpFile,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    })

    const allOutput = []
    const stripCtrl = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b[()][AB]/g, '')

    proc.stdout.on('data', (data) => {
      const lines = data.toString('utf8').split('\n')
      lines.forEach((raw) => {
        const line = stripCtrl(raw).trimEnd()
        if (line.trim()) {
          allOutput.push(line)
          if (onData) onData(line)
        }
      })
    })

    proc.stderr.on('data', (data) => {
      const lines = data.toString('utf8').split('\n')
      lines.forEach((raw) => {
        const line = stripCtrl(raw).trimEnd()
        if (line.trim()) {
          if (onError) onError(line)
        }
      })
    })

    const cleanup = () => {
      try { fs.unlinkSync(tmpFile) } catch {}
    }

    proc.on('close', (code) => {
      cleanup()
      resolve({ exitCode: code, output: allOutput.join('\n') })
    })

    proc.on('error', (err) => {
      cleanup()
      reject(err)
    })
  })
}

module.exports = { runScript, checkPowerShell, getPwshPath }
