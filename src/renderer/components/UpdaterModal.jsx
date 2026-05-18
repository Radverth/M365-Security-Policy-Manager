import React from 'react'
import Modal from './Modal'
import Button from './Button'
import useStore from '../store'

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatSpeed(bps) {
  if (!bps) return ''
  return `${formatBytes(bps)}/s`
}

export default function UpdaterModal() {
  const { updaterStatus, updaterInfo, downloadProgress, updaterError, triggerDownload, triggerInstall, dismissUpdater } = useStore()

  const open = ['available', 'downloading', 'downloaded', 'error'].includes(updaterStatus)
  if (!open) return null

  const title =
    updaterStatus === 'available' ? 'Update Available' :
    updaterStatus === 'downloading' ? 'Downloading Update…' :
    updaterStatus === 'downloaded' ? 'Ready to Install' :
    'Update Error'

  return (
    <Modal open={open} onClose={updaterStatus === 'downloading' ? () => {} : dismissUpdater} title={title} size="md">
      <div className="space-y-4 py-1">

        {/* Available */}
        {updaterStatus === 'available' && (
          <>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-blue-800">Version {updaterInfo?.version}</p>
                {updaterInfo?.releaseDate && (
                  <p className="text-xs text-blue-600 mt-0.5">
                    Released {new Date(updaterInfo.releaseDate).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-600">A new version is available. Click below to download and install.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={dismissUpdater}>Later</Button>
              <Button variant="primary" onClick={triggerDownload}>Download &amp; Install</Button>
            </div>
          </>
        )}

        {/* Downloading */}
        {updaterStatus === 'downloading' && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Downloading…</span>
                <span className="font-medium text-gray-800">{downloadProgress?.percent ?? 0}%</span>
              </div>
              <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress?.percent ?? 0}%` }}
                />
              </div>
              {downloadProgress && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}</span>
                  <span>{formatSpeed(downloadProgress.bytesPerSecond)}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 text-center">Please wait — the app will prompt you to restart when done.</p>
          </>
        )}

        {/* Downloaded / ready */}
        {updaterStatus === 'downloaded' && (
          <>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-green-800 font-medium">
                Version {updaterInfo?.version} is ready — restart to apply.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={dismissUpdater}>Later</Button>
              <Button variant="primary" onClick={triggerInstall}>Restart Now</Button>
            </div>
          </>
        )}

        {/* Error */}
        {updaterStatus === 'error' && (
          <>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-800">Update failed</p>
                {updaterError && <p className="text-xs text-red-600 mt-0.5">{updaterError}</p>}
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={dismissUpdater}>Dismiss</Button>
            </div>
          </>
        )}

      </div>
    </Modal>
  )
}
