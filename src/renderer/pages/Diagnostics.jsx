import React, { useMemo, useState } from 'react'
import useStore from '../store'
import Card from '../components/Card'
import Badge from '../components/Badge'
import Button from '../components/Button'
import { POLICY_CATEGORIES, LICENSE_SHORT, LICENSE_LABELS, LICENSE_PLANS } from '../../shared/constants'

const STATUS_META = {
  ok:      { badge: 'success', label: 'OK' },
  warning: { badge: 'warning', label: 'Warning' },
  error:   { badge: 'error', label: 'Error' },
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warning', label: 'Warnings' },
  { id: 'manual', label: 'Manual steps' },
  { id: 'deploy', label: 'Automated' },
]

function SummaryTile({ label, value, tone }) {
  const tones = {
    neutral: 'text-gray-900',
    green: 'text-green-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  }
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <p className={`text-2xl font-bold ${tones[tone] || tones.neutral}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function PolicyRow({ entry }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[entry.status] || STATUS_META.ok
  const hasDetail = entry.errors.length > 0 || entry.warnings.length > 0 || entry.reason || entry.script

  return (
    <>
      <tr
        className={`transition-colors ${hasDetail ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => hasDetail && setOpen((o) => !o)}
      >
        <td className="px-4 py-3">
          <Badge variant={meta.badge}>{meta.label}</Badge>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-navy font-medium whitespace-nowrap">{entry.id}</td>
        <td className="px-4 py-3 text-sm text-gray-800">{entry.name}</td>
        <td className="px-4 py-3">
          {entry.action === 'deploy'
            ? <Badge variant="info">Automated</Badge>
            : <Badge variant="neutral">Manual</Badge>}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
          {entry.syntax.status === 'ok' ? '✓ valid' : entry.syntax.status === 'error' ? <span className="text-red-600 font-semibold">✗ syntax error</span> : '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {(entry.requiredLicenses || []).map((l) => (
              <span key={l} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-navy-100 text-navy">{LICENSE_SHORT[l] || l}</span>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 text-right text-gray-300">
          {hasDetail && (
            <svg className={`w-4 h-4 inline transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-4 pb-4 bg-gray-50/60">
            <div className="space-y-2 pt-1">
              {entry.errors.map((e, i) => (
                <p key={`e${i}`} className="text-xs text-red-700 flex items-start gap-1.5">
                  <span className="font-bold flex-shrink-0">✗</span>{e}
                </p>
              ))}
              {entry.warnings.map((w, i) => (
                <p key={`w${i}`} className="text-xs text-amber-700 flex items-start gap-1.5">
                  <span className="font-bold flex-shrink-0">⚠</span>{w}
                </p>
              ))}
              {entry.reason && (
                <p className="text-xs text-gray-600 flex items-start gap-1.5">
                  <span className="flex-shrink-0">·</span>{entry.reason}
                </p>
              )}
              {(entry.requiredLicenses || []).length > 0 ? (
                <div className="rounded-lg border border-navy-100 bg-navy-50/50 px-3 py-2 space-y-1">
                  <p className="text-xs font-semibold text-navy">
                    Requires {entry.requiredLicenses.length > 1 ? 'all of' : ''}: {entry.requiredLicenses.map((k) => LICENSE_LABELS[k] || k).join(' + ')}
                  </p>
                  {entry.requiredLicenses.map((k) => LICENSE_PLANS[k] && (
                    <p key={k} className="text-[11px] text-gray-500">
                      <span className="font-medium">{LICENSE_SHORT[k] || k}:</span> {LICENSE_PLANS[k].replace(/^Included in:\s*/i, 'included in ')}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">No specific licence required — works with any Microsoft 365 subscription.</p>
              )}
              {entry.cmdlets.length > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="font-medium text-gray-600">Cmdlets:</span> {entry.cmdlets.join(', ')}
                </p>
              )}
              {entry.script && (
                <pre className="mt-2 rounded-lg bg-gray-900 text-gray-100 text-[11px] leading-relaxed p-3 overflow-x-auto max-h-72 overflow-y-auto font-mono whitespace-pre">
                  {entry.script.trim()}
                </pre>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function Diagnostics() {
  const { addNotification } = useStore()
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState(null)
  const [filter, setFilter] = useState('all')
  const [scope, setScope] = useState('all')
  const [prefix, setPrefix] = useState('')
  const [exporting, setExporting] = useState(null)

  const categories = Object.values(POLICY_CATEGORIES)

  const handleRun = async () => {
    if (!window.api?.diagnostics) {
      addNotification('Diagnostics API unavailable — please fully restart the application', 'error')
      return
    }
    setRunning(true)
    try {
      const options = { prefix }
      if (scope !== 'all') options.categories = [scope]
      const result = await window.api.diagnostics.dryRun(options)
      if (result?.error) {
        addNotification(`Dry run failed: ${result.error}`, 'error')
      } else {
        setReport(result)
        if (result.summary.errors > 0) {
          addNotification(`Dry run found ${result.summary.errors} polic${result.summary.errors === 1 ? 'y' : 'ies'} with errors`, 'error')
        } else {
          addNotification(`Dry run complete — ${result.summary.total} policies validated, no errors`, 'success')
        }
      }
    } catch (err) {
      addNotification(`Dry run failed: ${err.message}`, 'error')
    } finally {
      setRunning(false)
    }
  }

  const handleExport = async (format) => {
    if (!report || !window.api?.diagnostics) return
    setExporting(format)
    try {
      const result = await window.api.diagnostics.export(report, format)
      if (result?.error) addNotification(`Export failed: ${result.error}`, 'error')
      else if (result?.success) addNotification(`Exported to ${result.filePath}`, 'success')
    } catch (err) {
      addNotification(`Export failed: ${err.message}`, 'error')
    } finally {
      setExporting(null)
    }
  }

  const visible = useMemo(() => {
    if (!report) return []
    return report.policies.filter((p) => {
      if (filter === 'error') return p.status === 'error'
      if (filter === 'warning') return p.status === 'warning'
      if (filter === 'manual') return p.action === 'manual'
      if (filter === 'deploy') return p.action === 'deploy'
      return true
    })
  }, [report, filter])

  const visibleCats = useMemo(() => [...new Set(visible.map((p) => p.category))], [visible])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Diagnostics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Dry-run every policy module: generate the PowerShell, validate it, and export a debugging report — nothing is deployed
          </p>
        </div>
        <div className="flex gap-2">
          {report && (
            <>
              <Button variant="secondary" size="sm" onClick={() => handleExport('json')} loading={exporting === 'json'}>
                Export JSON
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleExport('md')} loading={exporting === 'md'}>
                Export Markdown
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleExport('ps1')} loading={exporting === 'ps1'}>
                Export Script
              </Button>
            </>
          )}
          <Button variant="primary" size="sm" onClick={handleRun} loading={running}>
            {running ? 'Running…' : 'Run Dry Run'}
          </Button>
        </div>
      </div>

      {/* Scope controls */}
      <Card className="mb-6">
        <Card.Body>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy bg-white"
              >
                <option value="all">All categories ({categories.length})</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name prefix (optional)</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. ACME"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy w-44"
              />
            </div>
            <p className="text-xs text-gray-400 pb-2 flex-1 min-w-[200px]">
              Scripts are generated with default policy settings, checked for structural problems, and parsed by PowerShell for syntax errors. No tenant connection is made and nothing is executed.
            </p>
          </div>
        </Card.Body>
      </Card>

      {!report && !running && (
        <Card>
          <Card.Body>
            <div className="py-12 text-center">
              <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
              <p className="text-sm text-gray-500 font-medium">No dry run yet</p>
              <p className="text-xs text-gray-400 mt-1">Click "Run Dry Run" to generate and validate the deployment scripts for every policy</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {running && !report && (
        <Card>
          <Card.Body>
            <div className="py-12 text-center">
              <svg className="animate-spin w-8 h-8 text-navy mx-auto mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-sm text-gray-500">Generating and validating scripts…</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {report && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            <SummaryTile label="Policies analysed" value={report.summary.total} tone="neutral" />
            <SummaryTile label="Automated" value={report.summary.deploy} tone="green" />
            <SummaryTile label="Manual steps" value={report.summary.manual} tone="amber" />
            <SummaryTile label="Errors" value={report.summary.errors} tone={report.summary.errors ? 'red' : 'green'} />
            <SummaryTile label="Warnings" value={report.summary.warnings} tone={report.summary.warnings ? 'amber' : 'green'} />
          </div>

          {/* Environment strip */}
          <Card className="mb-4">
            <Card.Body>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                <span><span className="font-medium text-gray-600">PowerShell:</span> {report.meta.powershell.found ? report.meta.powershell.version : 'not found'}</span>
                <span><span className="font-medium text-gray-600">Syntax validation:</span> {report.meta.syntaxValidation}</span>
                <span><span className="font-medium text-gray-600">Generated:</span> {new Date(report.meta.generatedAt).toLocaleString()}</span>
                <span><span className="font-medium text-gray-600">Duration:</span> {report.meta.durationMs} ms</span>
                {report.summary.connections.map((c) => (
                  <span key={c.key}>
                    <span className="font-medium text-gray-600">{c.label}:</span> {c.policyCount} policies
                    {c.modules.some((m) => m.installedVersion === null) && <span className="text-red-600 font-medium"> (module missing)</span>}
                  </span>
                ))}
              </div>
              {report.summary.fullScriptErrors.length > 0 && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  {report.summary.fullScriptErrors.map((e, i) => (
                    <p key={i} className="text-xs text-red-700">✗ Full script: {e}</p>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Filter tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4 w-fit">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={[
                  'py-1.5 px-3 rounded-md text-xs font-semibold transition-all',
                  filter === f.id ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f.label}
                {f.id === 'error' && report.summary.errors > 0 && <span className="ml-1 text-red-600">({report.summary.errors})</span>}
                {f.id === 'warning' && report.summary.warnings > 0 && <span className="ml-1 text-amber-600">({report.summary.warnings})</span>}
              </button>
            ))}
          </div>

          {/* Results by category */}
          {visible.length === 0 ? (
            <Card>
              <Card.Body>
                <p className="py-8 text-center text-sm text-gray-400">No policies match this filter</p>
              </Card.Body>
            </Card>
          ) : (
            visibleCats.map((cat) => (
              <Card key={cat} className="mb-4">
                <Card.Header>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-900">{cat}</h2>
                    <span className="text-xs text-gray-400">{visible.filter((p) => p.category === cat).length} policies</span>
                  </div>
                </Card.Header>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">ID</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Policy</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Syntax</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Licences</th>
                        <th className="px-4 py-2.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {visible.filter((p) => p.category === cat).map((entry) => (
                        <PolicyRow key={entry.id} entry={entry} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))
          )}
        </>
      )}
    </div>
  )
}
