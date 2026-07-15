const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { store } = require('./store')
const logger = require('./logger')

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
    const fullScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\ntry { ([System.IO.StreamWriter][Console]::Out).AutoFlush = $true } catch {}\n${script}`

    try {
      // BOM is required: Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI,
      // which corrupts any non-ASCII character in the script (em-dashes become
      // smart quotes that terminate strings early).
      fs.writeFileSync(tmpFile, '\ufeff' + fullScript, 'utf8')
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

    let stdoutBuf = ''
    proc.stdout.on('data', (data) => {
      stdoutBuf += data.toString('utf8')
      const parts = stdoutBuf.split('\n')
      stdoutBuf = parts.pop() // keep incomplete last chunk
      parts.forEach((raw) => {
        const line = stripCtrl(raw).trimEnd()
        if (line.trim()) {
          allOutput.push(line)
          logger.ps(line)
          if (onData) onData(line)
        }
      })
    })

    let stderrBuf = ''
    proc.stderr.on('data', (data) => {
      stderrBuf += data.toString('utf8')
      const parts = stderrBuf.split('\n')
      stderrBuf = parts.pop()
      parts.forEach((raw) => {
        const line = stripCtrl(raw).trimEnd()
        if (line.trim()) {
          logger.psErr(line)
          if (onError) onError(line)
        }
      })
    })

    const cleanup = () => {
      try { fs.unlinkSync(tmpFile) } catch {}
    }

    proc.on('close', (code) => {
      // flush any remaining buffered content
      if (stdoutBuf.trim()) {
        const line = stripCtrl(stdoutBuf).trimEnd()
        if (line.trim()) { allOutput.push(line); logger.ps(line); if (onData) onData(line) }
      }
      if (stderrBuf.trim()) {
        const line = stripCtrl(stderrBuf).trimEnd()
        if (line.trim()) { logger.psErr(line); if (onError) onError(line) }
      }
      logger.info(`PS exited with code ${code}`)
      cleanup()
      resolve({ exitCode: code, output: allOutput.join('\n') })
    })

    proc.on('error', (err) => {
      cleanup()
      reject(err)
    })
  })
}

// Runs a PS script in a VISIBLE console window so WAM can attach its dialog.
// Returns { exitCode, output } — no streaming callbacks needed for auth scripts.
function runScriptVisible(script) {
  return new Promise((resolve, reject) => {
    const pwsh = getPwshPath()
    const execPolicy = store.get('executionPolicy') || 'RemoteSigned'

    const tmpFile = path.join(
      os.tmpdir(),
      `m365ps-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`
    )

    const fullScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`

    try {
      // BOM required — Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI
      fs.writeFileSync(tmpFile, '\ufeff' + fullScript, 'utf8')
    } catch (err) {
      reject(err)
      return
    }

    const proc = spawn(pwsh, [
      '-NoProfile',
      '-ExecutionPolicy', execPolicy,
      '-File', tmpFile,
    ], {
      // windowsHide omitted / false — PS gets a real console window so WAM has a handle
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    const allOutput = []
    const cleanup = () => { try { fs.unlinkSync(tmpFile) } catch {} }

    proc.stdout.on('data', (data) => {
      data.toString('utf8').split('\n').forEach(line => {
        const l = line.trimEnd()
        if (l.trim()) { allOutput.push(l); logger.ps(`[auth] ${l}`) }
      })
    })
    proc.stderr.on('data', (data) => {
      data.toString('utf8').split('\n').forEach(line => {
        const l = line.trimEnd()
        if (l.trim()) logger.psErr(`[auth] ${l}`)
      })
    })
    proc.on('close', (code) => {
      logger.info(`PS auth exited with code ${code}`)
      cleanup()
      resolve({ exitCode: code, output: allOutput.join('\n') })
    })
    proc.on('error', (err) => {
      cleanup()
      reject(err)
    })
  })
}

module.exports = { runScript, runScriptVisible, checkPowerShell, getPwshPath }
