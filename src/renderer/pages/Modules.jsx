import React, { useEffect, useState } from 'react'
import useStore from '../store'
import Card from '../components/Card'
import Badge from '../components/Badge'
import Button from '../components/Button'
import StatusIndicator from '../components/StatusIndicator'
import Tooltip from '../components/Tooltip'
import ManualInstallModal from '../components/ManualInstallModal'

const isLinux = typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('linux')
const isWin = typeof navigator !== 'undefined' && navigator.userAgent?.includes('Windows')

function statusBadge(status) {
  switch (status) {
    case 'up_to_date': return <Badge variant="success">Up to Date</Badge>
    case 'update_available': return <Badge variant="warning">Update Available</Badge>
    case 'update_unknown': return <Badge variant="neutral">Installed (update check failed)</Badge>
    case 'not_installed': return <Badge variant="error">Not Installed</Badge>
    default: return <Badge variant="neutral">Unknown</Badge>
  }
}

export default function Modules() {
  const {
    modules, modulesLoading, psStatus, loadModules, addNotification,
    moduleOpInProgress, setModuleOpInProgress,
  } = useStore()
  const [installing, setInstalling] = useState(new Set())
  const [installingPs, setInstallingPs] = useState(false)
  const [manualInstall, setManualInstall] = useState(null)

  useEffect(() => {
    loadModules()
  }, [])

  function notifyResult(resultLogs, successMsg, requestedModules) {
    const errors = resultLogs.filter(l => l.startsWith('ERROR:'))
    if (errors.length > 0) {
      addNotification(`Operation failed — check output below for details`, 'error')
      // PS error lines look like "ERROR: <module> - <message>"; fall back to
      // everything requested when the failure wasn't tied to a specific module
      const errored = new Set(errors.map(l => l.match(/^ERROR:\s+(\S+)\s+-/)?.[1]).filter(Boolean))
      const failed = (requestedModules || []).filter(m => errored.has(m))
      setManualInstall({ modules: failed.length ? failed : (requestedModules || []) })
    } else if (resultLogs.some(l => l.startsWith('SUCCESS:'))) {
      addNotification(successMsg, 'success')
    } else {
      addNotification('Operation completed — check output below', 'info')
    }
  }

  const handleInstall = async (moduleName) => {
    if (!window.api) return
    setInstalling((s) => new Set([...s, moduleName]))
    setModuleOpInProgress(true)
    try {
      const result = await window.api.modules.install([moduleName])
      notifyResult(result || [], `${moduleName} installed successfully`, [moduleName])
      await loadModules()
    } catch (err) {
      addNotification(`Install failed: ${err.message}`, 'error')
      setManualInstall({ modules: [moduleName] })
    } finally {
      setInstalling((s) => { const ns = new Set(s); ns.delete(moduleName); return ns })
      setModuleOpInProgress(false)
    }
  }

  const handleUpdate = async (moduleName) => {
    if (!window.api) return
    setInstalling((s) => new Set([...s, moduleName]))
    setModuleOpInProgress(true)
    try {
      const result = await window.api.modules.update([moduleName])
      notifyResult(result || [], `${moduleName} updated successfully`, [moduleName])
      await loadModules()
    } catch (err) {
      addNotification(`Update failed: ${err.message}`, 'error')
      setManualInstall({ modules: [moduleName] })
    } finally {
      setInstalling((s) => { const ns = new Set(s); ns.delete(moduleName); return ns })
      setModuleOpInProgress(false)
    }
  }

  const handleInstallAll = async () => {
    if (!window.api) return
    const toInstall = modules.filter((m) => m.Status === 'not_installed').map((m) => m.Name)
    if (!toInstall.length) { addNotification('All modules are already installed', 'info'); return }
    setModuleOpInProgress(true)
    try {
      const result = await window.api.modules.install(toInstall)
      notifyResult(result || [], 'All missing modules installed successfully', toInstall)
      await loadModules()
    } catch (err) {
      addNotification(`Install all failed: ${err.message}`, 'error')
      setManualInstall({ modules: toInstall })
    } finally {
      setModuleOpInProgress(false)
    }
  }

  const handleUpdateAll = async () => {
    if (!window.api) return
    const toUpdate = modules.filter((m) => m.Status === 'update_available').map((m) => m.Name)
    if (!toUpdate.length) { addNotification('No updates available', 'info'); return }
    setModuleOpInProgress(true)
    try {
      const result = await window.api.modules.update(toUpdate)
      notifyResult(result || [], 'All modules updated successfully', toUpdate)
      await loadModules()
    } catch (err) {
      addNotification(`Update all failed: ${err.message}`, 'error')
      setManualInstall({ modules: toUpdate })
    } finally {
      setModuleOpInProgress(false)
    }
  }

  const handleInstallPs = async () => {
    if (!window.api) return
    setInstallingPs(true)
    try {
      const result = await window.api.modules.installPowerShell()
      if (result.success) {
        addNotification('PowerShell installed successfully', 'success')
        await loadModules()
      } else {
        addNotification(result.message || 'PowerShell installation failed', 'error')
      }
    } catch (err) {
      addNotification(err.message, 'error')
    } finally {
      setInstallingPs(false)
    }
  }

  const notInstalled = modules.filter((m) => m.Status === 'not_installed').length
  const updateAvail = modules.filter((m) => m.Status === 'update_available').length

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PowerShell Modules</h1>
          <p className="mt-1 text-sm text-gray-500">Manage required modules for M365 policy management</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={loadModules} loading={modulesLoading} disabled={moduleOpInProgress}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Check Status
          </Button>
          {updateAvail > 0 && (
            <Button variant="secondary" size="sm" onClick={handleUpdateAll} loading={moduleOpInProgress}>
              Update All ({updateAvail})
            </Button>
          )}
          {notInstalled > 0 && (
            <Button variant="primary" size="sm" onClick={handleInstallAll} loading={moduleOpInProgress}>
              Install Missing ({notInstalled})
            </Button>
          )}
        </div>
      </div>

      {/* PowerShell status */}
      <Card className="mb-6">
        <Card.Body>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <StatusIndicator
                status={psStatus?.found ? 'ok' : psStatus === null ? 'loading' : 'error'}
                label={psStatus?.found ? `PowerShell found: ${psStatus.version}` : psStatus === null ? 'Checking...' : 'PowerShell not found'}
              />
              {psStatus?.path && (
                <span className="text-xs text-gray-400 font-mono">{psStatus.path}</span>
              )}
            </div>
            {!psStatus?.found && psStatus !== null && (
              <div className="flex items-center gap-2">
                {!isWin && (
                  <Button variant="primary" size="sm" onClick={handleInstallPs} loading={installingPs}>
                    Install PowerShell
                  </Button>
                )}
                {isWin && (
                  <span className="text-xs text-gray-500">Download PowerShell 7 from microsoft.com/powershell</span>
                )}
              </div>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* Module table */}
      <Card className="mb-6">
        <Card.Header>
          <h2 className="text-sm font-semibold text-gray-900">Required Modules</h2>
        </Card.Header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Module</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Installed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Latest</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {modulesLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {[1, 2, 3, 4, 5, 6].map((j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : modules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-400">
                    No module data available. Click "Check Status" to refresh.
                  </td>
                </tr>
              ) : (
                modules.map((mod) => {
                  const isLoading = installing.has(mod.Name)
                  return (
                    <tr key={mod.Name} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-navy font-medium">{mod.Name}</td>
                      <td className="px-4 py-4 text-xs text-gray-600 max-w-xs">
                        <Tooltip content={mod.description} position="top">
                          <span className="truncate block max-w-[200px]">{mod.description}</span>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-4 text-xs font-mono text-gray-500">{mod.InstalledVersion || '—'}</td>
                      <td className="px-4 py-4 text-xs font-mono text-gray-500">{mod.LatestVersion || '—'}</td>
                      <td className="px-4 py-4">{statusBadge(mod.Status)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {mod.Status === 'not_installed' && (
                            <Button size="sm" variant="primary" loading={isLoading} disabled={moduleOpInProgress && !isLoading} onClick={() => handleInstall(mod.Name)}>
                              Install
                            </Button>
                          )}
                          {mod.Status === 'update_available' && (
                            <Button size="sm" variant="secondary" loading={isLoading} disabled={moduleOpInProgress && !isLoading} onClick={() => handleUpdate(mod.Name)}>
                              Update
                            </Button>
                          )}
                          {mod.Status === 'up_to_date' && (
                            <span className="text-xs text-green-600 font-medium px-2">Current</span>
                          )}
                          {mod.Status === 'unknown' && (
                            <Button size="sm" variant="ghost" loading={isLoading} disabled={moduleOpInProgress && !isLoading} onClick={() => handleInstall(mod.Name)}>
                              Install
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Log panel */}

      <ManualInstallModal info={manualInstall} onDismiss={() => setManualInstall(null)} />
    </div>
  )
}
