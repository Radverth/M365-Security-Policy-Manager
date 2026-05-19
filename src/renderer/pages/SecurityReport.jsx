import React, { useState, useEffect, useRef, useCallback } from 'react'
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
  All: 'All Cloud Apps',
  Office365: 'Microsoft 365',
  MicrosoftAdminPortals: 'Admin Portals',
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

// ── Console component (live PS output) ───────────────────────────────────────

function lineColor(line) {
  if (/^error:/i.test(line)) return '#f87171'           // red
  if (/^success/i.test(line)) return '#4ade80'          // green
  if (/^connect/i.test(line) || /connecting/i.test(line)) return '#fbbf24' // amber
  if (/^done:/i.test(line)) return '#4ade80'            // green
  return '#9ca3af'                                       // gray
}

function LiveConsole({ lines, status, orgName }) {
  const bottomRef = useRef(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex flex-col h-full" style={{ background: '#0f1117' }}>
      {/* Console header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
        {status === 'running' && (
          <svg className="w-4 h-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: '#60a5fa' }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {status === 'done' && (
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#4ade80" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        <span className="text-xs font-mono" style={{ color: '#9ca3af' }}>
          {status === 'running' ? `Fetching policies${orgName ? ` — ${orgName}` : ''}...` : 'Session complete'}
        </span>
        <span className="ml-auto text-xs font-mono" style={{ color: '#4b5563' }}>{lines.length} lines</span>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-5 py-4 font-mono text-xs leading-relaxed space-y-0.5">
        {lines.length === 0 && status === 'running' && (
          <span style={{ color: '#4b5563' }}>Waiting for output...</span>
        )}
        {lines.map((line, i) => (
          <div key={i} style={{ color: lineColor(line) }}>{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Policy card ───────────────────────────────────────────────────────────────

const STATE_CFG = {
  enabled: { label: 'Enabled', dot: '#22c55e', badge: '#dcfce7', badgeText: '#15803d' },
  disabled: { label: 'Disabled', dot: '#9ca3af', badge: '#f3f4f6', badgeText: '#6b7280' },
  enabledForReportingButNotEnforced: { label: 'Report-only', dot: '#f59e0b', badge: '#fef3c7', badgeText: '#d97706' },
}
const STATE_BORDER = {
  enabled: '#22c55e',
  disabled: '#e5e7eb',
  enabledForReportingButNotEnforced: '#f59e0b',
}

function StateBadge({ state }) {
  const cfg = STATE_CFG[state] || { label: state || 'Unknown', dot: '#9ca3af', badge: '#f3f4f6', badgeText: '#6b7280' }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ background: cfg.badge, color: cfg.badgeText }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  )
}

function DetailChip({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-700 truncate">{value}</span>
    </div>
  )
}

function PolicyCard({ policy }) {
  const [expanded, setExpanded] = useState(false)
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

  // Summary line for collapsed view
  const userSummary = userRows.find(r => r.label === 'Applies to')?.value || null
  const appSummary = appRows.find(r => r.label === 'Applies to')?.value || null
  const controlSummary = controls.length ? controls.join(operator === 'AND' ? ' + ' : ' / ') : null

  const borderColor = STATE_BORDER[state] || '#e5e7eb'

  return (
    <div className="rounded-xl bg-white border border-gray-200 mb-3 overflow-hidden break-inside-avoid"
      style={{ borderLeft: `4px solid ${borderColor}` }}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
          {/* Quick-glance chips */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
            {userSummary && <DetailChip label="Users:" value={userSummary} />}
            {appSummary && <DetailChip label="Apps:" value={appSummary} />}
            {controlSummary && <DetailChip label="Grant:" value={controlSummary} />}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StateBadge state={state} />
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            {userRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Users</p>
                <div className="space-y-1">
                  {userRows.map(({ label, value }) => (
                    <div key={label} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400 w-24 flex-shrink-0">{label}</span>
                      <span className="text-gray-700">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {appRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Applications</p>
                <div className="space-y-1">
                  {appRows.map(({ label, value }) => (
                    <div key={label} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400 w-24 flex-shrink-0">{label}</span>
                      <span className="text-gray-700">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(platformStr || locationStr || clientAppStr || signInRiskStr || userRiskStr) && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Conditions</p>
                <div className="space-y-1">
                  {platformStr && <div className="flex gap-2 text-xs"><span className="text-gray-400 w-24 flex-shrink-0">Platforms</span><span className="text-gray-700">{platformStr}</span></div>}
                  {locationStr && <div className="flex gap-2 text-xs"><span className="text-gray-400 w-24 flex-shrink-0">Locations</span><span className="text-gray-700">{locationStr}</span></div>}
                  {clientAppStr && <div className="flex gap-2 text-xs"><span className="text-gray-400 w-24 flex-shrink-0">Client apps</span><span className="text-gray-700">{clientAppStr}</span></div>}
                  {signInRiskStr && <div className="flex gap-2 text-xs"><span className="text-gray-400 w-24 flex-shrink-0">Sign-in risk</span><span className="text-gray-700">{signInRiskStr}</span></div>}
                  {userRiskStr && <div className="flex gap-2 text-xs"><span className="text-gray-400 w-24 flex-shrink-0">User risk</span><span className="text-gray-700">{userRiskStr}</span></div>}
                </div>
              </div>
            )}
            {(controls.length > 0 || sessionCtrls.length > 0) && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Controls</p>
                <div className="space-y-1">
                  {controls.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-gray-400 w-24 flex-shrink-0">Grant</span>
                      <span className="text-gray-700">{controls.join(operator === 'AND' ? ' AND ' : ' OR ')}</span>
                    </div>
                  )}
                  {sessionCtrls.map((s, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-gray-400 w-24 flex-shrink-0">Session</span>
                      <span className="text-gray-700">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {(created || modified) && (
            <div className="flex gap-5 mt-3 pt-3 border-t border-gray-100">
              {created && <span className="text-xs text-gray-400">Created {created}</span>}
              {modified && <span className="text-xs text-gray-400">Modified {modified}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Branded report header (PDF) ───────────────────────────────────────────────

function AffinityReportHeader({ orgName, date }) {
  return (
    <div style={{
      background: '#1a2d4a',
      borderRadius: '12px',
      overflow: 'hidden',
      marginBottom: '24px',
      WebkitPrintColorAdjust: 'exact',
      printColorAdjust: 'exact',
    }}>
      {/* Gold accent bar */}
      <div style={{ height: '5px', background: 'linear-gradient(90deg, #b87820 0%, #E8A830 35%, #f5d080 65%, #E8A830 100%)' }} />
      <div style={{ padding: '28px 40px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '24px' }}>
          {/* Brand */}
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: '40px', fontWeight: 200, color: '#ffffff', letterSpacing: '-1.5px', lineHeight: 1, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
              affinity
            </div>
            <div style={{ fontSize: '12px', color: '#E8A830', marginTop: '8px', letterSpacing: '0.5px', fontWeight: 400 }}>
              Technology. Together.
            </div>
          </div>
          {/* Divider */}
          <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.12)', marginBottom: '6px' }} />
          {/* Report meta */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: '10px' }}>
              M365 Security Policy Report
            </div>
            <div style={{ fontSize: '22px', fontWeight: 600, color: '#ffffff', lineHeight: 1.2, marginBottom: '5px' }}>
              {orgName || 'Tenant'}
            </div>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)' }}>
              {date}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Report view ───────────────────────────────────────────────────────────────

function ReportView({ orgName, tenantPolicies, date, logs }) {
  const [showConsole, setShowConsole] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState(null)
  const enabled = tenantPolicies.filter(p => pick(p, 'State', 'state') === 'enabled').length
  const reportOnly = tenantPolicies.filter(p => pick(p, 'State', 'state') === 'enabledForReportingButNotEnforced').length
  const disabled = tenantPolicies.filter(p => pick(p, 'State', 'state') === 'disabled').length

  async function handleExportPDF() {
    setSaving(true)
    setSavedPath(null)
    const style = document.createElement('style')
    style.textContent = [
      '@media print {',
      '  @page { margin: 12mm; size: A4 portrait; }',
      '  body * { visibility: hidden !important; }',
      '  #report-printable, #report-printable * { visibility: visible !important; }',
      '  #report-printable { position: fixed; top: 0; left: 0; width: 100%; }',
      '  .no-print { display: none !important; }',
      '}',
    ].join('\n')
    document.head.appendChild(style)
    try {
      const result = await window.api.report.savePDF(orgName)
      if (result?.path) {
        setSavedPath(result.path)
        setTimeout(() => setSavedPath(null), 5000)
      }
    } catch {}
    finally {
      document.head.removeChild(style)
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-semibold text-gray-800">{orgName}</span>
          <span className="text-sm text-gray-400">&mdash; {tenantPolicies.length} policies</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {savedPath && (
            <span className="text-xs text-emerald-600 font-medium">Saved to Documents</span>
          )}
          {logs?.length > 0 && (
            <button
              onClick={() => setShowConsole(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${showConsole ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {showConsole ? 'Hide log' : 'Show log'}
            </button>
          )}
          <Button variant="secondary" onClick={handleExportPDF} loading={saving}>
            {savedPath ? (
              <>
                <svg className="w-4 h-4 mr-1.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Save PDF
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Console panel (collapsible) */}
      {showConsole && logs?.length > 0 && (
        <div className="flex-shrink-0 h-40 border-b border-gray-200">
          <LiveConsole lines={logs} status="done" orgName={orgName} />
        </div>
      )}

      {/* Report content */}
      <div id="report-printable" className="flex-1 overflow-y-auto px-6 py-5"
        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
        <AffinityReportHeader orgName={orgName} date={date} />

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total', value: tenantPolicies.length, color: '#1a2d4a' },
            { label: 'Enabled', value: enabled, color: '#16a34a' },
            { label: 'Report-only', value: reportOnly, color: '#d97706' },
            { label: 'Disabled', value: disabled, color: '#9ca3af' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold leading-none" style={{ color }}>{value}</p>
              <p className="text-xs font-semibold text-gray-400 mt-1.5 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>

        {/* Expand-all toggle */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Policies</p>
          <p className="text-xs text-gray-400">Click a policy to expand details</p>
        </div>

        {tenantPolicies.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-400">No Conditional Access policies found in this tenant.</p>
          </div>
        ) : (
          tenantPolicies.map(p => <PolicyCard key={pick(p, 'Id', 'id')} policy={p} />)
        )}

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-5 py-3">
          <p className="text-xs text-gray-500">
            <span className="font-semibold text-gray-700">Note:</span>{' '}
            This report covers Conditional Access policies only. GUIDs are shown where display names are unavailable.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Auth panel ────────────────────────────────────────────────────────────────

function ItGluePanel({ org, setOrg, credentials, setCredentials }) {
  const { orgs, orgsLoading, loadOrgs, settings } = useStore()
  const [passwords, setPasswords] = useState([])
  const [allPasswords, setAllPasswords] = useState([])
  const [pwLoading, setPwLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedPwId, setSelectedPwId] = useState(null)

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
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-800 mb-0.5">IT Glue not configured</p>
        <p className="text-xs text-amber-700">Add your IT Glue API key in Settings.</p>
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
      {/* Org search */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Organisation</label>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search organisations..."
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
        />
        <div className="mt-1.5 max-h-36 overflow-y-auto space-y-1">
          {orgsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
            ))
          ) : filteredOrgs.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">No organisations found</p>
          ) : filteredOrgs.map(o => (
            <button
              key={o.id}
              onClick={() => { setOrg(o); setCredentials(null); setSelectedPwId(null) }}
              className={[
                'w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left text-xs transition-all',
                org?.id === o.id
                  ? 'border-navy bg-navy text-white font-medium'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700',
              ].join(' ')}
            >
              <span>{o.name}</span>
              {o.shortName && <span className="opacity-60 text-xs">{o.shortName}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Credential picker */}
      {org && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Credential</label>
          {pwLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse mb-1" />
            ))
          ) : passwords.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">No 365 / Global Admin credentials found</p>
          ) : (
            <div className="max-h-36 overflow-y-auto space-y-1">
              {passwords.map(pw => (
                <button
                  key={pw.id}
                  onClick={() => { setSelectedPwId(pw.id); setCredentials({ username: pw.username, password: pw.password, tenantId: '' }) }}
                  className={[
                    'w-full px-3 py-2 rounded-lg border text-left text-xs transition-all',
                    selectedPwId === pw.id
                      ? 'border-navy bg-navy text-white font-medium'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <p className={`font-medium ${selectedPwId === pw.id ? 'text-white' : 'text-gray-800'}`}>{pw.name}</p>
                  <p className={`mt-0.5 ${selectedPwId === pw.id ? 'text-white/70' : 'text-gray-500'}`}>{pw.username}</p>
                </button>
              ))}
            </div>
          )}
          {hiddenCount > 0 && (
            <p className="mt-1.5 text-xs text-gray-400 italic">
              {hiddenCount} password{hiddenCount !== 1 ? 's' : ''} hidden (recovery / break-glass)
            </p>
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
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Organisation name</label>
        <input
          type="text"
          value={org?.name || ''}
          onChange={e => setOrg({ id: 'manual', name: e.target.value, shortName: '' })}
          placeholder="e.g. AffinityIT"
          className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
        />
      </div>
      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
        <p className="text-xs font-semibold text-blue-700 mb-0.5">Device code login</p>
        <p className="text-xs text-blue-600 leading-relaxed">
          A device code will appear in the output. Visit <span className="font-medium">microsoft.com/devicelogin</span> and enter it to authenticate.
        </p>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: '#f0f3f8' }}>
        <svg className="w-8 h-8 text-navy/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-gray-600 mb-2">No report generated</h3>
      <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
        Select an organisation and authentication method, then click Generate Report.
      </p>
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
        credentials,
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

  const isRunning = status === 'running'
  const isDone = status === 'done' && report

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left sidebar ── */}
      <aside className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">Security Report</h2>
          <p className="text-xs text-gray-400 mt-0.5">Full CA policy inventory for any tenant</p>
        </div>

        {/* Auth mode tabs */}
        <div className="px-5 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Authentication</p>
          <div className="flex gap-1.5 p-1 bg-gray-100 rounded-lg mb-4">
            {[{ id: 'itglue', label: 'IT Glue' }, { id: 'interactive', label: 'Interactive' }].map((m) => (
              <button
                key={m.id}
                onClick={() => handleAuthModeChange(m.id)}
                className={[
                  'flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all',
                  authMode === m.id
                    ? 'bg-white text-navy shadow-sm'
                    : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>

          {authMode === 'itglue' ? (
            <ItGluePanel org={org} setOrg={setOrg} credentials={credentials} setCredentials={setCredentials} />
          ) : (
            <InteractivePanel org={org} setOrg={setOrg} credentials={credentials} setCredentials={setCredentials} />
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Error + Generate */}
        <div className="px-5 py-4 border-t border-gray-100 space-y-3">
          {status === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-red-700 mb-0.5">Error</p>
              <p className="text-xs text-red-600 break-words leading-relaxed">{errorMsg}</p>
            </div>
          )}
          <Button
            variant="primary"
            className="w-full"
            disabled={!canGenerate() || isRunning}
            onClick={handleGenerate}
          >
            {isRunning ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Fetching...
              </span>
            ) : isDone ? 'Re-generate' : 'Generate Report'}
          </Button>
        </div>
      </aside>

      {/* ── Right area ── */}
      <main className="flex-1 overflow-hidden bg-gray-50">
        {isRunning ? (
          <LiveConsole lines={logs} status="running" orgName={org?.name} />
        ) : isDone ? (
          <ReportView
            orgName={report.orgName}
            tenantPolicies={report.policies}
            date={report.date}
            logs={logs}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}
