import React, { useState } from 'react'

export function parseDeviceCode(line) {
  const codeMatch = line.match(/enter the code\s+([A-Z0-9]{6,12})/i)
  if (!codeMatch) return null
  const urlMatch = line.match(/https?:\/\/[^\s)]+/i)
  const url = urlMatch ? urlMatch[0].replace(/[.,)]+$/, '') : 'https://microsoft.com/devicelogin'
  return { url, code: codeMatch[1] }
}

export default function DeviceCodeModal({ info, onDismiss }) {
  const [copied, setCopied] = useState(false)

  if (!info) return null

  const copyCode = () => {
    navigator.clipboard.writeText(info.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(info.url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div style={{ background: '#1a2d4a' }} className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Sign in to Microsoft</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Device code authentication required</p>
              </div>
            </div>
            {onDismiss && (
              <button onClick={onDismiss} className="p-1.5 rounded-lg transition-colors hover:bg-white/10">
                <svg className="w-4 h-4 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Open the link below in a browser and enter this code to authenticate. The code expires in a few minutes.
          </p>

          {/* Code display */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Your sign-in code</p>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-center">
                <span className="text-2xl font-bold tracking-[0.3em] text-navy font-mono select-all">{info.code}</span>
              </div>
              <button
                onClick={copyCode}
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

          {/* Open link */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sign-in URL</p>
            <button
              onClick={() => window.api?.app?.openExternal(info.url)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: '#1a2d4a' }}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span className="flex-1 text-left truncate">{info.url}</span>
            </button>
            <button
              onClick={copyUrl}
              className="mt-1.5 w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Copy URL instead
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center pt-1">
            This dialog closes automatically once authentication is complete.
          </p>
        </div>
      </div>
    </div>
  )
}
