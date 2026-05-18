import React, { useState, useEffect, useCallback } from 'react'
import useStore from '../store'
import Button from '../components/Button'

// ── Data helpers ──────────────────────────────────────────────────────────────

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k]
  }
  return null
}

function formatUserList(users) {
  if (!users) return []
  const rows = []
  const inc = pick(users, 'IncludeUsers', 'includeUsers') || []
  const excU = pick(users, 'ExcludeUsers', 'excludeUsers') || []
  const incG = pick(users, 'IncludeGroups', 'includeGroups') || []
  const excG = pick(users, 'ExcludeGroups', 'excludeGroups') || []
  const incR = pick(users, 'IncludeRoles', 'includeRoles') || []
  const excR = pick(users, 'ExcludeRoles', 'excludeRoles') || []

  if (inc.includes('All')) rows.push({ label: 'Applies to', value: 'All Users' })
  else if (inc.includes('GuestsOrExternalUsers')) rows.push({ label: 'Applies to', value: 'Guests & External Users' })
  else if (inc.length) rows.push({ label: 'Applies to', value: `${inc.length} specific user(s)` })

  if (incG.length) rows.push({ label: 'Groups', value: `${incG.length} group(s)` })
  if (incR.length) rows.push({ label: 'Roles', value: `${incR.length} role(s)` })
  if (excU.length) rows.push({ label: 'Excluding', value: `${excU.length} user(s)` })
  if (excG.length) rows.push({ label: 'Excl. groups', value: `${excG.length} group(s)` })
  if (excR.length) rows.push({ label: 'Excl. roles', value: `${excR.length} role(s)` })
  return rows
}

const APP_NAMES = {
  'All': 'All Cloud Apps',
  'Office365': 'Microsoft 365',
  'MicrosoftAdminPortals': 'Admin Portals',
}
const USER_ACTIONS = {
  'urn:user:registersecurityinfo': 'Register Security Info',
  'urn:user:registerdevice': 'Register / Join Device',
}

function formatAppList(apps) {
  if (!apps) return []
  const rows = []
  const inc = pick(apps, 'IncludeApplications', 'includeApplications') || []
  const exc = pick(apps, 'ExcludeApplications', 'excludeApplications') || []
  const actions = pick(apps, 'IncludeUserActions', 'includeUserActions') || []

  if (inc.includes('All')) rows.push({ label: 'Applies to', value: 'All Cloud Apps' })
  else if (inc.length === 1 && APP_NAMES[inc[0]]) rows.push({ label: 'Applies to', value: APP_NAMES[inc[0]] })
  else if (inc.length) rows.push({ label: 'Applies to', value: inc.map(id => APP_NAMES[id] || id).join(', ') })

  if (exc.length) rows.push({ label: 'Excluding', value: exc.map(id => APP_NAMES[id] || id.slice(0, 8) + '…').join(', ') })
  if (actions.length) rows.push({ label: 'User actions', value: actions.map(a => USER_ACTIONS[a] || a).join(', ') })
  return rows
}

const PLATFORM_NAMES = {
  android: 'Android', iOS: 'iOS', windows: 'Windows', macOS: 'macOS',
  linux: 'Linux', all: 'All', windowsPhone: 'Windows Phone',
}
const CLIENT_APP_NAMES = {
  browser: 'Browser', mobileAppsAndDesktopClients: 'Mobile & Desktop',
  exchangeActiveSync: 'Exchange ActiveSync', other: 'Other',
}
const RISK_NAMES = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' }
const CONTROL_NAMES = {
  mfa: 'Require MFA', compliantDevice: 'Require Compliant Device',
  domainJoinedDevice: 'Require Domain-Joined Device', approvedApplication: 'Require Approved App',
  passwordChange: 'Require Password Change', block: 'Block Access',
  compliantApplication: 'Require Compliant App',
}

function formatPlatforms(p) {
  if (!p) return null
  const inc = (pick(p, 'IncludePlatforms', 'includePlatforms') || []).map(x => PLATFORM_NAMES[x] || x)
  const exc = (pick(p, 'ExcludePlatforms', 'excludePlatforms') || []).map(x => PLATFORM_NAMES[x] || x)
  const parts = []
  if (inc.length) parts.push(inc.join(', '))
  if (exc.length) parts.push(`excl. ${exc.join(', ')}`)
  return parts.join(' · ') || null
}

function formatLocations(loc) {
  if (!loc) return null
  const inc = pick(loc, 'IncludeLocations', 'includeLocations') || []
  const exc = pick(loc, 'ExcludeLocations', 'excludeLocations') || []
  const fmt = arr => arr.map(x => x === 'All' ? 'All' : x === 'AllTrusted' ? 'All Trusted' : x.slice(0, 8) + '…')
  const parts = []
  if (inc.length) parts.push(fmt(inc).join(', '))
  if (exc.length) parts.push(`excl. ${fmt(exc).join(', ')}`)
  return parts.join(' · ') || null
}

function formatGrantControls(gc) {
  if (!gc) return { controls: [], operator: 'OR' }
  const controls = (pick(gc, 'BuiltInControls', 'builtInControls') || []).map(c => CONTROL_NAMES[c] || c)
  const tou = pick(gc, 'TermsOfUse', 'termsOfUse') || []
  if (tou.length) controls.push('Terms of Use')
  return { controls, operator: pick(gc, 'Operator', 'operator') || 'OR' }
}

function formatSessionControls(sc) {
  if (!sc) return []
  const parts = []
  const sif = pick(sc, 'SignInFrequency', 'signInFrequency')
  if (sif?.IsEnabled || sif?.isEnabled) {
    const val = sif.Value ?? sif.value
    const type = sif.Type ?? sif.type
    if (val !== null && val !== undefined) parts.push(`Sign-in frequency: ${val} ${type ?? ''}`.trim())
    else parts.push('Sign-in frequency: Every time')
  }
  const pb = pick(sc, 'PersistentBrowser', 'persistentBrowser')
  if (pb?.IsEnabled || pb?.isEnabled) {
    const mode = pb.Mode ?? pb.mode ?? ''
    parts.push(`Persistent browser: ${mode}`)
  }
  const cas = pick(sc, 'CloudAppSecurity', 'cloudAppSecurity')
  if (cas?.IsEnabled || cas?.isEnabled) {
    const type = cas.CloudAppSecurityType ?? cas.cloudAppSecurityType ?? 'Enabled'
    parts.push(`Cloud App Security: ${type}`)
  }
  const aer = pick(sc, 'ApplicationEnforcedRestrictions', 'applicationEnforcedRestrictions')
  if (aer?.IsEnabled || aer?.isEnabled) parts.push('App enforced restrictions')
  return parts
}

// ── Components ────────────────────────────────────────────────────────────────

function StateBadge({ state }) {
  const cfg = {
    enabled: { label: 'On', cls: 'bg-green-100 text-green-700' },
    disabled: { label: 'Off', cls: 'bg-gray-100 text-gray-500' },
    enabledForReportingButNotEnforced: { label: 'Report-only', cls: 'bg-amber-100 text-amber-700' },
  }[state] || { label: state || 'Unknown', cls: 'bg-gray-100 text-gray-500' }
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>{cfg.label}</span>
}

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-400 w-24 flex-shrink-0 leading-relaxed">{label}</span>
      <span className="text-gray-700 leading-relaxed">{value}</span>
    </div>
  )
}

function Section({ title, children, hasContent }) {
  if (!hasContent) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function PolicyCard({ policy }) {
  const state = pick(policy, 'State', 'state') || 'unknown'
  const name = pick(policy, 'DisplayName', 'displayName') || 'Unnamed Policy'
  const createdRaw = pick(policy, 'CreatedDateTime', 'createdDateTime')
  const modifiedRaw = pick(policy, 'ModifiedDateTime', 'modifiedDateTime')
  const created = createdRaw ? new Date(createdRaw).toLocaleDateString('en-GB') : null
  const modified = modifiedRaw ? new Date(modifiedRaw).toLocaleDateString('en-GB') : null

  const cond = pick(policy, 'Conditions', 'conditions') || {}
  const users = pick(cond, 'Users', 'users') || {}
  const apps = pick(cond, 'Applications', 'applications') || {}
  const platforms = pick(cond, 'Platforms', 'platforms')
  const locations = pick(cond, 'Locations', 'locations')
  const clientApps = pick(cond, 'ClientAppTypes', 'clientAppTypes') || []
  const signInRisk = pick(cond, 'SignInRiskLevels', 'signInRiskLevels') || []
  const userRisk = pick(cond, 'UserRiskLevels', 'userRiskLevels') || []

  const gc = pick(policy, 'GrantControls', 'grantControls')
  const sc = pick(policy, 'SessionControls', 'sessionControls')

  const userRows = formatUserList(users)
  const appRows = formatAppList(apps)
  const platformStr = formatPlatforms(platforms)
  const locationStr = formatLocations(locations)
  const clientAppStr = clientApps.length ? clientApps.map(c => CLIENT_APP_NAMES[c] || c).join(', ') : null
  const signInRiskStr = signInRisk.length ? signInRisk.map(r => RISK_NAMES[r] || r).join(', ') : null
  const userRiskStr = userRisk.length ? userRisk.map(r => RISK_NAMES[r] || r).join(', ') : null
  const { controls, operator } = formatGrantControls(gc)
  const sessionCtrls = formatSessionControls(sc)

  const hasConditions = platformStr || locationStr || clientAppStr || signInRiskStr || userRiskStr

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white mb-4 break-inside-avoid">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100" style={{ background: '#f8f9fb' }}>
        <h3 className="text-sm font-semibold text-gray-900 leading-tight">{name}</h3>
        <StateBadge state={state} />
      </div>

      {/* Body */}
      <div className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-4">
        <Section title="Users" hasContent={userRows.length > 0}>
          {userRows.map(({ label, value }) => <InfoRow key={label} label={label} value={value} />)}
        </Section>

        <Section title="Applications" hasContent={appRows.length > 0}>
          {appRows.map(({ label, value }) => <InfoRow key={label} label={label} value={value} />)}
        </Section>

        <Section title="Conditions" hasContent={!!hasConditions}>
          <InfoRow label="Platforms" value={platformStr} />
          <InfoRow label="Locations" value={locationStr} />
          <InfoRow label="Client apps" value={clientAppStr} />
          <InfoRow label="Sign-in risk" value={signInRiskStr} />
          <InfoRow label="User risk" value={userRiskStr} />
        </Section>

        <Section title="Controls" hasContent={controls.length > 0 || sessionCtrls.length > 0}>
          {controls.length > 0 && (
            <InfoRow label="Grant" value={controls.join(operator === 'AND' ? ' AND ' : ' OR ')} />
          )}
          {sessionCtrls.map((s, i) => <InfoRow key={i} label="Session" value={s} />)}
        </Section>
      </div>

      {/* Footer — dates */}
      {(created || modified) && (
        <div className="flex items-center gap-6 px-5 py-2 border-t border-gray-100 bg-gray-50/50">
          {created && <span className="text-xs text-gray-400">Created {created}</span>}
          {modified && <span className="text-xs text-gray-400">Modified {modified}</span>}
        </div>
      )}
    </div>
  )
}

// ── Affinity branded report header ────────────────────────────────────────────

function AffinityReportHeader({ orgName, date }) {
  return (
    <div className="rounded-xl overflow-hidden mb-6" style={{ background: '#1a2d4a' }}>
      <div className="relative px-8 py-6 overflow-hidden">
        {/* Corner decorations — top-left gold */}
        <svg className="absolute -top-3 -left-3 opacity-70" width="90" height="90" viewBox="0 0 90 90" fill="none">
          <path d="M8 55 L8 8 L55 8" stroke="#E8A830" strokeWidth="5" strokeLinecap="round"/>
          <path d="M16 55 L16 16 L55 16" stroke="#E8A830" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.45"/>
          <path d="M26 36 L42 36 M36 28 L43 36 L36 44" stroke="#E8A830" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {/* Bottom-right gold */}
        <svg className="absolute -bottom-3 -right-3 opacity-70" width="90" height="90" viewBox="0 0 90 90" fill="none">
          <path d="M82 35 L82 82 L35 82" stroke="#E8A830" strokeWidth="5" strokeLinecap="round"/>
          <path d="M74 35 L74 74 L35 74" stroke="#E8A830" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.45"/>
          <path d="M54 62 L38 46 M38 46 L54 46" stroke="#E8A830" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {/* Top-right periwinkle */}
        <svg className="absolute -top-3 -right-3 opacity-40" width="70" height="70" viewBox="0 0 70 70" fill="none">
          <path d="M62 40 L62 8 L30 8" stroke="#8B9CC8" strokeWidth="4.5" strokeLinecap="round"/>
          <path d="M54 40 L54 16 L30 16" stroke="#8B9CC8" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.5"/>
        </svg>
        {/* Bottom-left periwinkle */}
        <svg className="absolute -bottom-3 -left-3 opacity-40" width="70" height="70" viewBox="0 0 70 70" fill="none">
          <path d="M8 30 L8 62 L40 62" stroke="#8B9CC8" strokeWidth="4.5" strokeLinecap="round"/>
          <path d="M16 30 L16 54 L40 54" stroke="#8B9CC8" strokeWidth="3" strokeLinecap="round" strokeOpacity="0.5"/>
        </svg>

        {/* Content */}
        <div className="relative z-10 flex items-end justify-between">
          <div>
            <p className="text-4xl font-thin text-white tracking-tight leading-none" style={{ fontWeight: 300 }}>affinity</p>
            <p className="text-sm mt-1.5 font-light" style={{ color: '#E8A830' }}>Technology. Together.</p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
              M365 Security Policy Report
            </p>
            <p className="text-lg font-semibold text-white">{orgName || 'Tenant'}</p>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{date}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Report view ───────────────────────────────────────────────────────────────

function ReportView({ orgName, tenantPolicies, date }) {
  const enabled = tenantPolicies.filter(p => (pick(p, 'State', 'state')) === 'enabled').length
  const reportOnly = tenantPolicies.filter(p => (pick(p, 'State', 'state')) === 'enabledForReportingButNotEnforced').length
  const disabled = tenantPolicies.filter(p => (pick(p, 'State', 'state')) === 'disabled').length

  function handleExportPDF() {
    const style = document.createElement('style')
    style.textContent = `@media print { body * { visibility: hidden !important; } #report-printable, #report-printable * { visibility: visible !important; } #report-printable { position: fixed; top: 0; left: 0; width: 100%; } }`
    document.head.appendChild(style)
    window.print()
    setTimeout(() => document.head.removeChild(style), 1000)
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Export button */}
      <div className="flex justify-end px-6 pt-4 pb-2">
        <Button variant="secondary" onClick={handleExportPDF}>
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Export PDF
        </Button>
      </div>

      <div id="report-printable" className="px-6 pb-8">
        <AffinityReportHeader orgName={orgName} date={date} />

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Policies', value: tenantPolicies.length, cls: 'text-gray-800' },
            { label: 'Enabled', value: enabled, cls: 'text-green-600' },
            { label: 'Report-only', value: reportOnly, cls: 'text-amber-500' },
            { label: 'Disabled', value: disabled, cls: 'text-gray-400' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-sm">
              <p className={`text-4xl font-bold leading-none ${cls}`}>{value}</p>
              <p className="text-xs font-semibold text-gray-500 mt-2 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>

        {/* Policy cards */}
        <div>
          {tenantPolicies.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
              <p className="text-sm text-gray-400">No Conditional Access policies found in this tenant.</p>
            </div>
          ) : (
            tenantPolicies.map(p => (
              <PolicyCard key={pick(p, 'Id', 'id')} policy={p} />
            ))
          )}
        </div>

        {/* Footer note */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3">
          <p className="text-xs text-gray-500">
            <span className="font-semibold text-gray-700">Note:</span>{' '}
            This report covers Conditional Access policies only. Group and user display names are not resolved — GUIDs are shown where applicable.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Auth panel sub-components ─────────────────────────────────────────────────

function AuthModeSelector({ mode, onChange }) {
  return (
    <div className="flex gap-2 mb-4">
      {[{ id: 'itglue', label: 'IT Glue' }, { id: 'interactive', label: 'Interactive' }].map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={[
            'flex-1 py-2 px-3 rounded-lg border-2 text-sm font-medium transition-all',
            mode === m.id ? 'border-navy bg-navy-50 text-navy' : 'border-gray-200 hover:border-gray-300 text-gray-600',
          ].join(' ')}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

function ItGluePanel({ org, setOrg, credentials, setCredentials }) {
  const { orgs, orgsLoading, loadOrgs, settings } = useStore()
  const [passwords, setPasswords] = useState([])
  const [allPasswords, setAllPasswords] = useState([])
  const [pwLoading, setPwLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { if (settings.itGlueApiKey) loadOrgs() }, [])

  useEffect(() => {
    if (!org || org.id === 'manual' || !window.api) return
    setPwLoading(true)
    window.api.itglue.getPasswords(org.id)
      .then((res) => {
        const all = res || []
        setAllPasswords(all)
        const exclusionWords = ['recovery', 'break glass', 'breakglass', 'emergency', 'backup']
        setPasswords(all.filter((pw) => {
          const n = pw.name.toLowerCase()
          return (n.includes('365') || n.includes('global admin') || n.includes('globaladmin'))
            && !exclusionWords.some(ex => n.includes(ex))
        }))
      })
      .catch(() => { setPasswords([]); setAllPasswords([]) })
      .finally(() => setPwLoading(false))
  }, [org?.id])

  if (!settings.itGlueApiKey) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-xs font-medium text-amber-800 mb-1">IT Glue API key not configured</p>
        <p className="text-xs text-amber-700">Go to Settings to add your IT Glue API key.</p>
      </div>
    )
  }

  const filteredOrgs = orgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    (o.shortName || '').toLowerCase().includes(search.toLowerCase())
  )
  const hiddenCount = allPasswords.length - passwords.length

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Organisation</p>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search orgs..."
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy mb-1.5"
        />
        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
          {orgsLoading ? Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />
          )) : filteredOrgs.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">No organisations found</p>
          ) : filteredOrgs.map(o => (
            <button
              key={o.id}
              onClick={() => { setOrg(o); setCredentials(null) }}
              className={['w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left text-xs transition-all',
                org?.id === o.id ? 'border-navy bg-navy-50 text-navy font-medium' : 'border-gray-200 hover:border-navy-200 hover:bg-gray-50',
              ].join(' ')}
            >
              <span>{o.name}</span>
              {o.shortName && <span className="text-gray-400">{o.shortName}</span>}
            </button>
          ))}
        </div>
      </div>

      {org && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Credential</p>
          {pwLoading ? Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse mb-1" />
          )) : passwords.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">No 365 / Global Admin credentials found</p>
          ) : (
            <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
              {passwords.map(pw => (
                <button
                  key={pw.id}
                  onClick={() => setCredentials({ username: pw.username, password: pw.password, tenantId: '' })}
                  className={['w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left text-xs transition-all',
                    credentials?.username === pw.username ? 'border-navy bg-navy-50 text-navy' : 'border-gray-200 hover:border-navy-200 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <div>
                    <p className="font-medium text-gray-800">{pw.name}</p>
                    <p className="text-gray-500">{pw.username}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {hiddenCount > 0 && (
            <p className="mt-1.5 text-xs text-gray-400 italic">{hiddenCount} password{hiddenCount !== 1 ? 's' : ''} hidden (recovery / break-glass)</p>
          )}
        </div>
      )}
    </div>
  )
}

function InteractivePanel({ org, setOrg, setCredentials }) {
  useEffect(() => {
    setCredentials({ interactive: true, username: '', password: '', tenantId: '' })
  }, [])
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Organisation name</label>
      <input
        type="text"
        value={org?.name || ''}
        onChange={e => setOrg({ id: 'manual', name: e.target.value, shortName: '' })}
        placeholder="e.g. AffinityIT"
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
      />
      <p className="mt-2 text-xs text-gray-500">A browser sign-in window will open when you generate the report.</p>
    </div>
  )
}

// ── Empty / loading states ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6" style={{ background: '#f0f3f8' }}>
        <svg className="w-10 h-10 text-navy/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-600 mb-2">No report generated</h3>
      <p className="text-sm text-gray-400 max-w-xs">Select an organisation and generate a report to see all Conditional Access policies configured in the tenant.</p>
    </div>
  )
}

function LoadingState({ lastLine }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-12 h-12 rounded-full border-4 border-navy/20 border-t-navy animate-spin mb-6" />
      <p className="text-sm font-medium text-gray-700">Fetching policies…</p>
      {lastLine && <p className="mt-2 text-xs text-gray-400 max-w-sm truncate">{lastLine}</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecurityReport() {
  const [authMode, setAuthMode] = useState('itglue')
  const [org, setOrg] = useState(null)
  const [credentials, setCredentials] = useState(null)
  const [status, setStatus] = useState('idle')
  const [logs, setLogs] = useState([])
  const [report, setReport] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const lastLine = logs[logs.length - 1] || ''

  const canGenerate = useCallback(() => {
    if (!org?.name) return false
    if (authMode === 'itglue' && !credentials) return false
    return true
  }, [org, authMode, credentials])

  function handleAuthModeChange(mode) {
    setAuthMode(mode)
    setCredentials(null)
    if (mode === 'interactive') setOrg(prev => prev?.id === 'manual' ? prev : null)
  }

  async function handleGenerate() {
    if (!canGenerate()) return
    setStatus('running')
    setLogs([])
    setReport(null)
    setErrorMsg('')

    const unsub = window.api?.onPsOutput?.((line) => setLogs(prev => [...prev, line]))

    try {
      const result = await window.api.report.audit({
        credentials: authMode === 'interactive' ? null : credentials,
        authMode,
      })

      if (result.error) {
        setErrorMsg(result.error)
        setStatus('error')
      } else {
        setReport({
          policies: result.policies,
          orgName: org?.name || '',
          date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        })
        setStatus('done')
      }
    } catch (err) {
      setErrorMsg(err.message || 'Unknown error')
      setStatus('error')
    } finally {
      unsub?.()
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left setup panel */}
      <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-y-auto">
        <div className="px-5 py-5 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">Security Report</h2>
          <p className="text-xs text-gray-500 mt-0.5">Export a full CA policy inventory for any tenant</p>
        </div>

        <div className="flex-1 px-5 py-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Authentication</p>
            <AuthModeSelector mode={authMode} onChange={handleAuthModeChange} />
            {authMode === 'itglue' ? (
              <ItGluePanel org={org} setOrg={setOrg} credentials={credentials} setCredentials={setCredentials} />
            ) : (
              <InteractivePanel org={org} setOrg={setOrg} setCredentials={setCredentials} />
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 space-y-3">
          {status === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs font-semibold text-red-700 mb-0.5">Error</p>
              <p className="text-xs text-red-600 break-words">{errorMsg}</p>
            </div>
          )}
          {status === 'running' && logs.length > 0 && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 max-h-28 overflow-y-auto">
              {logs.map((l, i) => (
                <p key={i} className="text-xs font-mono text-gray-500 leading-relaxed truncate">{l}</p>
              ))}
            </div>
          )}
          <Button
            variant="primary"
            className="w-full"
            disabled={!canGenerate() || status === 'running'}
            onClick={handleGenerate}
          >
            {status === 'running' ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Fetching…
              </span>
            ) : 'Generate Report'}
          </Button>
        </div>
      </aside>

      {/* Right report panel */}
      <main className="flex-1 overflow-hidden bg-gray-50">
        {status === 'idle' || (status === 'error' && !report) ? (
          <EmptyState />
        ) : status === 'running' ? (
          <LoadingState lastLine={lastLine} />
        ) : report ? (
          <ReportView orgName={report.orgName} tenantPolicies={report.policies} date={report.date} />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}
