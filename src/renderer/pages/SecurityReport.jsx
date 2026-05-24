import React, { useState, useEffect, useMemo } from 'react'
import useStore from '../store'
import Button from '../components/Button'
import { BASELINES } from '../data/baselines.js'
import { POLICIES } from '../../shared/constants.js'

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

// ── Baseline recommendations ──────────────────────────────────────────────────

const _POLICY_MAP = Object.fromEntries(POLICIES.map(p => [p.id, p]))

// Configuration-based matchers for baseline CA policies.
// Checks the actual Graph API policy object so policies created outside this
// tool (e.g. "Require multifactor authentication for all users") are detected
// by what they DO rather than their display name.
const _pv = (obj, ...keys) => { for (const k of keys) { if (obj?.[k] != null) return obj[k] } return null }
const _controls = (p) => _pv(_pv(p, 'GrantControls', 'grantControls'), 'BuiltInControls', 'builtInControls') || []
const _cond = (p) => _pv(p, 'Conditions', 'conditions') || {}
const _users = (p) => _pv(_cond(p), 'Users', 'users') || {}
const _apps = (p) => _pv(_cond(p), 'Applications', 'applications') || {}
const _platforms = (p) => (_pv(_pv(_cond(p), 'Platforms', 'platforms'), 'IncludePlatforms', 'includePlatforms') || []).map(x => x.toLowerCase())
const _clientApps = (p) => (_pv(_cond(p), 'ClientAppTypes', 'clientAppTypes') || []).map(x => x.toLowerCase())
const _signInRisk = (p) => (_pv(_cond(p), 'SignInRiskLevels', 'signInRiskLevels') || []).map(x => x.toLowerCase())
const _userRisk = (p) => (_pv(_cond(p), 'UserRiskLevels', 'userRiskLevels') || []).map(x => x.toLowerCase())
const _incUsers = (p) => (_pv(_users(p), 'IncludeUsers', 'includeUsers') || []).map(x => x.toLowerCase())
const _incRoles = (p) => (_pv(_users(p), 'IncludeRoles', 'includeRoles') || [])
const _incApps = (p) => _pv(_apps(p), 'IncludeApplications', 'includeApplications') || []
const _userActions = (p) => _pv(_apps(p), 'IncludeUserActions', 'includeUserActions') || []
const _sc = (p) => _pv(p, 'SessionControls', 'sessionControls') || {}
const _hasMfa = (p) => _controls(p).includes('mfa') || _pv(_pv(p, 'GrantControls', 'grantControls'), 'AuthenticationStrength', 'authenticationStrength') != null

const POLICY_MATCHERS = {
  // Require MFA for All Users — all users targeted + MFA grant
  CA001: (p) => _incUsers(p).includes('all') && _hasMfa(p),
  // Block Legacy Authentication — legacy client app types + block grant
  CA002: (p) => _clientApps(p).some(c => ['exchangeactivesync', 'other'].includes(c)) && _controls(p).includes('block'),
  // Require MFA for Admins — specific roles targeted + MFA
  CA003: (p) => _incRoles(p).length > 0 && _hasMfa(p),
  // Require Compliant / Hybrid-Joined Device
  CA004: (p) => _controls(p).some(c => ['compliantdevice', 'domainjoineddevice'].includes(c.toLowerCase())),
  // Require MFA for Azure Management — targets Azure Management app
  CA006: (p) => _incApps(p).some(a => ['797f4846-ba00-4fd7-ba43-dac1f8f63013', 'MicrosoftAzureManagement'].includes(a)) && _hasMfa(p),
  // Require Password Change for High User Risk
  CA008: (p) => _userRisk(p).includes('high') && _controls(p).includes('passwordChange'),
  // Require MFA for Medium/High Sign-In Risk
  CA009: (p) => _signInRisk(p).some(r => ['medium', 'high'].includes(r)) && _hasMfa(p),
  // Require App Protection Policy (iOS)
  CA011: (p) => _platforms(p).includes('ios') && _controls(p).some(c => ['approvedApplication', 'compliantApplication'].includes(c)),
  // Require App Protection Policy (Android)
  CA012: (p) => _platforms(p).includes('android') && _controls(p).some(c => ['approvedApplication', 'compliantApplication'].includes(c)),
  // Require MFA for Guest Users
  CA014: (p) => _incUsers(p).includes('guestsorexternalusers') && _hasMfa(p),
  // Session Control: No Persistent Browser
  CA016: (p) => { const pb = _pv(_sc(p), 'PersistentBrowser', 'persistentBrowser'); return !!(pb && (pb.IsEnabled ?? pb.isEnabled)) },
  // Block Unsupported Device Platforms — platform targeting + block
  CA018: (p) => _platforms(p).length > 0 && _controls(p).includes('block'),
  // Require MFA Registration (SSPR) — user action for security info registration
  CA019: (p) => _userActions(p).some(a => a.toLowerCase().includes('registersecurityinfo')),
  // Require Phishing-Resistant MFA for Admins — roles + auth strength
  CA026: (p) => _incRoles(p).length > 0 && _pv(_pv(p, 'GrantControls', 'grantControls'), 'AuthenticationStrength', 'authenticationStrength') != null,
  // Session Control: App-Enforced Restrictions
  CA030: (p) => { const aer = _pv(_sc(p), 'ApplicationEnforcedRestrictions', 'applicationEnforcedRestrictions'); return !!(aer && (aer.IsEnabled ?? aer.isEnabled)) },
  // Require MFA for Microsoft Admin Portals
  CA033: (p) => _incApps(p).includes('MicrosoftAdminPortals') && _hasMfa(p),
  // Session Lifetime: Admin Accounts — roles + sign-in frequency
  CA045: (p) => { const sf = _pv(_sc(p), 'SignInFrequency', 'signInFrequency'); return _incRoles(p).length > 0 && !!(sf && (sf.IsEnabled ?? sf.isEnabled)) },
}

function computeRecommendations(tenantPolicies, selectedBaselineIds = null) {
  const baselines = selectedBaselineIds
    ? BASELINES.filter(b => selectedBaselineIds.includes(b.id))
    : BASELINES
  return baselines.map(baseline => {
    const items = baseline.policyIds.map(id => {
      const policy = _POLICY_MAP[id]
      if (!policy) return null
      if (id.startsWith('IP')) return { id, name: policy.name, severity: policy.severity, status: 'unverifiable' }
      const idPattern = new RegExp(`\\b${id}\\b`)
      const matcher = POLICY_MATCHERS[id]
      const found = tenantPolicies.some(p => {
        const dn = pick(p, 'DisplayName', 'displayName') || ''
        // ID match (tool-managed naming) OR configuration intent match
        return idPattern.test(dn) || (matcher && matcher(p))
      })
      return { id, name: policy.name, severity: policy.severity, status: found ? 'present' : 'missing' }
    }).filter(Boolean)
    const caItems = items.filter(i => i.status !== 'unverifiable')
    const presentCount = caItems.filter(i => i.status === 'present').length
    return {
      ...baseline,
      items,
      presentCount,
      totalCaCount: caItems.length,
      missingItems: items.filter(i => i.status === 'missing'),
      unverifiableCount: items.filter(i => i.status === 'unverifiable').length,
    }
  })
}

const SEV_STYLE = {
  critical: { background: '#fef2f2', color: '#dc2626' },
  high:     { background: '#fff7ed', color: '#ea580c' },
  medium:   { background: '#fffbeb', color: '#ca8a04' },
  low:      { background: '#f0fdf4', color: '#16a34a' },
  info:     { background: '#f0f9ff', color: '#0369a1' },
}

function BaselineRecommendationCard({ baseline }) {
  const { name, missingItems, presentCount, totalCaCount, unverifiableCount } = baseline
  const pct = totalCaCount > 0 ? Math.round((presentCount / totalCaCount) * 100) : 100
  const pctColor = pct === 100 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="text-sm font-semibold text-gray-900">{name}</p>
        <div className="flex-shrink-0 text-right">
          <p className="text-xl font-bold leading-none" style={{ color: pctColor }}>{pct}%</p>
          <p className="text-xs text-gray-400 mt-0.5">{presentCount}/{totalCaCount} found</p>
        </div>
      </div>

      {missingItems.length === 0 ? (
        <p className="text-xs text-green-700 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          All baseline CA policies detected
        </p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 mb-2">Recommended additions:</p>
          {missingItems.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{item.id}</span>
              <span className="text-xs text-gray-700 flex-1 min-w-0">{item.name}</span>
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                style={SEV_STYLE[item.severity] || SEV_STYLE.info}>{item.severity}</span>
            </div>
          ))}
        </div>
      )}

      {unverifiableCount > 0 && (
        <p className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
          + {unverifiableCount} Identity Protection {unverifiableCount === 1 ? 'policy' : 'policies'} — requires separate Entra ID review
        </p>
      )}
    </div>
  )
}

function RecommendationsSection({ recommendations }) {
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Baseline Coverage</p>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4">
        <p className="text-xs text-amber-800">
          <span className="font-semibold">Note:</span> Policies are matched by ID in the display name (e.g. "CA001: Require MFA") or by their configuration intent — so any policy with the right settings is detected regardless of its name. Identity Protection policies (IP*) require a separate Entra ID review.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {recommendations.map(r => <BaselineRecommendationCard key={r.id} baseline={r} />)}
      </div>
    </div>
  )
}

// ── Progress UI for report generation ────────────────────────────────────────

function GeneratingView({ orgName }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1800)
    const t2 = setTimeout(() => setPhase(2), 3500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  const steps = [
    { label: 'Connected to Microsoft Graph', done: true },
    { label: 'Fetching Conditional Access policies', active: phase === 0, done: phase > 0 },
    { label: 'Processing policy data', active: phase === 1, done: phase > 1 },
    { label: 'Building report', active: phase === 2, done: false },
  ]

  return (
    <div className="flex flex-col items-center justify-center h-full gap-10 px-8">
      {/* Animated shield icon */}
      <div className="relative">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: '#f0f4f8' }}>
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="#1a2d4a" strokeWidth={1.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#1a2d4a' }}>
          <svg className="w-3 h-3 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <div className="w-full max-w-xs space-y-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center mb-4">
          {orgName ? `Auditing ${orgName}` : 'Generating report'}
        </p>
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              {step.done ? (
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#dcfce7' }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="#16a34a" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : step.active ? (
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: '#1a2d4a' }}>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
              )}
            </div>
            <span className={`text-sm leading-snug ${
              step.done ? 'text-gray-400 line-through' :
              step.active ? 'text-gray-900 font-medium' :
              'text-gray-300'
            }`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${[25, 60, 85, 100][phase]}%`, background: '#1a2d4a' }}
          />
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">This may take a moment for large tenants</p>
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

// ── Account managers ──────────────────────────────────────────────────────────
const ACCOUNT_MANAGERS = [
  { name: 'David Capel',     email: 'david.capel@affinityit.co.uk' },
  { name: 'David Pearson',   email: 'david.pearson@affinityit.co.uk' },
  { name: 'Elliot Armitage', email: 'elliot.armitage@affinityit.co.uk' },
]

// ── Report view ───────────────────────────────────────────────────────────────

function ReportView({ orgName, tenantPolicies, nameMap = {}, date, selectedBaselines = null }) {
  const [savingPDF, setSavingPDF] = useState(false)
  const [savingDocx, setSavingDocx] = useState(false)
  const [savedPath, setSavedPath] = useState(null)
  const [accountManager, setAccountManager] = useState(ACCOUNT_MANAGERS[0])
  const enabled = tenantPolicies.filter(p => pick(p, 'State', 'state') === 'enabled').length
  const reportOnly = tenantPolicies.filter(p => pick(p, 'State', 'state') === 'enabledForReportingButNotEnforced').length
  const disabled = tenantPolicies.filter(p => pick(p, 'State', 'state') === 'disabled').length
  const recommendations = useMemo(
    () => computeRecommendations(tenantPolicies, selectedBaselines),
    [tenantPolicies, selectedBaselines]
  )

  async function handleExportPDF() {
    setSavingPDF(true)
    setSavedPath(null)
    try {
      const result = await window.api.report.savePDF(orgName, tenantPolicies, nameMap, recommendations)
      if (result?.path) {
        setSavedPath('pdf')
        setTimeout(() => setSavedPath(null), 5000)
      }
    } catch {} finally {
      setSavingPDF(false)
    }
  }

  async function handleExportDocx() {
    setSavingDocx(true)
    setSavedPath(null)
    try {
      const result = await window.api.report.saveDocx(orgName, tenantPolicies, nameMap, recommendations, accountManager)
      if (result?.path) {
        setSavedPath('docx')
        setTimeout(() => setSavedPath(null), 5000)
      }
    } catch {} finally {
      setSavingDocx(false)
    }
  }

  const saving = savingPDF || savingDocx

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
        <div className="ml-auto flex items-center gap-3">
          {/* Account manager selector */}
          <div className="flex items-center gap-2 border-r border-gray-200 pr-3">
            <span className="text-xs text-gray-400 whitespace-nowrap">Account Manager</span>
            <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
              {ACCOUNT_MANAGERS.map(am => (
                <button
                  key={am.email}
                  onClick={() => setAccountManager(am)}
                  title={am.email}
                  className={[
                    'px-2.5 py-1.5 font-medium transition-colors border-r border-gray-200 last:border-0 whitespace-nowrap',
                    accountManager.email === am.email
                      ? 'bg-navy text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50',
                  ].join(' ')}
                >
                  {am.name.split(' ').map((w, i) => i === 0 ? w : w[0]).join(' ')}
                </button>
              ))}
            </div>
          </div>

          {savedPath && (
            <span className="text-xs text-emerald-600 font-medium">
              {savedPath === 'pdf' ? 'PDF saved' : 'Word doc saved'}
            </span>
          )}
          <Button variant="secondary" onClick={handleExportPDF} loading={savingPDF} disabled={saving}>
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Save PDF
          </Button>
          <Button variant="secondary" onClick={handleExportDocx} loading={savingDocx} disabled={saving}>
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Save Word
          </Button>
        </div>
      </div>

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

        <RecommendationsSection recommendations={recommendations} />
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
  const { tenantSession, openConnectModal, openSwitchModal } = useStore()
  const [orgName, setOrgName] = useState('')
  const [status, setStatus] = useState('idle')
  const [report, setReport] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedBaselines, setSelectedBaselines] = useState(() => BASELINES.map(b => b.id))

  const toggleBaseline = (id) => {
    setSelectedBaselines(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  useEffect(() => {
    if (tenantSession?.Account && !orgName) {
      const domain = tenantSession.Account.split('@')[1]?.split('.')[0] || ''
      setOrgName(domain)
    }
  }, [tenantSession])

  async function handleGenerate() {
    if (!tenantSession) return
    setStatus('running')
    setReport(null)
    setErrorMsg('')

    try {
      const result = await window.api.report.audit()
      if (result.error) {
        setErrorMsg(result.error)
        setStatus('error')
      } else {
        setReport({
          policies: result.policies,
          nameMap: result.nameMap || {},
          orgName: result.tenantName || orgName || tenantSession?.Account || '',
          date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        })
        setStatus('done')
      }
    } catch (err) {
      setErrorMsg(err.message || 'Unknown error')
      setStatus('error')
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
          <p className="text-xs text-gray-400 mt-0.5">Full CA policy inventory for the connected tenant</p>
        </div>

        <div className="px-5 pt-4 space-y-4">
          {tenantSession ? (
            <>
              {/* Connected tenant info */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <p className="text-xs font-semibold text-emerald-700">Connected</p>
                  </div>
                  <button
                    onClick={openSwitchModal}
                    className="text-xs text-emerald-600 hover:text-emerald-800 font-medium underline underline-offset-2"
                  >
                    Switch
                  </button>
                </div>
                <p className="text-xs text-emerald-800 truncate pl-3.5">{tenantSession.Account}</p>
              </div>

              {/* Org name for report */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Report label (org name)</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  placeholder="e.g. Contoso"
                  className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              {/* Baseline selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Baselines to include</label>
                  <button
                    onClick={() => setSelectedBaselines(
                      selectedBaselines.length === BASELINES.length ? [] : BASELINES.map(b => b.id)
                    )}
                    className="text-xs text-navy hover:underline"
                  >
                    {selectedBaselines.length === BASELINES.length ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {BASELINES.map(b => {
                    const selected = selectedBaselines.includes(b.id)
                    return (
                      <button
                        key={b.id}
                        onClick={() => toggleBaseline(b.id)}
                        className={`w-full text-left rounded-lg border-2 px-3 py-2 transition-all ${
                          selected ? b.color.card : 'border-gray-200 bg-white opacity-50 hover:opacity-75'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center ${
                            selected ? b.color.badge : 'bg-gray-200'
                          }`}>
                            {selected && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className="text-xs font-semibold text-gray-800 leading-tight">{b.name}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 pl-5 leading-snug">{b.subtitle}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center space-y-3">
              <p className="text-xs text-gray-500">Connect a tenant to generate a security report.</p>
              <button
                onClick={openConnectModal}
                className="w-full py-1.5 rounded-md bg-navy text-white text-xs font-semibold hover:bg-navy/90 transition-colors"
              >
                Connect Tenant
              </button>
            </div>
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
            disabled={!tenantSession || isRunning}
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
          <GeneratingView orgName={orgName || tenantSession?.Account} />
        ) : isDone ? (
          <ReportView
            orgName={report.orgName}
            tenantPolicies={report.policies}
            nameMap={report.nameMap}
            date={report.date}
            selectedBaselines={selectedBaselines.length > 0 ? selectedBaselines : null}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}
