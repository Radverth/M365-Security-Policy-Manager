const { ipcMain, app, shell, dialog, BrowserWindow } = require('electron')
const { checkPowerShell, runScript } = require('./powershell')
const { getModuleStatus, installModules, updateModules } = require('./moduleManager')
const itGlue = require('./itGlue')
const { buildScript, buildConnectGraph, buildPoliciesScript, needsExo, needsIpps } = require('./policyBuilder')
const store = require('./store')
const logger = require('./logger')
const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')
const psSession = require('./psSession')



function generateReportHtml(orgName, policies, date, nameMap = {}) {
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
  function pick(...keys) { return obj => { for (const k of keys) { if (obj?.[k] != null) return obj[k] } return null } }
  const pv = (obj, ...keys) => { for (const k of keys) { if (obj?.[k] != null) return obj[k] } return null }

  // ── State helpers ──────────────────────────────────────────────────────────
  const stateOf = p => p.State || p.state || 'unknown'
  const stateLabel = s => ({ enabled: 'Enabled', disabled: 'Disabled', enabledForReportingButNotEnforced: 'Report Only' }[s] || 'Unknown')
  const stateColors = s => ({
    enabled:                           { bg: '#dcfce7', text: '#15803d', border: '#22c55e', section: '#16a34a' },
    enabledForReportingButNotEnforced: { bg: '#fef3c7', text: '#b45309', border: '#f59e0b', section: '#d97706' },
    disabled:                          { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db', section: '#9ca3af' },
  }[s] || { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db', section: '#9ca3af' })

  // ── Formatters ─────────────────────────────────────────────────────────────
  const PLATFORM_LABELS = { android: 'Android', iOS: 'iOS', macOS: 'macOS', windows: 'Windows', windowsPhone: 'Windows Phone', linux: 'Linux', all: 'All Platforms' }
  const CLIENT_LABELS   = { browser: 'Browser', mobileAppsAndDesktopClients: 'Mobile & Desktop', exchangeActiveSync: 'Exchange ActiveSync', easSupported: 'EAS (Supported)', other: 'Other Clients', all: 'All Clients' }
  const RISK_LABELS     = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' }
  const CTRL_LABELS     = { mfa: 'Require MFA', compliantDevice: 'Require Compliant Device', domainJoinedDevice: 'Require Hybrid Azure AD Join', approvedApplication: 'Require Approved App', compliantApplication: 'Require App Protection Policy', block: 'Block Access', passwordChange: 'Require Password Change' }

  function fmtUsers(u) {
    if (!u) return null
    const incU  = pv(u, 'IncludeUsers', 'includeUsers') || []
    const excU  = pv(u, 'ExcludeUsers', 'excludeUsers') || []
    const incG  = pv(u, 'IncludeGroups', 'includeGroups') || []
    const excG  = pv(u, 'ExcludeGroups', 'excludeGroups') || []
    const incR  = pv(u, 'IncludeRoles', 'includeRoles') || []
    const excR  = pv(u, 'ExcludeRoles', 'excludeRoles') || []
    const parts = []
    if (incU.some(x => x.toLowerCase() === 'all')) parts.push('All Users')
    else if (incU.some(x => x.toLowerCase() === 'guestsorexternalusers')) parts.push('Guests & External Users')
    else if (incU.length) parts.push(`${incU.length} specific user(s)`)
    if (incR.length) parts.push(`${incR.length} admin role(s)`)
    if (incG.length) parts.push(`${incG.length} group(s)`)
    const excParts = [...(excU.length ? [`${excU.length} user(s)`] : []), ...(excG.length ? [`${excG.length} group(s)`] : []), ...(excR.length ? [`${excR.length} role(s)`] : [])]
    if (!parts.length) return 'None configured'
    return parts.join(', ') + (excParts.length ? ` — excluding ${excParts.join(', ')}` : '')
  }

  function fmtExclusions(u) {
    if (!u) return null
    const excU = pv(u, 'ExcludeUsers', 'excludeUsers') || []
    const excG = pv(u, 'ExcludeGroups', 'excludeGroups') || []
    const excR = pv(u, 'ExcludeRoles', 'excludeRoles') || []
    const items = []
    for (const id of excU) {
      const label = id === 'GuestsOrExternalUsers' ? 'Guests &amp; External Users'
        : id === 'None' ? null
        : nameMap[id] ? esc(nameMap[id])
        : `<span style="font-family:'Courier New',monospace;font-size:11px">${esc(id)}</span>`
      if (label) items.push({ icon: '👤', label, type: 'user' })
    }
    for (const id of excG) {
      const label = nameMap[id] ? esc(nameMap[id]) : `<span style="font-family:'Courier New',monospace;font-size:11px">${esc(id)}</span>`
      items.push({ icon: '👥', label, type: 'group' })
    }
    for (const id of excR) {
      const label = nameMap[id] ? esc(nameMap[id]) : `<span style="font-family:'Courier New',monospace;font-size:11px">${esc(id)}</span>`
      items.push({ icon: '🔑', label, type: 'role' })
    }
    return items.length ? items : null
  }

  function fmtApps(a) {
    if (!a) return null
    const inc = pv(a, 'IncludeApplications', 'includeApplications') || []
    const exc = pv(a, 'ExcludeApplications', 'excludeApplications') || []
    if (inc.some(x => x.toLowerCase() === 'all')) return exc.length ? `All Applications (${exc.length} excluded)` : 'All Applications'
    if (inc.some(x => x === 'Office365')) return 'Microsoft 365 Apps'
    if (inc.length === 1) return '1 specific application'
    if (inc.length > 1) return `${inc.length} specific applications`
    return 'None configured'
  }

  function fmtPlatforms(p) {
    if (!p) return null
    const inc = pv(p, 'IncludePlatforms', 'includePlatforms') || []
    const exc = pv(p, 'ExcludePlatforms', 'excludePlatforms') || []
    if (!inc.length) return null
    if (inc.some(x => x.toLowerCase() === 'all')) return exc.length ? `All Platforms (excluding ${exc.map(x => PLATFORM_LABELS[x] || x).join(', ')})` : 'All Platforms'
    return inc.map(x => PLATFORM_LABELS[x] || x).join(', ')
  }

  function fmtLocations(l) {
    if (!l) return null
    const inc = pv(l, 'IncludeLocations', 'includeLocations') || []
    const exc = pv(l, 'ExcludeLocations', 'excludeLocations') || []
    if (!inc.length) return null
    if (inc.includes('All')) return exc.length ? `All Locations (${exc.length} location(s) excluded)` : 'All Locations'
    if (inc.includes('AllTrusted')) return exc.length ? `All Trusted Locations (${exc.length} excluded)` : 'All Trusted Locations'
    return `${inc.length} specific location(s)${exc.length ? ` (${exc.length} excluded)` : ''}`
  }

  function fmtGrant(g) {
    if (!g) return null
    const controls = (pv(g, 'BuiltInControls', 'builtInControls') || []).map(c => CTRL_LABELS[c] || c)
    const strength = pv(g, 'AuthenticationStrength', 'authenticationStrength')
    if (strength) controls.push('Authentication Strength (phishing-resistant)')
    if (!controls.length) return null
    const op = (pv(g, 'Operator', 'operator') || 'OR').toUpperCase()
    return controls.join(` ${op} `)
  }

  function fmtSession(s) {
    if (!s) return null
    const parts = []
    const sf = pv(s, 'SignInFrequency', 'signInFrequency')
    if (sf && (sf.isEnabled || sf.IsEnabled)) {
      const val = sf.value ?? sf.Value, type = sf.type || sf.Type
      parts.push(val && type ? `Sign-in frequency: every ${val} ${type}` : 'Sign-in frequency enforced')
    }
    const pb = pv(s, 'PersistentBrowser', 'persistentBrowser')
    if (pb && (pb.isEnabled || pb.IsEnabled)) parts.push(`Persistent browser: ${pb.mode || pb.Mode || 'configured'}`)
    const ar = pv(s, 'ApplicationEnforcedRestrictions', 'applicationEnforcedRestrictions')
    if (ar && (ar.isEnabled || ar.IsEnabled)) parts.push('App-enforced restrictions enabled')
    return parts.length ? parts.join('; ') : null
  }

  function fmtClientApps(types) {
    if (!types?.length) return null
    return types.map(t => CLIENT_LABELS[t] || t).join(', ')
  }

  function fmtRisk(levels) {
    if (!levels?.length) return null
    return levels.map(l => RISK_LABELS[l] || l).join(', ')
  }

  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }

  // ── Detail row ─────────────────────────────────────────────────────────────
  function detailRow(label, value) {
    if (!value) return ''
    return `<tr>
      <td style="padding:5px 14px 5px 0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;white-space:nowrap;vertical-align:top;width:120px">${esc(label)}</td>
      <td style="padding:5px 0;font-size:12px;color:#1f2937;line-height:1.5">${esc(value)}</td>
    </tr>`
  }

  // ── Policy card ────────────────────────────────────────────────────────────
  function policyCard(p) {
    const state  = stateOf(p)
    const colors = stateColors(state)
    const name   = esc(pv(p, 'DisplayName', 'displayName') || 'Unnamed Policy')
    const id     = esc(pv(p, 'Id', 'id') || '')
    const cond   = pv(p, 'Conditions', 'conditions') || {}

    const users      = fmtUsers(pv(cond, 'Users', 'users'))
    const apps       = fmtApps(pv(cond, 'Applications', 'applications'))
    const platforms  = fmtPlatforms(pv(cond, 'Platforms', 'platforms'))
    const locations  = fmtLocations(pv(cond, 'Locations', 'locations'))
    const clientApps = fmtClientApps(pv(cond, 'ClientAppTypes', 'clientAppTypes'))
    const signRisk   = fmtRisk(pv(cond, 'SignInRiskLevels', 'signInRiskLevels'))
    const userRisk   = fmtRisk(pv(cond, 'UserRiskLevels', 'userRiskLevels'))
    const grant      = fmtGrant(pv(p, 'GrantControls', 'grantControls'))
    const session    = fmtSession(pv(p, 'SessionControls', 'sessionControls'))
    const created    = fmtDate(pv(p, 'CreatedDateTime', 'createdDateTime'))
    const modified   = fmtDate(pv(p, 'ModifiedDateTime', 'modifiedDateTime'))
    const exclusions = fmtExclusions(pv(cond, 'Users', 'users'))

    const hasConditions = users || apps || platforms || locations || clientApps || signRisk || userRisk
    const hasControls   = grant || session

    const subHdr = `font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:#1a2d4a;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #f3f4f6`

    const typeLabels = { user: 'User', group: 'Group', role: 'Role' }
    const exclusionsHtml = exclusions ? `
      <div style="padding:10px 18px 14px;border-top:1px solid #f3f4f6">
        <div style="${subHdr};margin-bottom:10px">Excluded Users &amp; Groups</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${exclusions.map(item => `<span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca">
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#dc2626;flex-shrink:0">${typeLabels[item.type]}</span>
            <span style="font-size:12px;color:#111827">${item.label}</span>
          </span>`).join('')}
        </div>
      </div>` : ''

    return `<div style="margin-bottom:16px;page-break-inside:avoid;border:1px solid #e5e7eb;border-left:5px solid ${colors.border};border-radius:8px;background:#fff;overflow:hidden">
      <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:13px 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border-bottom:1px solid #f3f4f6">
        <div>
          <div style="font-size:14px;font-weight:700;color:#111827;line-height:1.35">${name}</div>
          <div style="font-size:10px;color:#d1d5db;font-family:'Courier New',Courier,monospace;margin-top:4px;letter-spacing:0.3px">${id}</div>
        </div>
        <span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;flex-shrink:0;display:inline-block;padding:4px 12px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:0.4px;background:${colors.bg};color:${colors.text}">${stateLabel(state)}</span>
      </div>
      <div style="padding:12px 18px;display:grid;grid-template-columns:1fr 1fr;gap:0 36px">
        ${hasConditions ? `<div>
          <div style="${subHdr}">Scope &amp; Conditions</div>
          <table style="width:100%;border-collapse:collapse">
            ${detailRow('Users', users)}
            ${detailRow('Applications', apps)}
            ${detailRow('Platforms', platforms)}
            ${detailRow('Locations', locations)}
            ${detailRow('Client Apps', clientApps)}
            ${detailRow('Sign-in Risk', signRisk)}
            ${detailRow('User Risk', userRisk)}
          </table>
        </div>` : '<div></div>'}
        <div>
          ${hasControls ? `<div style="${subHdr}">Access Controls</div>
          <table style="width:100%;border-collapse:collapse">
            ${detailRow('Grant', grant)}
            ${detailRow('Session', session)}
          </table>
          <div style="margin-top:14px"></div>` : ''}
          <div style="${subHdr}">Timeline</div>
          <table style="width:100%;border-collapse:collapse">
            ${detailRow('Created', created)}
            ${detailRow('Modified', modified)}
          </table>
        </div>
      </div>
      ${exclusionsHtml}
    </div>`
  }

  // ── Section block ──────────────────────────────────────────────────────────
  function section(label, sectionPolicies, colorHex) {
    if (!sectionPolicies.length) return ''
    return `<div style="margin-bottom:28px">
      <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:9px;border-bottom:2px solid #f3f4f6">
        <span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-block;width:11px;height:11px;border-radius:50%;background:${colorHex};flex-shrink:0"></span>
        <span style="font-size:13px;font-weight:700;color:#1a2d4a;letter-spacing:0.2px">${esc(label)}</span>
        <span style="font-size:12px;color:#9ca3af">(${sectionPolicies.length})</span>
      </div>
      ${sectionPolicies.map(policyCard).join('')}
    </div>`
  }

  // ── Stats summary ──────────────────────────────────────────────────────────
  const enabled    = policies.filter(p => stateOf(p) === 'enabled')
  const reportOnly = policies.filter(p => stateOf(p) === 'enabledForReportingButNotEnforced')
  const disabled   = policies.filter(p => stateOf(p) === 'disabled')

  const statCards = [
    { label: 'Total Policies', value: policies.length, color: '#1a2d4a' },
    { label: 'Enabled',        value: enabled.length,  color: '#16a34a' },
    { label: 'Report Only',    value: reportOnly.length, color: '#d97706' },
    { label: 'Disabled',       value: disabled.length,  color: '#9ca3af' },
  ].map(s => `<div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#f9fafb;border:1px solid #e5e7eb;border-top:3px solid ${s.color};border-radius:8px;padding:18px 12px;text-align:center">
    <div style="font-size:34px;font-weight:700;color:${s.color};line-height:1">${s.value}</div>
    <div style="font-size:10px;font-weight:700;color:#9ca3af;margin-top:9px;text-transform:uppercase;letter-spacing:0.8px">${s.label}</div>
  </div>`).join('')

  // ── Overview table (compact, one row per policy) ───────────────────────────
  const overviewRows = policies.map((p, i) => {
    const state  = stateOf(p)
    const colors = stateColors(state)
    const name   = esc(pv(p, 'DisplayName', 'displayName') || 'Unnamed')
    const users  = esc(fmtUsers(pv(pv(p, 'Conditions', 'conditions'), 'Users', 'users')) || '—')
    const grant  = esc(fmtGrant(pv(p, 'GrantControls', 'grantControls')) || '—')
    const bg = i % 2 === 0 ? '#fff' : '#f9fafb'
    return `<tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:${bg}">
      <td style="padding:7px 10px;font-size:11px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;border-left:3px solid ${colors.border}">${name}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;white-space:nowrap">
        <span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-block;padding:3px 8px;border-radius:9999px;font-size:9.5px;font-weight:700;background:${colors.bg};color:${colors.text}">${stateLabel(state)}</span>
      </td>
      <td style="padding:7px 10px;font-size:11px;color:#374151;border-bottom:1px solid #f3f4f6">${users}</td>
      <td style="padding:7px 10px;font-size:11px;color:#374151;border-bottom:1px solid #f3f4f6">${grant}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { margin: 15mm 13mm; size: A4 portrait; }
body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.55; background: #fff; color: #1f2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { width: 100%; border-collapse: collapse; }
p { margin: 0; }
.break { page-break-before: always; }
</style>
</head>
<body>

<!-- ═══ COVER PAGE ═══════════════════════════════════════════════════════════ -->
<div style="min-height:257mm;display:flex;flex-direction:column;gap:20px">

  <!-- Branding header -->
  <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#1a2d4a;border-radius:10px;overflow:hidden">
    <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;height:5px;background:linear-gradient(90deg,#b87820 0%,#E8A830 35%,#f5d080 65%,#E8A830 100%)"></div>
    <div style="padding:28px 36px 32px">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px">
        <div>
          <div style="font-size:34px;font-weight:200;color:#fff;letter-spacing:-1.5px;line-height:1">affinity</div>
          <div style="font-size:11px;color:#E8A830;margin-top:7px;letter-spacing:0.5px">Technology. Together.</div>
        </div>
        <div style="flex:1;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:5px"></div>
        <div style="text-align:right">
          <div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:8px">M365 Security Policy Report</div>
          <div style="font-size:24px;font-weight:600;color:#fff;line-height:1.2;margin-bottom:6px">${esc(orgName || 'Tenant Report')}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.5)">Generated ${esc(date)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Stats -->
  <div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    ${statCards}
  </div>

  <!-- About this report -->
  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;background:#f9fafb">
    <div style="font-size:13px;font-weight:700;color:#1a2d4a;margin-bottom:10px">About This Report</div>
    <p style="font-size:12px;color:#374151;line-height:1.65;margin-bottom:10px">
      This report provides a complete snapshot of the Microsoft 365 Conditional Access policies configured in the <strong>${esc(orgName || 'tenant')}</strong> environment, generated on ${esc(date)}.
    </p>
    <p style="font-size:12px;color:#374151;line-height:1.65;margin-bottom:10px">
      <strong>Conditional Access</strong> is the Microsoft Entra ID (Azure AD) security mechanism that controls who can access which cloud applications, under what conditions, and from which devices or locations. Each policy defines a set of conditions (scope) and a resulting action (grant or block access).
    </p>
    <p style="font-size:12px;color:#374151;line-height:1.65;margin-bottom:14px">
      The full policy detail section (following pages) groups policies by status and shows all configured conditions — including users, applications, device platforms, network locations, sign-in risk levels, and access controls such as MFA requirements.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="font-size:11px;font-weight:700;color:#374151;margin-right:4px;line-height:2">Policy status:</div>
      ${[
        { label: 'Enabled', bg: '#dcfce7', text: '#15803d', desc: 'Actively enforced on sign-in' },
        { label: 'Report Only', bg: '#fef3c7', text: '#b45309', desc: 'Evaluated but not enforced (audit mode)' },
        { label: 'Disabled', bg: '#f3f4f6', text: '#6b7280', desc: 'Inactive — not evaluated' },
      ].map(b => `<span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;background:${b.bg};margin-right:6px">
        <span style="font-size:10px;font-weight:700;color:${b.text}">${b.label}</span>
        <span style="font-size:10px;color:#6b7280">&mdash; ${b.desc}</span>
      </span>`).join('')}
    </div>
  </div>

  <!-- Overview table -->
  <div>
    <div style="font-size:12px;font-weight:700;color:#1a2d4a;margin-bottom:9px;text-transform:uppercase;letter-spacing:0.5px">Policy Overview</div>
    <table>
      <thead>
        <tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#f3f4f6">
          <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#6b7280;border-bottom:2px solid #e5e7eb">Policy Name</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#6b7280;border-bottom:2px solid #e5e7eb;white-space:nowrap">Status</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#6b7280;border-bottom:2px solid #e5e7eb">Users</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#6b7280;border-bottom:2px solid #e5e7eb">Grant Controls</th>
        </tr>
      </thead>
      <tbody>${overviewRows}</tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="margin-top:auto;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
    <p style="font-size:10px;color:#9ca3af">This report covers Conditional Access policies only. Full policy details with all conditions and controls are on the following pages. &middot; Confidential &mdash; ${esc(orgName || 'Tenant')}</p>
  </div>
</div>

<!-- ═══ DETAIL PAGES ════════════════════════════════════════════════════════ -->
<div class="break">
  <div style="margin-bottom:20px;display:flex;align-items:baseline;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:700;color:#1a2d4a">Conditional Access — Full Policy Details</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:3px">${policies.length} ${policies.length === 1 ? 'policy' : 'policies'} &mdash; ${esc(orgName || 'Tenant')} &mdash; ${esc(date)}</div>
    </div>
  </div>

  <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;background:#f9fafb;margin-bottom:22px">
    <p style="font-size:12px;color:#374151;line-height:1.6">Each policy below shows the full configuration retrieved directly from Microsoft Entra ID. <strong>Scope &amp; Conditions</strong> describes who and what the policy targets. <strong>Access Controls</strong> describes the action taken when those conditions are met — such as requiring MFA or blocking access. Policies with no conditions listed apply to all users and all applications by default.</p>
  </div>

  ${section('Enabled', enabled, '#22c55e')}
  ${section('Report Only', reportOnly, '#f59e0b')}
  ${section('Disabled', disabled, '#d1d5db')}

  <div style="margin-top:18px;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
    <p style="font-size:10px;color:#9ca3af">Generated by M365 Security Policy Manager &middot; Affinity Technology &middot; ${esc(date)} &middot; Confidential</p>
  </div>
</div>

</body>
</html>`
}

function registerIpcHandlers(win) {
  // Store
  ipcMain.handle('store:get', (_, key) => store.get(key))
  ipcMain.handle('store:set', (_, key, value) => store.set(key, value))
  ipcMain.handle('store:delete', (_, key) => store.delete(key))

  // App
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_, url) => shell.openExternal(url))
  ipcMain.handle('app:getLogDir', () => logger.getLogDir())

  // PowerShell check
  ipcMain.handle('modules:checkPs', async () => {
    logger.info('IPC: modules:checkPs')
    return checkPowerShell()
  })

  // Module status
  ipcMain.handle('modules:getStatus', async () => {
    try {
      return await getModuleStatus(win)
    } catch (err) {
      return []
    }
  })

  // Module install
  ipcMain.handle('modules:install', async (_, moduleNames) => {
    logger.info(`IPC: modules:install [${moduleNames.join(', ')}]`)
    const logs = []
    await installModules(
      moduleNames,
      (line) => {
        logs.push(line)
        win.webContents.send('ps:output', line)
      },
      (line) => {
        logs.push(`ERROR: ${line}`)
        win.webContents.send('ps:error', line)
      }
    )
    return logs
  })

  // Module update
  ipcMain.handle('modules:update', async (_, moduleNames) => {
    logger.info(`IPC: modules:update [${moduleNames.join(', ')}]`)
    const logs = []
    await updateModules(
      moduleNames,
      (line) => {
        logs.push(line)
        win.webContents.send('ps:output', line)
      },
      (line) => {
        logs.push(`ERROR: ${line}`)
        win.webContents.send('ps:error', line)
      }
    )
    return logs
  })

  // Install PowerShell (Linux)
  ipcMain.handle('modules:installPowerShell', async () => {
    if (process.platform === 'win32') return { success: false, message: 'Not applicable on Windows' }

    return new Promise((resolve) => {
      let scriptPath
      if (app.isPackaged) {
        scriptPath = path.join(process.resourcesPath, 'scripts', 'install-powershell.sh')
      } else {
        scriptPath = path.join(__dirname, '../../scripts/install-powershell.sh')
      }

      try {
        fs.chmodSync(scriptPath, '755')
      } catch (e) {
        // ignore
      }

      const proc = execFile('bash', [scriptPath], { shell: false })

      proc.stdout.on('data', (d) => {
        d.toString().split('\n').forEach(line => {
          if (line.trim()) win.webContents.send('ps:output', line)
        })
      })
      proc.stderr.on('data', (d) => {
        d.toString().split('\n').forEach(line => {
          if (line.trim()) win.webContents.send('ps:error', line)
        })
      })
      proc.on('close', (code) => {
        resolve({ success: code === 0 })
      })
      proc.on('error', (err) => {
        resolve({ success: false, message: err.message })
      })
    })
  })

  // IT Glue
  ipcMain.handle('itglue:test', async (_, apiKey) => itGlue.testConnection(apiKey))
  ipcMain.handle('itglue:getOrgs', async () => { try { return await itGlue.getOrganizations() } catch { return [] } })
  ipcMain.handle('itglue:getPasswords', async (_, orgId) => { try { return await itGlue.getPasswords(orgId) } catch { return [] } })

  // Session management
  ipcMain.handle('session:connect', async (_, credentials, authMode) => {
    try {
      if (!psSession.alive) await psSession.start(win)
      const context = await psSession.connect(credentials, authMode)
      return { context }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('session:disconnect', async () => {
    await psSession.disconnect()
    return { success: true }
  })

  ipcMain.handle('session:getContext', async () => psSession.context)

  // Policies
  ipcMain.handle('policies:list', async () => {
    if (!psSession.alive) return { error: 'No active session' }
    try {
      const lines = []
      await psSession.run(
        `try {
  $policies = Get-MgIdentityConditionalAccessPolicy -All
  Write-Output "POLICY_JSON_START"
  $policies | ConvertTo-Json -Depth 10 -Compress
  Write-Output "POLICY_JSON_END"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`,
        (line) => lines.push(line)
      )
      const startIdx = lines.indexOf('POLICY_JSON_START')
      const endIdx = lines.indexOf('POLICY_JSON_END')
      if (startIdx !== -1 && endIdx > startIdx) {
        const json = lines.slice(startIdx + 1, endIdx).join('')
        const parsed = JSON.parse(json)
        return { policies: Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []), context: psSession.context }
      }
      const errLine = lines.find(l => l.startsWith('ERROR:'))
      if (errLine) return { error: errLine.slice(6).trim() }
      return { policies: [], context: psSession.context }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('policies:create', async (_, options) => {
    const { policies, credentials, prefix, authMode, policyConfigs, useDeviceCode } = options
    logger.info(`IPC: policies:create count=${policies?.length} authMode=${authMode} prefix=${prefix} session=${psSession.alive}`)

    const logs = []
    const results = {}

    const parseResult = (line) => {
      logs.push(line)
      if (line.startsWith('SUCCESS:')) {
        const id = line.match(/[A-Z]{2}\d{3}/)?.[0]
        if (id) results[id] = 'success'
      } else if (line.startsWith('FAILURE:')) {
        const id = line.match(/[A-Z]{2}\d{3}/)?.[0]
        if (id) results[id] = 'failure'
      }
    }

    const hasExo  = policies.some(p => needsExo(p))
    const hasIpps = policies.some(p => needsIpps(p))

    // If a persistent authenticated session exists and no EXO/IPPS connections are
    // needed, run the policy blocks directly through the session — no re-auth required.
    // psSession's global stdout handler already streams every line to ps:output, so
    // parseResult must NOT re-send or each line would appear twice in the terminal.
    if (psSession.alive && !hasExo && !hasIpps) {
      logger.info('IPC: policies:create — using persistent session (no re-auth)')
      win.webContents.send('ps:output', 'CONNECTED: Using active tenant session — deploying policies...')
      const script = buildPoliciesScript(policies, prefix || '', policyConfigs || {})
      await psSession.run(script, parseResult, 300000)
      return { logs, results }
    }

    // Fall back to a new process with full auth (EXO/IPPS policies, or no session).
    // This spawns a fresh pwsh with no global handler, so we must forward lines ourselves.
    logger.info('IPC: policies:create — spawning new process with full auth')
    const script = buildScript(policies, credentials, prefix, authMode, policyConfigs || {}, { useDeviceCode })
    await runScript(
      script,
      (line) => { win.webContents.send('ps:output', line); parseResult(line) },
      (line) => win.webContents.send('ps:error', line)
    )

    return { logs, results }
  })

  const safe = s => String(s || '').replace(/'/g, "''")

  ipcMain.handle('policies:disconnect', async () => {
    psSession.kill()
    return { success: true }
  })

  ipcMain.handle('policies:update', async (_, id, patch) => {
    const safeId = safe(id)
    const patchJson = JSON.stringify(patch)
    const script = `
try {
  $body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(patchJson).toString('base64')}'))
  Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body $body -ContentType 'application/json'
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`
    const output = await psSession.run(script)
    const lines = output.split('\n')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: lines.some(l => l.trim() === 'SUCCESS') }
  })

  ipcMain.handle('policies:delete', async (_, id) => {
    const safeId = safe(id)
    const script = `
try {
  Remove-MgIdentityConditionalAccessPolicy -ConditionalAccessPolicyId '${safeId}' -Confirm:$false
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`
    const output = await psSession.run(script)
    const lines = output.split('\n')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: lines.some(l => l.trim() === 'SUCCESS') }
  })

  ipcMain.handle('policies:toggleState', async (_, id, state) => {
    const safeId = safe(id)
    const safeState = safe(state)
    const script = `
try {
  Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body (@{ state = '${safeState}' } | ConvertTo-Json) -ContentType 'application/json'
  Write-Output "SUCCESS"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`
    const output = await psSession.run(script)
    const lines = output.split('\n')
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())
    return { success: lines.some(l => l.trim() === 'SUCCESS') }
  })

  // Report: audit CA policies
  ipcMain.handle('report:audit', async () => {
    if (!psSession.alive) return { error: 'No active session — connect a tenant first' }
    try {
      const lines = []
      let inJsonBlock = false
      await psSession.run(
        `try {
  $policies = Get-MgIdentityConditionalAccessPolicy -All
  $count = @($policies).Count
  Write-Output "STATUS: Fetched $count policies from tenant"
  Write-Output "POLICY_JSON_START"
  $policies | ConvertTo-Json -Depth 10 -Compress
  Write-Output "POLICY_JSON_END"
  Write-Output "DONE: $count"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`,
        (line) => {
          lines.push(line)
          if (line === 'POLICY_JSON_START') { inJsonBlock = true; return }
          if (line === 'POLICY_JSON_END') { inJsonBlock = false; return }
          if (!inJsonBlock && line.trim()) {
            win.webContents.send('ps:output', line)
          }
        },
        90000
      )
      const startIdx = lines.indexOf('POLICY_JSON_START')
      const endIdx = lines.indexOf('POLICY_JSON_END')
      if (startIdx === -1 || endIdx <= startIdx) {
        const errLine = lines.find(l => l.startsWith('ERROR:'))
        if (errLine) return { error: errLine.slice(6).trim() }
        return { error: 'No data returned' }
      }
      const json = lines.slice(startIdx + 1, endIdx).join('')
      const parsed = JSON.parse(json)
      const policies = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])

      // Resolve display names for all excluded users, groups, and roles
      const SPECIAL_IDS = new Set(['All', 'None', 'GuestsOrExternalUsers', 'AllTrusted'])
      const excUserIds  = [...new Set(policies.flatMap(p => (p?.Conditions?.Users?.ExcludeUsers || p?.conditions?.users?.excludeUsers || []).filter(id => !SPECIAL_IDS.has(id))))]
      const excGroupIds = [...new Set(policies.flatMap(p => (p?.Conditions?.Users?.ExcludeGroups || p?.conditions?.users?.excludeGroups || [])))]
      const excRoleIds  = [...new Set(policies.flatMap(p => (p?.Conditions?.Users?.ExcludeRoles  || p?.conditions?.users?.excludeRoles  || [])))]

      let nameMap = {}
      if (excUserIds.length || excGroupIds.length || excRoleIds.length) {
        try {
          const userBlocks = excUserIds.map(id => {
            const safe = id.replace(/'/g, "''")
            return `try {
  $r = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/${safe}?`$select=displayName,userPrincipalName" -ErrorAction SilentlyContinue
  if ($r -and $r.displayName) {
    $nameMap['${safe}'] = if ($r.userPrincipalName) { "$($r.displayName) ($($r.userPrincipalName))" } else { $r.displayName }
  }
} catch {}`
          })
          const groupBlocks = excGroupIds.map(id => {
            const safe = id.replace(/'/g, "''")
            return `try {
  $r = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/groups/${safe}?`$select=displayName" -ErrorAction SilentlyContinue
  if ($r -and $r.displayName) { $nameMap['${safe}'] = $r.displayName }
} catch {}`
          })
          const roleBlocks = excRoleIds.map(id => {
            const safe = id.replace(/'/g, "''")
            return `try {
  $r = Get-MgDirectoryRoleTemplate -DirectoryRoleTemplateId '${safe}' -Property DisplayName -ErrorAction SilentlyContinue
  if ($r) { $nameMap['${safe}'] = $r.DisplayName }
} catch {}`
          })

          const nameLines = []
          await psSession.run(
            `$ProgressPreference = 'SilentlyContinue'
$nameMap = @{}
${[...userBlocks, ...groupBlocks, ...roleBlocks].join('\n')}
Write-Output "NAME_MAP_START"
if ($nameMap.Count -gt 0) { $nameMap | ConvertTo-Json -Compress } else { Write-Output "{}" }
Write-Output "NAME_MAP_END"`,
            (line) => nameLines.push(line),
            60000
          )
          const nmStart = nameLines.indexOf('NAME_MAP_START')
          const nmEnd   = nameLines.indexOf('NAME_MAP_END')
          if (nmStart !== -1 && nmEnd > nmStart) {
            nameMap = JSON.parse(nameLines.slice(nmStart + 1, nmEnd).join('')) || {}
          }
        } catch { /* name resolution is best-effort */ }
      }

      return { policies, nameMap }
    } catch (err) {
      return { error: err.message }
    }
  })

  // App: save PDF
  ipcMain.handle('app:savePDF', async (_, orgName, policiesData, nameMap = {}) => {
    const sanitised = (orgName || 'report')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80)
    const timestamp = new Date().toISOString().slice(0, 10)
    const defaultFilename = `SecurityReport_${sanitised}_${timestamp}.pdf`

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Save Security Report',
      defaultPath: path.join(app.getPath('documents'), defaultFilename),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { cancelled: true }

    const policies = Array.isArray(policiesData) ? policiesData : []
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const html = generateReportHtml(orgName, policies, date, nameMap || {})
    const tmpPath = path.join(app.getPath('temp'), `_affinity_report_${Date.now()}.html`)
    const printWin = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    try {
      fs.writeFileSync(tmpPath, html, 'utf-8')
      await printWin.loadFile(tmpPath)
      const buffer = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'printableArea' },
      })
      fs.writeFileSync(filePath, buffer)
      return { path: filePath }
    } catch (err) {
      return { error: err.message }
    } finally {
      printWin.destroy()
      try { fs.unlinkSync(tmpPath) } catch {}
    }
  })

}

module.exports = { registerIpcHandlers }
