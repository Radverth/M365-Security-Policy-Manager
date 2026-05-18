import React, { useEffect, useRef, useState } from 'react'

function colorLine(line) {
  if (!line) return { text: '', cls: 'text-gray-400' }
  const l = line.toUpperCase()
  if (l.startsWith('SUCCESS:') || l.startsWith('CONNECTED:') || l.startsWith('DONE')) return { text: line, cls: 'text-green-400' }
  if (l.startsWith('ERROR:') || l.startsWith('FAILURE:')) return { text: line, cls: 'text-red-400' }
  if (l.startsWith('WARNING:') || l.startsWith('WARN:')) return { text: line, cls: 'text-amber-400' }
  if (l.startsWith('INFO:') || l.startsWith('CREATING:') || l.startsWith('INSTALLING:') || l.startsWith('UPDATING:')) return { text: line, cls: 'text-blue-400' }
  if (l.startsWith('SKIP:') || l.startsWith('DISCONNECTED:')) return { text: line, cls: 'text-gray-400' }
  return { text: line, cls: 'text-gray-200' }
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function LogPanel({ logs = [], height = 'h-64', title = 'Output', active = false }) {
  const bottomRef = useRef(null)
  const [elapsed, setElapsed] = useState(0)

  // Reset and start elapsed counter whenever active flips to true
  useEffect(() => {
    if (!active) { setElapsed(0); return }
    setElapsed(0)
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, active])

  const lastLine = logs.length > 0 ? (typeof logs[logs.length - 1] === 'string' ? logs[logs.length - 1] : logs[logs.length - 1].line) : ''
  const isLongOp = active && lastLine.toUpperCase().startsWith('INSTALLING:')

  return (
    <div className="flex flex-col rounded-lg overflow-hidden border border-gray-700">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</span>
          {active && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Running — {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="w-3 h-3 rounded-full bg-green-500" />
        </div>
      </div>
      <div className={['bg-gray-900 overflow-y-auto font-mono text-xs leading-relaxed p-4', height].join(' ')}>
        {logs.length === 0 ? (
          <span className="text-gray-600">
            {active ? 'Starting...' : 'Waiting for output...'}
          </span>
        ) : (
          logs.map((entry, i) => {
            const { text, cls } = colorLine(typeof entry === 'string' ? entry : entry.line)
            return (
              <div key={i} className={['whitespace-pre-wrap break-all', cls].join(' ')}>
                <span className="text-gray-600 select-none mr-2">{String(i + 1).padStart(3, '0')}</span>
                {text}
              </div>
            )
          })
        )}
        {active && logs.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse flex-shrink-0" />
            <span>
              {isLongOp
                ? `Installing... ${formatElapsed(elapsed)} elapsed — large modules can take 5–15 minutes`
                : `Working... ${formatElapsed(elapsed)} elapsed`}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
