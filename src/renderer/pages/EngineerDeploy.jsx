import React, { useState, useEffect } from 'react'
import useStore from '../store'
import { POLICIES } from '../../shared/constants'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import LogPanel from '../components/LogPanel'
import Modal from '../components/Modal'

function policyName(id) {
  return POLICIES.find((p) => p.id === id)?.name || id
}

// ── Template picker ───────────────────────────────────────────────────────────
function TemplatePicker({ templates, selected, onSelect }) {
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm font-medium">No templates available</p>
        <p className="text-gray-400 text-xs mt-1">Ask your admin to create templates in the Create Policies wizard.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t)}
          className={[
            'w-full text-left rounded-lg border-2 px-4 py-4 transition-all',
            selected?.id === t.id
              ? 'border-navy bg-navy-50'
              : 'border-gray-200 hover:border-navy-200 bg-white',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-sm font-semibold ${selected?.id === t.id ? 'text-navy' : 'text-gray-900'}`}>
                  {t.name}
                </span>
                {t.prefix && (
                  <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
                    {t.prefix}
                  </span>
                )}
              </div>
              {t.description && (
                <p className="text-xs text-gray-500 mb-2">{t.description}</p>
              )}
              <p className="text-xs text-gray-400">
                {t.selectedIds.length} {t.selectedIds.length === 1 ? 'policy' : 'policies'} · Created {new Date(t.createdAt).toLocaleDateString()}
              </p>
            </div>
            {selected?.id === t.id && (
              <div className="w-5 h-5 rounded-full bg-navy flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

// ── Auth step ────────────────────────────────────────────────────────────────
function AuthStep({ authMode, setAuthMode, org, setOrg, credentials, setCredentials }) {
  const { orgs, orgsLoading, loadOrgs, settings } = useStore()
  const [passwords, setPasswords] = useState([])
  const [pwLoading, setPwLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (authMode === 'itglue' && settings.itGlueApiKey) loadOrgs()
    if (authMode === 'interactive') {
      setCredentials({ interactive: true, username: '', password: '', tenantId: '' })
    }
  }, [authMode])

  useEffect(() => {
    if (!org || org.id === 'manual' || !window.api) return
    setPwLoading(true)
    window.api.itglue.getPasswords(org.id)
      .then((res) => setPasswords(res || []))
      .catch(() => setPasswords([]))
      .finally(() => setPwLoading(false))
  }, [org?.id])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 mb-2">
        {[
          { id: 'itglue', label: 'IT Glue', icon: '🔗', desc: 'Resolve credentials from IT Glue' },
          { id: 'interactive', label: 'WAM / Browser', icon: '🌐', desc: 'Sign in interactively' },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => { setAuthMode(m.id); setOrg(null); setCredentials(null) }}
            className={[
              'flex flex-col items-start gap-1 px-4 py-3 rounded-lg border-2 text-left transition-all text-sm cursor-pointer',
              authMode === m.id ? 'border-navy bg-navy-50' : 'border-gray-200 hover:border-gray-300 bg-white',
            ].join(' ')}
          >
            <span className="text-base">{m.icon}</span>
            <span className={`font-semibold ${authMode === m.id ? 'text-navy' : 'text-gray-700'}`}>{m.label}</span>
            <span className="text-xs text-gray-500">{m.desc}</span>
          </button>
        ))}
      </div>

      {authMode === 'itglue' && (
        <>
          {!settings.itGlueApiKey ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              IT Glue API key not configured. Ask your admin to set it in Settings.
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Select organisation</p>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search organisations..."
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm mb-2 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
                <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                  {orgsLoading
                    ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 bg-gray-100 rounded-lg animate-pulse" />)
                    : orgs.filter((o) => !search || o.name.toLowerCase().includes(search.toLowerCase())).map((o) => (
                        <button
                          key={o.id}
                          onClick={() => { setOrg(o); setCredentials(null) }}
                          className={[
                            'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-left text-sm transition-all',
                            org?.id === o.id ? 'border-navy bg-navy-50 text-navy font-medium' : 'border-gray-200 hover:border-gray-50',
                          ].join(' ')}
                        >
                          <span>{o.name}</span>
                          {o.shortName && <span className="text-xs text-gray-400">{o.shortName}</span>}
                        </button>
                      ))
                  }
                </div>
              </div>
              {org && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Select credential</p>
                  {pwLoading
                    ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 bg-gray-100 rounded-lg animate-pulse mb-1" />)
                    : passwords.length === 0
                      ? <p className="text-sm text-gray-400 py-3 text-center">No passwords found</p>
                      : (
                          <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                            {passwords.map((pw) => (
                              <button
                                key={pw.id}
                                onClick={() => setCredentials({ username: pw.username, password: pw.password, tenantId: '' })}
                                className={[
                                  'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-left text-sm transition-all',
                                  credentials?.username === pw.username ? 'border-navy bg-navy-50 text-navy' : 'border-gray-200 hover:bg-gray-50',
                                ].join(' ')}
                              >
                                <div>
                                  <p className="font-medium text-gray-800">{pw.name}</p>
                                  <p className="text-xs text-gray-500">{pw.username}</p>
                                </div>
                                <Badge variant="neutral">{pw.resourceType || 'Credential'}</Badge>
                              </button>
                            ))}
                          </div>
                        )
                  }
                </div>
              )}
              {credentials && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tenant domain or ID <span className="font-normal text-gray-500">(optional)</span></label>
                  <input
                    type="text"
                    value={credentials.tenantId || ''}
                    onChange={(e) => setCredentials(prev => ({ ...prev, tenantId: e.target.value.trim() }))}
                    placeholder="e.g. contoso.onmicrosoft.com"
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                  />
                  <p className="text-xs text-gray-400 mt-1">Leave blank to sign in to your home tenant</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {authMode === 'interactive' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tenant / Organisation name</label>
            <input
              type="text"
              value={org?.name || ''}
              onChange={(e) => setOrg({ id: 'manual', name: e.target.value, shortName: '' })}
              placeholder="e.g. AffinityIT"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tenant domain or ID <span className="font-normal text-gray-500">(optional)</span></label>
            <input
              type="text"
              value={credentials?.tenantId || ''}
              onChange={(e) => setCredentials(prev => ({ ...(prev || { interactive: true }), tenantId: e.target.value.trim() }))}
              placeholder="e.g. contoso.onmicrosoft.com"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
            <p className="text-xs text-gray-400 mt-1">Leave blank to sign in to your home tenant</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            A browser sign-in window will open when deployment starts. No credentials are stored in this application.
          </div>
        </>
      )}
    </div>
  )
}

// ── Review ────────────────────────────────────────────────────────────────────
function ReviewStep({ template, authMode, org, credentials }) {
  const policies = POLICIES.filter((p) => template.selectedIds.includes(p.id))
  const byCategory = policies.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Template</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Organisation</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{org?.name || '—'}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Account</p>
          <p className="text-sm font-semibold text-gray-900 truncate">
            {authMode === 'interactive' ? 'Browser / device code' : (credentials?.username || '—')}
          </p>
        </div>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        <strong>{template.selectedIds.length} policies</strong> will be created in the <strong>{org?.name}</strong> tenant.
      </div>
      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
        {Object.entries(byCategory).map(([cat, ps]) => (
          <div key={cat}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{cat}</p>
            <div className="space-y-0.5">
              {ps.map((p) => {
                const cfg = template.policyConfigs?.[p.id] || {}
                const sv = cfg.state || 'enabled'
                const sl = { enabled: 'On', disabled: 'Off', enabledForReportingButNotEnforced: 'Report' }[sv] || sv
                const variant = { enabled: 'success', disabled: 'neutral', enabledForReportingButNotEnforced: 'warning' }[sv] || 'neutral'
                return (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 px-3 rounded-md hover:bg-gray-50">
                    <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{p.id}</span>
                    <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                    <Badge variant={variant}>{sl}</Badge>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
const STEPS = ['Select Template', 'Connect', 'Review', 'Deploy']

export default function EngineerDeploy() {
  const { templates, addNotification } = useStore()
  const [step, setStep] = useState(1)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [authMode, setAuthMode] = useState('itglue')
  const [org, setOrg] = useState(null)
  const [credentials, setCredentials] = useState(null)
  const [logs, setLogs] = useState([])
  const [results, setResults] = useState({})
  const [running, setRunning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!window.api) return
    const unOut = window.api.onPsOutput((line) => setLogs((l) => [...l, { line, type: 'output' }]))
    const unErr = window.api.onPsError((line) => setLogs((l) => [...l, { line, type: 'error' }]))
    return () => { unOut?.(); unErr?.() }
  }, [])

  const canNext = () => {
    if (step === 1) return !!selectedTemplate
    if (step === 2) {
      if (!org?.name) return false
      if (authMode === 'interactive') return true
      return !!(credentials?.username && credentials?.password)
    }
    if (step === 3) return true
    return false
  }

  const handleDeploy = async () => {
    if (!window.api || !selectedTemplate) return
    setConfirmOpen(false)
    setRunning(true)
    setLogs([])
    setResults({})
    const selectedPolicies = POLICIES.filter((p) => selectedTemplate.selectedIds.includes(p.id))
    try {
      const result = await window.api.policies.create({
        policies: selectedPolicies,
        credentials,
        prefix: selectedTemplate.prefix || '',
        authMode,
        policyConfigs: selectedTemplate.policyConfigs || {},
      })
      setResults(result.results || {})
      const successCount = Object.values(result.results || {}).filter((v) => v === 'success').length
      addNotification(`Deployment complete: ${successCount}/${selectedTemplate.selectedIds.length} policies created`, 'success')
    } catch (err) {
      addNotification('Deployment failed: ' + err.message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setStep(1); setSelectedTemplate(null); setOrg(null); setCredentials(null)
    setLogs([]); setResults({})
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Deploy Template</h1>
        <p className="mt-1 text-sm text-gray-500">Deploy an admin-created policy template to a tenant</p>
      </div>

      {/* Step bar */}
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className={[
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              step === i + 1 ? 'bg-navy text-white' : step > i + 1 ? 'bg-navy/20 text-navy' : 'bg-gray-100 text-gray-500',
            ].join(' ')}>
              <span className={[
                'w-4 h-4 rounded-full flex items-center justify-center text-xs flex-shrink-0',
                step > i + 1 ? 'bg-navy text-white' : '',
              ].join(' ')}>
                {step > i + 1
                  ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  : i + 1
                }
              </span>
              {s}
            </div>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-200" />}
          </React.Fragment>
        ))}
      </div>

      <Card>
        <Card.Header>
          <h2 className="text-base font-semibold text-gray-900">Step {step}: {STEPS[step - 1]}</h2>
        </Card.Header>
        <Card.Body>
          {step === 1 && (
            <TemplatePicker
              templates={templates}
              selected={selectedTemplate}
              onSelect={setSelectedTemplate}
            />
          )}
          {step === 2 && (
            <AuthStep
              authMode={authMode} setAuthMode={setAuthMode}
              org={org} setOrg={setOrg}
              credentials={credentials} setCredentials={setCredentials}
            />
          )}
          {step === 3 && selectedTemplate && (
            <ReviewStep
              template={selectedTemplate}
              authMode={authMode}
              org={org}
              credentials={credentials}
            />
          )}
          {step === 4 && (
            <div className="space-y-4">
              <LogPanel logs={logs} height="h-52" title="Deployment Output" />
              {Object.keys(results).length > 0 && (
                <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Policy Results</p>
                  {selectedTemplate.selectedIds.map((id) => (
                    <div key={id} className="flex items-center gap-3 py-1.5 px-3 rounded-md bg-gray-50">
                      <span className="text-xs font-mono text-gray-400 w-12">{id}</span>
                      <span className="text-sm text-gray-800 flex-1">{policyName(id)}</span>
                      {results[id] === 'success'
                        ? <Badge variant="success">Success</Badge>
                        : results[id] === 'failure'
                          ? <Badge variant="error">Failed</Badge>
                          : <Badge variant="neutral">Pending</Badge>
                      }
                    </div>
                  ))}
                </div>
              )}
              {running && (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Deploying policies...
                </div>
              )}
            </div>
          )}
        </Card.Body>
        <Card.Footer>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || running || step === 4}>
              Back
            </Button>
            <div className="flex gap-2">
              {step < 4 && (
                <Button
                  variant="primary"
                  onClick={() => step === 3 ? setConfirmOpen(true) : setStep((s) => s + 1)}
                  disabled={!canNext() || running}
                >
                  {step === 3 ? 'Deploy Template' : 'Next'}
                </Button>
              )}
              {step === 4 && !running && Object.keys(results).length > 0 && (
                <Button variant="secondary" onClick={reset}>Deploy Another</Button>
              )}
            </div>
          </div>
        </Card.Footer>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        variant="warning"
        title="Confirm Template Deployment"
        confirmLabel="Deploy Now"
        cancelLabel="Cancel"
        onConfirm={() => { setStep(4); handleDeploy() }}
      >
        <div className="py-2 space-y-2">
          <p>
            You are about to deploy template <strong>{selectedTemplate?.name}</strong> ({selectedTemplate?.selectedIds.length} policies) to <strong>{org?.name}</strong>.
          </p>
          {authMode === 'interactive' && (
            <p className="text-blue-700">A browser sign-in window will open. Complete the authentication to begin deployment.</p>
          )}
          <p className="text-amber-700">This will modify the Microsoft 365 security configuration for that tenant.</p>
        </div>
      </Modal>
    </div>
  )
}
