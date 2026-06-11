import React, { useState } from 'react'

export function buildManualInstallCommand(moduleNames) {
  // TLS 1.2 line is required on Windows PowerShell 5 and harmless on PS7+
  return [
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
    `Install-Module -Name ${moduleNames.join(', ')} -Scope CurrentUser -Force -AllowClobber -SkipPublisherCheck`,
  ].join('\n')
}

export default function ManualInstallModal({ info, onDismiss }) {
  const [copied, setCopied] = useState(false)

  if (!info || !info.modules?.length) return null

  const command = buildManualInstallCommand(info.modules)

  const copyCommand = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div style={{ background: '#1a2d4a' }} className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Manual installation required</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Automatic install failed for {info.modules.length === 1 ? info.modules[0] : `${info.modules.length} modules`}
                </p>
              </div>
            </div>
            <button onClick={onDismiss} className="p-1.5 rounded-lg transition-colors hover:bg-white/10">
              <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            You can install the {info.modules.length === 1 ? 'module' : 'modules'} yourself by running the command below in PowerShell — no admin rights needed.
          </p>

          {/* Steps */}
          <ol className="space-y-2">
            {[
              <>Open PowerShell — on Windows, press <span className="font-semibold">Start</span> and type <span className="font-semibold">PowerShell</span>; on Linux, run <span className="font-mono font-semibold">pwsh</span> in a terminal</>,
              <>Paste the command below and press <span className="font-semibold">Enter</span>, then wait for it to finish</>,
              <>Come back here and click <span className="font-semibold">Check Status</span></>,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-gray-600 leading-relaxed">
                <span className="w-4 h-4 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          {/* Command display */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Installation command</p>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 overflow-x-auto">
                <pre className="text-xs text-navy font-mono select-all whitespace-pre leading-relaxed">{command}</pre>
              </div>
              <button
                onClick={copyCommand}
                className={[
                  'flex flex-col items-center justify-center gap-1 px-3 rounded-xl border text-xs font-semibold transition-all min-w-[64px]',
                  copied
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50',
                ].join(' ')}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-400 text-center pt-1">
            The error details are in the output log below this dialog.
          </p>
        </div>
      </div>
    </div>
  )
}
