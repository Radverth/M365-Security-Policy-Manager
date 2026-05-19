const fs = require('fs')
const path = require('path')

let _logDir = null
let _currentLogFile = null
let _currentDateStr = null
let _stream = null

function getLogDir() {
  if (_logDir) return _logDir
  // app may not be ready yet at module load — defer lookup
  try {
    const { app } = require('electron')
    _logDir = app.getPath('logs')
  } catch {
    _logDir = require('os').tmpdir()
  }
  try { fs.mkdirSync(_logDir, { recursive: true }) } catch {}
  return _logDir
}

function dateStr() {
  return new Date().toISOString().slice(0, 10)
}

function getStream() {
  const today = dateStr()
  if (_stream && today === _currentDateStr) return _stream

  // Close old stream on date rollover
  if (_stream) {
    try { _stream.end() } catch {}
    _stream = null
  }

  _currentDateStr = today
  _currentLogFile = path.join(getLogDir(), `app-${today}.log`)
  _stream = fs.createWriteStream(_currentLogFile, { flags: 'a', encoding: 'utf8' })
  _stream.on('error', () => { _stream = null })

  pruneOldLogs()
  return _stream
}

function pruneOldLogs() {
  try {
    const dir = getLogDir()
    const files = fs.readdirSync(dir)
      .filter(f => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
    // Keep last 14 days
    if (files.length > 14) {
      files.slice(0, files.length - 14).forEach(f => {
        try { fs.unlinkSync(path.join(dir, f)) } catch {}
      })
    }
  } catch {}
}

function write(level, message) {
  try {
    const ts = new Date().toISOString()
    const stream = getStream()
    if (stream) stream.write(`[${ts}] [${level}] ${message}\n`)
  } catch {}
}

module.exports = {
  info: (msg) => write('INFO ', msg),
  warn: (msg) => write('WARN ', msg),
  error: (msg) => write('ERROR', msg),
  ps: (msg) => write('PS   ', msg),
  psErr: (msg) => write('PSERR', msg),
  getLogDir,
}
