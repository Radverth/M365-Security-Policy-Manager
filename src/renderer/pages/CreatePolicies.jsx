import React, { useState, useEffect, useMemo } from 'react'
import useStore from '../store'
import { POLICIES, POLICIES_BY_CATEGORY } from '../../shared/constants'
import ProgressStep from '../components/ProgressStep'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import SearchInput from '../components/SearchInput'
import Modal from '../components/Modal'
import ConfigurePolicies from './ConfigurePolicies'
import DeviceCodeModal, { parseDeviceCode } from '../components/DeviceCodeModal'

const STEPS = ['Org & Credentials', 'Configure Prefix', 'Select Policies', 'Configure Policies', 'Review', 'Deploy']

function severityBadge(sev) {
  const v = { critical: 'error', high: 'high', medium: 'warning', low: 'info', info: 'neutral' }[sev] || 'neutral'
  return <Badge variant={v}>{sev}</Badge>
}

function resultBadge(status) {
  if (status === 'success') return <Badge variant="success">Created</Badge>
  if (status === 'failure') return <Badge variant="error">Failed</Badge>
  if (status === 'skipped') return <Badge variant="warning">Skipped</Badge>
  return <Badge variant="neutral">Pending</Badge>
}

// ── Auth mode selector banner ─────────────────────────────────────────────────
function AuthModeBanner({ mode, onChange, locked }) {
  const modes = [
    { id: 'itglue',      label: 'IT Glue',  icon: '🔗', desc: 'Resolve credentials from IT Glue and authenticate via WAM' },
    { id: 'interactive', label: 'WAM / Browser', icon: '🌐', desc: 'Sign in interactively via browser or device code' },
  ]
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Authentication method</p>
      <div className="grid grid-cols-2 gap-3">
        {modes.map((m) => (
          <button
            key={m.id}
            disabled={locked}
            onClick={() => onChange(m.id)}
            className={[
              'relative flex flex-col items-start gap-1 px-4 py-3 rounded-lg border-2 text-left transition-all text-sm',
              locked && mode !== m.id ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
              mode === m.id
                ? 'border-navy bg-navy-50'
                : 'border-gray-200 hover:border-gray-300 bg-white',
            ].join(' ')}
          >
            <span className="text-base leading-none">{m.icon}</span>
            <span className={`font-semibold ${mode === m.id ? 'text-navy' : 'text-gray-700'}`}>{m.label}</span>
            <span className="text-xs text-gray-500 leading-snug">{m.desc}</span>
            {mode === m.id && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-navy" />
            )}
          </button>
        ))}
      </div>
      {locked && (
        <p className="mt-1.5 text-xs text-gray-400">Auth method locked — go back to step 1 to change</p>
      )}
    </div>
  )
}

// ── Step 1: Org & Credentials (content varies by auth mode) ──────────────────
function StepOrgAndCredentials({ authMode, org, setOrg, credentials, setCredentials, useDeviceCode, setUseDeviceCode }) {
  if (authMode === 'itglue') return <StepItGlue org={org} setOrg={setOrg} credentials={credentials} setCredentials={setCredentials} />
  if (authMode === 'interactive') return <StepInteractive org={org} setOrg={setOrg} credentials={credentials} setCredentials={setCredentials} useDeviceCode={useDeviceCode} setUseDeviceCode={setUseDeviceCode} />
  return null
}

function StepItGlue({ org, setOrg, credentials, setCredentials }) {
  const { orgs, orgsLoading, loadOrgs, settings } = useStore()
  const [passwords, setPasswords] = useState([])
  const [pwLoading, setPwLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (settings.itGlueApiKey) loadOrgs()
  }, [])

  useEffect(() => {
    if (!org || org.id === 'manual' || !window.api) return
    setPwLoading(true)
    window.api.itglue.getPasswords(org.id)
      .then((res) => setPasswords(res || []))
      .catch(() => setPasswords([]))
      .finally(() => setPwLoading(false))
  }, [org?.id])

  if (!settings.itGlueApiKey) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-center">
        <p className="text-sm font-medium text-amber-800 mb-1">IT Glue API key not configured</p>
        <p className="text-xs text-amber-700">Go to Settings and add your IT Glue API key, or switch to Manual or Interactive mode above.</p>
      </div>
    )
  }

  const filtered = orgs.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    (o.shortName || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      {/* Org picker */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Select organisation</p>
        <SearchInput value={search} onChange={setSearch} placeholder="Search organisations..." />
        <div className="mt-2 max-h-52 overflow-y-auto space-y-1 pr-1">
          {orgsLoading ? (
            Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-11 bg-gray-100 rounded-lg animate-pulse" />)
          ) : filtered.map((o) => (
            <button
              key={o.id}
              onClick={() => { setOrg(o); setCredentials(null) }}
              className={[
                'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-left text-sm transition-all',
                org?.id === o.id ? 'border-navy bg-navy-50 text-navy font-medium' : 'border-gray-200 hover:border-navy-200 hover:bg-gray-50',
              ].join(' ')}
            >
              <span>{o.name}</span>
              {o.shortName && <span className="text-xs text-gray-400">{o.shortName}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Password picker */}
      {org && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Select credential</p>
          {pwLoading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 bg-gray-100 rounded-lg animate-pulse mb-1" />)
          ) : passwords.length === 0 ? (
            <p className="text-sm text-gray-400 py-3 text-center">No passwords found for this organisation</p>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
              {passwords.map((pw) => (
                <button
                  key={pw.id}
                  onClick={() => setCredentials({ username: pw.username, password: pw.password, tenantId: '' })}
                  className={[
                    'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border text-left text-sm transition-all',
                    credentials?.username === pw.username ? 'border-navy bg-navy-50 text-navy' : 'border-gray-200 hover:border-navy-200 hover:bg-gray-50',
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
          )}
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
    </div>
  )
}

function StepInteractive({ org, setOrg, credentials, setCredentials, useDeviceCode, setUseDeviceCode }) {
  useEffect(() => {
    // Signal interactive auth — no password needed
    setCredentials({ interactive: true, username: '', password: '', tenantId: '' })
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Organisation / Tenant name</label>
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

      <div className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg">
        <input
          id="device-code"
          type="checkbox"
          checked={useDeviceCode}
          onChange={(e) => setUseDeviceCode(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy cursor-pointer"
        />
        <div>
          <label htmlFor="device-code" className="text-sm font-medium text-gray-700 cursor-pointer">
            Use device code (no browser popup)
          </label>
          <p className="text-xs text-gray-500 mt-0.5">
            A code appears in the log — open any browser you choose (incognito/private) at <code className="font-mono bg-gray-100 px-1 rounded">aka.ms/devicelogin</code>.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
          </svg>
          <p className="text-sm font-semibold text-blue-800">Interactive / WAM authentication</p>
        </div>
        <p className="text-sm text-blue-700">
          When you click Deploy, PowerShell will open a browser sign-in window (or show a device code). Sign in with your Global Admin or Security Admin account — MFA and conditional access policies will be honoured automatically.
        </p>
        <p className="text-xs text-blue-600">
          No credentials are stored or passed through this application.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
        <p className="text-xs font-medium text-gray-600">How it works</p>
        <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
          <li>PowerShell runs <code className="font-mono bg-white px-1 rounded border border-gray-200">Connect-MgGraph</code> with no stored credentials</li>
          <li>A browser window (or device code) opens for interactive sign-in</li>
          <li>After authentication, policies are deployed and the session is closed</li>
        </ol>
      </div>
    </div>
  )
}

// ── Step 2: Configure Prefix ──────────────────────────────────────────────────
const POLICY_MODE_OPTIONS = [
  {
    id: 'enabled',
    label: 'Active',
    desc: 'All policies are deployed and enforced immediately.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    id: 'enabledForReportingButNotEnforced',
    label: 'Report-Only',
    desc: 'CA policies created in report-only mode. All other policies are skipped.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

function StepConfigurePrefix({ usePrefix, setUsePrefix, prefix, setPrefix, defaultPrefix, orgName, policyMode, setPolicyMode }) {
  const effectiveDefault = orgName || defaultPrefix || ''
  const preview = usePrefix && prefix ? `${prefix} — CA001: Require MFA for All Users` : 'CA001: Require MFA for All Users'

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg">
        <input
          id="use-prefix"
          type="checkbox"
          checked={usePrefix}
          onChange={(e) => setUsePrefix(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy"
        />
        <div>
          <label htmlFor="use-prefix" className="text-sm font-medium text-gray-700">Add a prefix to all policy names</label>
          <p className="text-xs text-gray-500 mt-0.5">Helps identify which client/tenant the policies belong to.</p>
        </div>
      </div>

      {usePrefix && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Prefix Text</label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder={effectiveDefault || 'e.g. AffinityIT'}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
          {effectiveDefault && !prefix && (
            <button onClick={() => setPrefix(effectiveDefault)} className="text-xs text-navy hover:underline">
              Use: "{effectiveDefault}"
            </button>
          )}
        </div>
      )}

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 mb-1">Policy Name Preview</p>
        <p className="text-sm font-mono text-gray-800">{preview}</p>
      </div>

      {/* Policy mode */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">Policy creation mode</p>
        <p className="text-xs text-gray-500 mb-3">
          Active deploys everything. Report-Only creates CA policies in monitor mode and skips all others — useful for auditing impact before full enforcement.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {POLICY_MODE_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => setPolicyMode(m.id)}
              className={[
                'relative flex flex-col items-start gap-1.5 px-4 py-3 rounded-lg border-2 text-left transition-all',
                policyMode === m.id
                  ? 'border-navy bg-navy-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white',
              ].join(' ')}
            >
              <div className={`flex items-center gap-2 ${policyMode === m.id ? 'text-navy' : 'text-gray-600'}`}>
                {m.icon}
                <span className="text-sm font-semibold">{m.label}</span>
              </div>
              <span className="text-xs text-gray-500 leading-snug">{m.desc}</span>
              {policyMode === m.id && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-navy" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Step 3: Select Policies ───────────────────────────────────────────────────

const CATEGORY_META = {
  'Conditional Access':   { color: 'border-purple-200 bg-purple-50',  ring: 'ring-purple-400',  badge: 'bg-purple-100 text-purple-700',  dot: 'bg-purple-500',  icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
  ) },
  'Identity Protection':  { color: 'border-indigo-200 bg-indigo-50',  ring: 'ring-indigo-400',  badge: 'bg-indigo-100 text-indigo-700',  dot: 'bg-indigo-500',  icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
  ) },
  'Exchange Online':      { color: 'border-blue-200 bg-blue-50',      ring: 'ring-blue-400',    badge: 'bg-blue-100 text-blue-700',    dot: 'bg-blue-500',    icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
  ) },
  'SharePoint & OneDrive':{ color: 'border-sky-200 bg-sky-50',        ring: 'ring-sky-400',     badge: 'bg-sky-100 text-sky-700',     dot: 'bg-sky-500',     icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
  ) },
  'Teams':                { color: 'border-teal-200 bg-teal-50',      ring: 'ring-teal-400',    badge: 'bg-teal-100 text-teal-700',    dot: 'bg-teal-500',    icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" /></svg>
  ) },
  'Intune / Endpoint':    { color: 'border-green-200 bg-green-50',    ring: 'ring-green-400',   badge: 'bg-green-100 text-green-700',   dot: 'bg-green-500',   icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" /></svg>
  ) },
  'Defender':             { color: 'border-red-200 bg-red-50',        ring: 'ring-red-400',     badge: 'bg-red-100 text-red-700',     dot: 'bg-red-500',     icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286zm0 13.036h.008v.008H12v-.008z" /></svg>
  ) },
  'Audit & Compliance':   { color: 'border-amber-200 bg-amber-50',    ring: 'ring-amber-400',   badge: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500',   icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>
  ) },
  'Admin Security':       { color: 'border-orange-200 bg-orange-50',  ring: 'ring-orange-400',  badge: 'bg-orange-100 text-orange-700',  dot: 'bg-orange-500',  icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
  ) },
  'Tenant Baseline':      { color: 'border-gray-300 bg-gray-50',      ring: 'ring-gray-400',    badge: 'bg-gray-100 text-gray-700',    dot: 'bg-gray-500',    icon: (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>
  ) },
}

const SEVERITY_DOT = {
  critical: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-amber-400',
  low: 'bg-blue-400',
  info: 'bg-gray-400',
}

function PolicyGridItem({ p, isSelected, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={[
        'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors w-full',
        isSelected
          ? 'bg-navy/5 border-navy/25'
          : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50',
      ].join(' ')}
    >
      <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
        isSelected ? 'bg-navy border-navy' : 'border-gray-300'
      }`}>
        {isSelected && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <span className="text-xs font-mono text-gray-400 w-10 flex-shrink-0">{p.id}</span>
      <span className="text-xs text-gray-800 flex-1 min-w-0 truncate">{p.name}</span>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[p.severity] || 'bg-gray-400'}`} title={p.severity} />
    </button>
  )
}

function StepSelectPolicies({ selected, setSelected }) {
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')
  const selSet = useMemo(() => new Set(selected), [selected])
  const categories = Object.keys(POLICIES_BY_CATEGORY)

  const displayPolicies = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (q) return POLICIES.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
    if (activeCat) return POLICIES_BY_CATEGORY[activeCat] || []
    return POLICIES
  }, [activeCat, search])

  const groupedView = !search.trim() && !activeCat

  function toggle(id) {
    setSelected(s => selSet.has(id) ? s.filter(x => x !== id) : [...s, id])
  }

  function toggleCat(cat) {
    const ids = (POLICIES_BY_CATEGORY[cat] || []).map(p => p.id)
    const allSel = ids.every(id => selSet.has(id))
    setSelected(s => allSel ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])])
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search + count bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search policies..."
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>
        <span className="text-sm text-gray-500 whitespace-nowrap">
          <strong className="text-gray-900">{selected.length}</strong>/{POLICIES.length}
        </span>
        <button onClick={() => setSelected(POLICIES.map(p => p.id))} className="text-xs text-navy hover:underline whitespace-nowrap">All</button>
        <button onClick={() => setSelected([])} className="text-xs text-gray-500 hover:underline whitespace-nowrap">None</button>
      </div>

      {/* Two-pane selector — fills remaining viewport height */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 390px)', minHeight: '380px' }}>
        {/* Category sidebar */}
        <div className="w-44 flex-shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
          <button
            onClick={() => { setActiveCat(null); setSearch('') }}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium border-b border-gray-200 transition-colors ${!activeCat && !search ? 'bg-navy text-white' : 'text-gray-700 hover:bg-white'}`}
          >
            <span>All policies</span>
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${!activeCat && !search ? 'bg-white/20' : 'bg-gray-200 text-gray-600'}`}>{selected.length}</span>
          </button>
          {categories.map(cat => {
            const catIds = (POLICIES_BY_CATEGORY[cat] || []).map(p => p.id)
            const selCount = catIds.filter(id => selSet.has(id)).length
            const isActive = activeCat === cat && !search
            const meta = CATEGORY_META[cat] || {}
            return (
              <button
                key={cat}
                onClick={() => { setActiveCat(cat); setSearch('') }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left border-b border-gray-100 transition-colors ${
                  isActive ? 'bg-navy-50 text-navy font-semibold border-l-2 border-l-navy' : 'text-gray-600 hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot || 'bg-gray-400'}`} />
                  <span className="truncate leading-snug">{cat}</span>
                </div>
                <span className={`ml-1 flex-shrink-0 px-1 py-0.5 rounded text-xs ${
                  selCount === catIds.length && catIds.length > 0 ? 'bg-green-100 text-green-700' :
                  selCount > 0 ? 'bg-blue-50 text-navy' : 'bg-gray-100 text-gray-500'
                }`}>{selCount}/{catIds.length}</span>
              </button>
            )
          })}
        </div>

        {/* Policy grid — 2 columns so most categories fit without scrolling */}
        <div className="flex-1 overflow-y-auto p-3">
          {search.trim() && displayPolicies.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">No policies match "{search}"</p>
          ) : groupedView ? (
            categories.map(cat => {
              const catPolicies = POLICIES_BY_CATEGORY[cat] || []
              const catIds = catPolicies.map(p => p.id)
              const selCount = catIds.filter(id => selSet.has(id)).length
              const meta = CATEGORY_META[cat] || {}
              return (
                <div key={cat} className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${meta.dot || 'bg-gray-400'}`} />
                      <span className="text-xs font-semibold text-gray-600">{cat}</span>
                      <span className="text-xs text-gray-400">({selCount}/{catIds.length})</span>
                    </div>
                    <button onClick={() => toggleCat(cat)} className="text-xs text-navy hover:underline">
                      {selCount === catIds.length ? 'Deselect' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {catPolicies.map(p => (
                      <PolicyGridItem key={p.id} p={p} isSelected={selSet.has(p.id)} onToggle={() => toggle(p.id)} />
                    ))}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {displayPolicies.map(p => (
                <PolicyGridItem key={p.id} p={p} isSelected={selSet.has(p.id)} onToggle={() => toggle(p.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Per-category quick actions when a single category is active */}
      {activeCat && !search && (() => {
        const catIds = (POLICIES_BY_CATEGORY[activeCat] || []).map(p => p.id)
        const selCount = catIds.filter(id => selSet.has(id)).length
        return (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{selCount}/{catIds.length} selected in {activeCat}</span>
            <button onClick={() => toggleCat(activeCat)} className="text-navy hover:underline">
              {selCount === catIds.length ? 'Deselect all in category' : 'Select all in category'}
            </button>
          </div>
        )
      })()}
    </div>
  )
}

// ── Step 4: Configure Policies — delegated to ConfigurePolicies component ─────
// (inline in wizard body below)

// ── Step 5: Review ────────────────────────────────────────────────────────────
function StepReview({ authMode, org, credentials, prefix, usePrefix, selectedIds, policyConfigs, policyMode }) {
  const selectedPolicies = POLICIES.filter((p) => selectedIds.includes(p.id))
  const byCategory = selectedPolicies.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  const authLabel = { itglue: 'IT Glue → WAM', interactive: 'WAM / Browser' }[authMode]

  const customised = Object.keys(policyConfigs || {}).filter(id => selectedIds.includes(id)).length

  const isReportOnly = policyMode === 'enabledForReportingButNotEnforced'
  const caCount = selectedPolicies.filter(p => p.category === 'Conditional Access').length
  const nonCaCount = selectedPolicies.length - caCount

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Organisation</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{org?.name || '—'}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Auth method</p>
          <p className="text-sm font-semibold text-gray-900">{authLabel}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Account</p>
          <p className="text-sm font-semibold text-gray-900 truncate">
            {authMode === 'interactive' ? 'Browser / device code' : (credentials?.username || '—')}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Prefix</p>
          <p className="text-sm font-semibold text-gray-900">{usePrefix && prefix ? prefix : 'None'}</p>
        </div>
      </div>

      {authMode === 'interactive' && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          A browser sign-in window will appear when deployment starts. Sign in with your admin account to proceed.
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 space-y-1">
        <p>
          <strong>{selectedIds.length} policies</strong> selected across {Object.keys(byCategory).length} categories.
          {customised > 0 && <span className="ml-2 text-navy font-medium">{customised} with custom configuration.</span>}
        </p>
        {isReportOnly ? (
          <ul className="mt-1 space-y-0.5 text-amber-700 list-disc list-inside">
            {caCount > 0 && <li>{caCount} Conditional Access {caCount === 1 ? 'policy' : 'policies'} will be created in <strong>Report-Only</strong> mode — users will not be blocked.</li>}
            {nonCaCount > 0 && <li>{nonCaCount} other {nonCaCount === 1 ? 'policy' : 'policies'} will be <strong>skipped</strong> — no report-only equivalent exists for these types.</li>}
          </ul>
        ) : (
          <p className="mt-0.5 text-amber-700">All {selectedIds.length} {selectedIds.length === 1 ? 'policy' : 'policies'} will be created and enforced immediately.</p>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
        {Object.entries(byCategory).map(([cat, policies]) => (
          <div key={cat}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{cat}</p>
            <div className="space-y-1">
              {policies.map((p) => {
                const cfg = policyConfigs?.[p.id] || {}
                const isCA = p.category === 'Conditional Access'
                let badgeLabel, badgeVariant
                if (isCA) {
                  const stateVal = cfg.state || policyMode
                  badgeLabel = { enabled: 'Active', disabled: 'Off', enabledForReportingButNotEnforced: 'Report-Only' }[stateVal] || stateVal
                  badgeVariant = { enabled: 'success', disabled: 'neutral', enabledForReportingButNotEnforced: 'warning' }[stateVal] || 'neutral'
                } else if (isReportOnly) {
                  badgeLabel = 'Skipped'
                  badgeVariant = 'neutral'
                } else {
                  badgeLabel = 'Active'
                  badgeVariant = 'success'
                }
                return (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 px-3 rounded-md hover:bg-gray-50">
                    <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{p.id}</span>
                    <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                    <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                    {severityBadge(p.severity)}
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

// ── Step 6: Deploy ────────────────────────────────────────────────────────────
function StepDeploy({ logs, results, selectedIds, running }) {
  const selectedPolicies = POLICIES.filter((p) => selectedIds.includes(p.id))
  return (
    <div className="space-y-4">
      {Object.keys(results).length > 0 && (
        <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Policy Results</p>
          {selectedPolicies.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-1.5 px-3 rounded-md bg-gray-50">
              <span className="text-xs font-mono text-gray-400 w-12">{p.id}</span>
              <span className="text-sm text-gray-800 flex-1">{p.name}</span>
              {resultBadge(results[p.id])}
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
  )
}

// When a global tenant session is active, we skip step 1 (auth) entirely.
// Steps with session: Configure Prefix, Select Policies, Configure Policies, Review, Deploy
const STEPS_SESSION = ['Configure Prefix', 'Select Policies', 'Configure Policies', 'Review', 'Deploy']

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function CreatePolicies() {
  const { settings, addNotification, tenantSession, openConnectModal, openSwitchModal } = useStore()

  const baselinePolicyIds = (() => {
    try {
      const raw = sessionStorage.getItem('baseline-policyIds')
      if (raw) { sessionStorage.removeItem('baseline-policyIds'); return JSON.parse(raw) }
    } catch {}
    return null
  })()
  const baselineName = (() => {
    const n = sessionStorage.getItem('baseline-name')
    if (n) sessionStorage.removeItem('baseline-name')
    return n
  })()

  // When a session exists, skip the auth step
  const usingSession = !!tenantSession
  const steps = usingSession ? STEPS_SESSION : STEPS

  const [authMode, setAuthMode] = useState('itglue')
  const [step, setStep] = useState(1)
  const [org, setOrg] = useState(null)
  const [credentials, setCredentials] = useState(null)
  const [usePrefix, setUsePrefix] = useState(!!settings.defaultPolicyPrefix)
  const [prefix, setPrefix] = useState(settings.defaultPolicyPrefix || '')
  const [policyMode, setPolicyMode] = useState('enabled')
  const [selectedIds, setSelectedIds] = useState(baselinePolicyIds ?? [])
  const [policyConfigs, setPolicyConfigs] = useState({})
  const [deployLogs, setDeployLogs] = useState([])
  const [deployResults, setDeployResults] = useState({})
  const [running, setRunning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [useDeviceCode, setUseDeviceCode] = useState(false)
  const [deviceCodeInfo, setDeviceCodeInfo] = useState(null)

  // Pre-fill org from the active tenant session
  useEffect(() => {
    if (tenantSession?.Account && !org) {
      const domain = tenantSession.Account.split('@')[1]?.split('.')[0] || tenantSession.Account
      setOrg({ id: 'session', name: domain, shortName: '' })
      if (!settings.defaultPolicyPrefix) setPrefix(domain)
    }
  }, [tenantSession])

  useEffect(() => {
    if (org?.name && !settings.defaultPolicyPrefix && !usingSession) setPrefix(org.name)
  }, [org?.name])

  useEffect(() => {
    if (!window.api) return
    const unOut = window.api.onPsOutput((line) => {
      setDeployLogs((l) => [...l, { line, type: 'output' }])
      const dc = parseDeviceCode(line)
      if (dc) setDeviceCodeInfo(dc)
      if (/connected\.|CONNECTED:|welcome to microsoft graph/i.test(line)) setDeviceCodeInfo(null)
    })
    const unErr = window.api.onPsError((line) => setDeployLogs((l) => [...l, { line, type: 'error' }]))
    return () => { unOut?.(); unErr?.() }
  }, [])

  const canNext = () => {
    if (!usingSession && step === 1) {
      if (!org?.name) return false
      if (authMode === 'interactive') return true
      if (authMode === 'itglue') return !!(credentials?.username && credentials?.password)
      return false
    }
    // With session, step 1 = Configure Prefix (always ok), step 2 = Select Policies
    const selectStep = usingSession ? 2 : 3
    if (step === selectStep) return selectedIds.length > 0
    return true
  }

  const handleAuthModeChange = (mode) => {
    setAuthMode(mode)
    setOrg(null)
    setCredentials(null)
    setUseDeviceCode(false)
  }

  const handleDeploy = async () => {
    if (!window.api) return
    setConfirmOpen(false)
    setRunning(true)
    setDeployLogs([])
    setDeployResults({})
    const selectedPolicies = POLICIES.filter((p) => selectedIds.includes(p.id))

    // Apply policyMode globally:
    // CA policies → set state (enabled / enabledForReportingButNotEnforced)
    // Non-CA policies in report-only mode → mark as skipped (no report-only equivalent)
    const effectiveConfigs = { ...policyConfigs }
    selectedPolicies.forEach((p) => {
      if (p.category === 'Conditional Access') {
        if (!effectiveConfigs[p.id]?.state) {
          effectiveConfigs[p.id] = { ...(effectiveConfigs[p.id] || {}), state: policyMode }
        }
      } else if (policyMode === 'enabledForReportingButNotEnforced') {
        effectiveConfigs[p.id] = { ...(effectiveConfigs[p.id] || {}), skip: true }
      }
    })

    try {
      const result = await window.api.policies.create({
        policies: selectedPolicies,
        credentials: usingSession ? { interactive: true } : credentials,
        prefix: usePrefix ? prefix : '',
        authMode: usingSession ? 'interactive' : authMode,
        policyConfigs: effectiveConfigs,
        useDeviceCode: usingSession ? true : useDeviceCode,
      })
      setDeployResults(result.results || {})
      const r = result.results || {}
      const successCount = Object.values(r).filter((v) => v === 'success').length
      const failureCount = Object.values(r).filter((v) => v === 'failure').length
      const skippedCount = Object.values(r).filter((v) => v === 'skipped').length
      const parts = [`${successCount} created`]
      if (failureCount > 0) parts.push(`${failureCount} failed`)
      if (skippedCount > 0) parts.push(`${skippedCount} skipped`)
      const notifVariant = failureCount > 0 ? 'error' : (successCount > 0 ? 'success' : 'warning')
      addNotification(`Deployment complete: ${parts.join(', ')}`, notifVariant)
    } catch (err) {
      addNotification('Deployment failed: ' + err.message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const reset = () => {
    setStep(1)
    if (!usingSession) { setOrg(null); setCredentials(null) }
    setPolicyMode('enabled')
    setPolicyConfigs({})
    setDeployLogs([]); setDeployResults({})
  }

  // Map current step to the correct content (accounting for skipped auth step)
  const stepOffset = usingSession ? 1 : 0
  const contentStep = step + stepOffset  // 1-indexed into original STEPS

  const deployStep = steps.length
  const reviewStep = steps.length - 1

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Security Policies</h1>
        <p className="mt-1 text-sm text-gray-500">Deploy M365 security policies to a tenant in {steps.length} steps</p>
      </div>

      {/* Connected tenant banner */}
      {usingSession && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50">
          <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800">Connected to {tenantSession.Account}</p>
            <p className="text-xs text-emerald-600 mt-0.5">Policies will be deployed to this tenant using your active session.</p>
          </div>
          <button onClick={openSwitchModal} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium flex-shrink-0 underline underline-offset-2">
            Switch tenant
          </button>
        </div>
      )}

      {/* Auth mode selector — only when no global session */}
      {!usingSession && <AuthModeBanner mode={authMode} onChange={handleAuthModeChange} locked={step > 1} />}

      {/* Baseline pre-selection notice */}
      {baselineName && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-50 border border-purple-200 text-sm text-purple-800">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <span>Policies pre-selected from <strong>{baselineName}</strong> baseline — you can adjust in step {usingSession ? 2 : 3}.</span>
        </div>
      )}

      <div className="mb-6">
        <ProgressStep steps={steps} currentStep={step} />
      </div>

      <Card>
        <Card.Header>
          <h2 className="text-base font-semibold text-gray-900">Step {step}: {steps[step - 1]}</h2>
        </Card.Header>
        <Card.Body>
          {!usingSession && step === 1 && (
            <StepOrgAndCredentials
              authMode={authMode}
              org={org} setOrg={setOrg}
              credentials={credentials} setCredentials={setCredentials}
              useDeviceCode={useDeviceCode} setUseDeviceCode={setUseDeviceCode}
            />
          )}
          {contentStep === 2 && (
            <StepConfigurePrefix
              usePrefix={usePrefix} setUsePrefix={setUsePrefix}
              prefix={prefix} setPrefix={setPrefix}
              defaultPrefix={settings.defaultPolicyPrefix}
              orgName={org?.name}
              policyMode={policyMode} setPolicyMode={setPolicyMode}
            />
          )}
          {contentStep === 3 && <StepSelectPolicies selected={selectedIds} setSelected={setSelectedIds} />}
          {contentStep === 4 && (
            <ConfigurePolicies
              selectedIds={selectedIds}
              policyConfigs={policyConfigs}
              setPolicyConfigs={setPolicyConfigs}
            />
          )}
          {contentStep === 5 && (
            <StepReview
              authMode={usingSession ? 'interactive' : authMode}
              org={org}
              credentials={usingSession ? { username: tenantSession.Account } : credentials}
              prefix={prefix} usePrefix={usePrefix}
              selectedIds={selectedIds}
              policyConfigs={policyConfigs}
              policyMode={policyMode}
            />
          )}
          {contentStep === 6 && (
            <StepDeploy logs={deployLogs} results={deployResults} selectedIds={selectedIds} running={running} />
          )}
        </Card.Body>
        <Card.Footer>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || running}>
              Back
            </Button>
            <div className="flex gap-2">
              {step < deployStep && (
                <Button
                  variant="primary"
                  onClick={() => step === reviewStep ? setConfirmOpen(true) : setStep((s) => s + 1)}
                  disabled={!canNext() || running}
                >
                  {step === reviewStep ? 'Deploy Policies' : 'Next'}
                </Button>
              )}
              {step === deployStep && !running && Object.keys(deployResults).length > 0 && (
                <Button variant="secondary" onClick={reset}>Start New</Button>
              )}
            </div>
          </div>
        </Card.Footer>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        variant="warning"
        title="Confirm Policy Deployment"
        confirmLabel="Deploy Now"
        cancelLabel="Cancel"
        onConfirm={() => { setStep(deployStep); handleDeploy() }}
      >
        <div className="py-2 space-y-2">
          <p>You are about to create <strong>{selectedIds.length} policies</strong> in the <strong>{org?.name}</strong> tenant.</p>
          {(usingSession || authMode === 'interactive') && (
            <p className="text-blue-700">A device code prompt will appear in the log — sign in with your admin account to begin deployment.</p>
          )}
          <p className="text-amber-700">This will modify your Microsoft 365 Conditional Access and security configuration.</p>
        </div>
      </Modal>

      <DeviceCodeModal info={deviceCodeInfo} onDismiss={() => setDeviceCodeInfo(null)} />
    </div>
  )
}
