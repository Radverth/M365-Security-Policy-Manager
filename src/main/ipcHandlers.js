const { ipcMain, app, shell, dialog, BrowserWindow } = require('electron')
const { checkPowerShell, runScript } = require('./powershell')
const { getModuleStatus, installModules, updateModules, unknownModuleStatus } = require('./moduleManager')
const itGlue = require('./itGlue')
const { buildScript, buildConnectGraph, buildPoliciesScript, needsExo, needsIpps } = require('./policyBuilder')
const store = require('./store')
const logger = require('./logger')
const path = require('path')
const { execFile } = require('child_process')
const fs = require('fs')
const psSession = require('./psSession')
const HTMLtoDOCX = require('html-to-docx')



function recSection(recommendations, esc, date) {
  const SEV = {
    critical: { bg: '#fef2f2', text: '#dc2626' },
    high:     { bg: '#fff7ed', text: '#ea580c' },
    medium:   { bg: '#fffbeb', text: '#ca8a04' },
    low:      { bg: '#f0fdf4', text: '#16a34a' },
    info:     { bg: '#f0f9ff', text: '#0369a1' },
  }

  const cards = recommendations.map(r => {
    const pct = r.totalCaCount > 0 ? Math.round((r.presentCount / r.totalCaCount) * 100) : 100
    const pctColor = pct === 100 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626'

    const missingRows = r.missingItems.map(item => {
      const sc = SEV[item.severity] || SEV.info
      return `<tr>
        <td style="padding:5px 8px;font-size:10px;font-family:'Courier New',monospace;color:#9ca3af;border-bottom:1px solid #f9fafb;width:56px">${esc(item.id)}</td>
        <td style="padding:5px 8px;font-size:11px;color:#374151;border-bottom:1px solid #f9fafb">${esc(item.name)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f9fafb;white-space:nowrap;width:70px">
          <span style="-webkit-print-color-adjust:exact;print-color-adjust:exact;display:inline-block;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;background:${sc.bg};color:${sc.text}">${esc(item.severity)}</span>
        </td>
      </tr>`
    }).join('')

    const body = r.missingItems.length === 0
      ? `<div style="display:flex;align-items:center;gap:6px;color:#16a34a;font-size:11px;font-weight:600">
           <span style="font-size:14px">✓</span> All baseline CA policies detected on this tenant
         </div>`
      : `<table style="width:100%;border-collapse:collapse;margin-top:10px">
           <thead>
             <tr style="-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#f9fafb">
               <th style="padding:5px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;border-bottom:1px solid #f3f4f6">ID</th>
               <th style="padding:5px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;border-bottom:1px solid #f3f4f6">Recommended Policy</th>
               <th style="padding:5px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;border-bottom:1px solid #f3f4f6">Severity</th>
             </tr>
           </thead>
           <tbody>${missingRows}</tbody>
         </table>
         ${r.unverifiableCount > 0 ? `<p style="margin-top:8px;font-size:10px;color:#9ca3af">+ ${r.unverifiableCount} Identity Protection ${r.unverifiableCount === 1 ? 'policy' : 'policies'} — requires separate Entra ID Identity Protection review.</p>` : ''}`

    return `<div style="margin-bottom:16px;page-break-inside:avoid;border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:14px 18px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px">
        <div>
          <div style="font-size:13px;font-weight:700;color:#111827">${esc(r.name)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:3px">${esc(r.description || '')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:26px;font-weight:700;line-height:1;color:${pctColor}">${pct}%</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:2px">${r.presentCount}/${r.totalCaCount} CA policies found</div>
        </div>
      </div>
      ${body}
    </div>`
  }).join('')

  return `<div class="break">
  <div style="margin-bottom:20px;display:flex;align-items:baseline;justify-content:space-between">
    <div>
      <div style="font-size:16px;font-weight:700;color:#1a2d4a">Baseline Coverage &amp; Recommendations</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:3px">Comparing tenant policies against Microsoft recommended security baselines &mdash; ${esc(date)}</div>
    </div>
  </div>
  <div style="border:1px solid #fde68a;border-radius:8px;padding:12px 16px;background:#fffbeb;margin-bottom:20px">
    <p style="font-size:11px;color:#92400e;margin:0"><strong>Note:</strong> Policies are matched by ID in the display name (e.g. "CA001: Require MFA") or by their configuration intent — so any policy with the right settings is detected regardless of its name. Identity Protection policies (IP*) cannot be verified from Conditional Access data and are excluded from coverage percentages.</p>
  </div>
  ${cards}
  <div style="margin-top:18px;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
    <p style="font-size:10px;color:#9ca3af">Generated by M365 Security Policy Manager &middot; Affinity IT &middot; ${esc(date)} &middot; Confidential</p>
  </div>
</div>`
}

function generateReportHtml(orgName, policies, date, nameMap = {}, recommendations = []) {
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
    <p style="font-size:10px;color:#9ca3af">Generated by M365 Security Policy Manager &middot; Affinity IT &middot; ${esc(date)} &middot; Confidential</p>
  </div>
</div>

${recommendations.length > 0 ? recSection(recommendations, esc, date) : ''}

</body>
</html>`
}

function generateDocxHtml(orgName, policies, date, nameMap = {}, recommendations = [], amName = null, amEmail = null) {
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
  const pv = (obj, ...keys) => { for (const k of keys) { if (obj?.[k] != null) return obj[k] } return null }
  const stateOf = p => p.State || p.state || 'unknown'
  const stateLabel = s => ({ enabled: 'Enabled', disabled: 'Disabled', enabledForReportingButNotEnforced: 'Report Only' }[s] || 'Unknown')

  // Try PNG first (better html-to-docx support), fall back to JPEG, then text.
  // Image must be in a <p> tag — html-to-docx only processes images in paragraph context.
  let coverImgHtml
  const _tryImg = (imgPath, mime, defaultH, defaultW) => {
    const data = fs.readFileSync(imgPath)
    const b64  = data.toString('base64')
    let h = defaultH, w = defaultW
    if (mime === 'image/jpeg') {
      for (let i = 0; i < data.length - 8;) {
        if (data[i] === 0xFF) {
          const m = data[i + 1]
          if (m >= 0xC0 && m <= 0xC3) { h = (data[i + 5] << 8) | data[i + 6]; w = (data[i + 7] << 8) | data[i + 8]; break }
          if (m === 0xD8 || m === 0xD9) { i += 2; continue }
          i += 2 + ((data[i + 2] << 8) | data[i + 3])
        } else i++
      }
    } else if (mime === 'image/png') {
      w = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]
      h = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]
    }
    const scaledH = w > 0 ? Math.round(648 * h / w) : defaultH
    return `<p style="margin:0;padding:0"><img src="data:${mime};base64,${b64}" width="648" height="${scaledH}" /></p>`
  }
  const _imgBase = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..')
  try {
    coverImgHtml = _tryImg(path.join(_imgBase, 'assets/affinity-header.png'), 'image/png', 280, 1296)
  } catch {
    try {
      coverImgHtml = _tryImg(path.join(_imgBase, 'assets/affinity_it_services_ltd_cover.jpeg'), 'image/jpeg', 397, 1585)
    } catch {
      coverImgHtml = `<p style="font-size:38pt;font-weight:200;color:#1a2d4a;border-top:6px solid #E8A830;padding-top:12px;margin-bottom:4px">Affinity IT</p><p style="font-size:11pt;color:#E8A830;margin-bottom:16px">Technology. Together.</p>`
    }
  }

  // ── Policy descriptions for the gap analysis section ────────────────────────
  const POLICY_DESC = {
    CA001: 'Requires all users to complete MFA on every sign-in, protecting against compromised passwords — the single most impactful control available.',
    CA002: 'Blocks legacy authentication protocols (Exchange ActiveSync, SMTP AUTH) which cannot enforce MFA and account for the majority of password-spray attacks.',
    CA003: 'Enforces MFA for privileged roles (Global Admin, Security Admin, Helpdesk Admin, etc.), protecting your highest-value accounts.',
    CA004: 'Restricts access to devices enrolled in Intune and marked compliant, or hybrid Azure AD joined — ensuring only managed devices reach corporate data.',
    CA006: 'Requires MFA before accessing Microsoft Azure management interfaces, protecting critical cloud infrastructure and subscriptions.',
    CA008: 'Forces a password reset when a user\'s risk is detected as High (e.g. leaked credentials), blocking persistent attacker access.',
    CA009: 'Requires step-up MFA when a sign-in is flagged as medium or high risk (unusual location, anonymous IP, impossible travel).',
    CA011: 'Restricts iOS device access to Intune-approved apps with app protection policies, safeguarding corporate data on personal (BYOD) devices.',
    CA012: 'Restricts Android device access to Intune-approved apps with app protection policies, safeguarding corporate data on personal (BYOD) devices.',
    CA014: 'Requires MFA for guest and external users accessing shared resources, preventing unauthorised access from outside the organisation.',
    CA016: 'Prevents persistent browser sessions, requiring re-authentication when the browser is closed to limit session hijacking exposure.',
    CA018: 'Blocks sign-ins from unmanaged or unsupported device platforms that cannot receive security patches.',
    CA019: 'Secures MFA method registration through Conditional Access, preventing attackers from enrolling their own authentication methods after a password compromise.',
    CA026: 'Requires phishing-resistant MFA (FIDO2 / Windows Hello for Business) for admin accounts — resistant to adversary-in-the-middle attacks.',
    CA030: 'Enables app-enforced restrictions in SharePoint and Exchange for unmanaged devices, preventing download and printing of sensitive documents.',
    CA033: 'Requires MFA for all Microsoft 365 admin portals (Entra, Exchange, Teams, Intune), protecting the administrative control plane.',
    CA045: 'Limits admin sessions to one hour with mandatory re-authentication, reducing the window of exposure from a stolen admin token.',
    IP001: 'Automatically enforces MFA for users whose account risk is High in Entra ID Identity Protection (requires Entra ID P2 licence).',
    IP002: 'Enforces MFA for sign-ins detected as risky by Identity Protection — unusual location, anonymous IP, malware-linked IP (requires Entra ID P2).',
    IP003: 'Forces a password change for users with High risk (leaked credentials detected) before granting access (requires Entra ID P2).',
  }

  const CTRL_LABELS = {
    mfa: 'Require MFA', compliantDevice: 'Require Compliant Device', domainJoinedDevice: 'Require Hybrid AD Join',
    approvedApplication: 'Require Approved App', compliantApplication: 'Require App Protection Policy',
    block: 'Block Access', passwordChange: 'Require Password Change',
  }

  function fmtUsers(u) {
    if (!u) return null
    const incU = pv(u, 'IncludeUsers', 'includeUsers') || []
    const incR = pv(u, 'IncludeRoles', 'includeRoles') || []
    const incG = pv(u, 'IncludeGroups', 'includeGroups') || []
    if (incU.some(x => x.toLowerCase() === 'all')) return 'All Users'
    if (incU.some(x => x.toLowerCase() === 'guestsorexternalusers')) return 'Guests & External Users'
    const parts = [
      ...(incR.length ? [`${incR.length} admin role(s)`] : []),
      ...(incG.length ? [`${incG.length} group(s)`] : []),
      ...(incU.length ? [`${incU.length} user(s)`] : []),
    ]
    return parts.join(', ') || null
  }

  function fmtGrant(g) {
    if (!g) return null
    const controls = (pv(g, 'BuiltInControls', 'builtInControls') || []).map(c => CTRL_LABELS[c] || c)
    if (pv(g, 'AuthenticationStrength', 'authenticationStrength')) controls.push('Phishing-Resistant MFA')
    const op = (pv(g, 'Operator', 'operator') || 'OR').toUpperCase()
    return controls.join(` ${op} `) || null
  }

  // ── Data ────────────────────────────────────────────────────────────────────
  const enabled    = policies.filter(p => stateOf(p) === 'enabled')
  const reportOnly = policies.filter(p => stateOf(p) === 'enabledForReportingButNotEnforced')
  const disabled   = policies.filter(p => stateOf(p) === 'disabled')

  const STATE_COLOR = {
    enabled:                           { fg: '#15803d', bg: '#dcfce7' },
    enabledForReportingButNotEnforced: { fg: '#b45309', bg: '#fef3c7' },
    disabled:                          { fg: '#6b7280', bg: '#f3f4f6' },
  }
  const SEV_COLOR = { critical: '#991b1b', high: '#92400e', medium: '#78350f', low: '#14532d', info: '#1e3a8a' }
  const SEV_BG    = { critical: '#fecaca', high: '#fde68a', medium: '#fef9c3', low: '#bbf7d0', info: '#bfdbfe' }
  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

  // ── Policy inventory table rows ─────────────────────────────────────────────
  const inventoryRows = policies.map((p, i) => {
    const state  = stateOf(p)
    const sc     = STATE_COLOR[state] || STATE_COLOR.disabled
    const bg     = i % 2 === 0 ? '#ffffff' : '#f8fafc'
    return `<tr style="background:${bg}">
      <td style="padding:7px 12px;font-size:10pt;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb">${esc(pv(p, 'DisplayName', 'displayName') || '')}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap">
        <span style="background:${sc.bg};color:${sc.fg};padding:2px 8px;font-size:9pt;font-weight:700">${stateLabel(state)}</span>
      </td>
      <td style="padding:7px 12px;font-size:10pt;color:#374151;border-bottom:1px solid #e5e7eb">${esc(fmtUsers(pv(pv(p, 'Conditions', 'conditions'), 'Users', 'users')) || '—')}</td>
      <td style="padding:7px 12px;font-size:10pt;color:#374151;border-bottom:1px solid #e5e7eb">${esc(fmtGrant(pv(p, 'GrantControls', 'grantControls')) || '—')}</td>
    </tr>`
  }).join('')

  // ── Baseline compliance summary rows ────────────────────────────────────────
  const baselineSummaryRows = recommendations.map((r, i) => {
    const pct      = r.totalCaCount > 0 ? Math.round((r.presentCount / r.totalCaCount) * 100) : 100
    const pctColor = pct === 100 ? '#15803d' : pct >= 70 ? '#b45309' : '#dc2626'
    const bg       = i % 2 === 0 ? '#ffffff' : '#f8fafc'
    const status   = r.missingItems.length === 0
      ? `<span style="color:#15803d;font-weight:700">&#10003; Compliant</span>`
      : `<span style="color:#dc2626;font-weight:700">${r.missingItems.length} gap${r.missingItems.length > 1 ? 's' : ''} identified</span>`
    return `<tr style="background:${bg}">
      <td style="padding:8px 12px;font-size:10pt;font-weight:700;color:#111827;border-bottom:1px solid #e5e7eb">${esc(r.name)}</td>
      <td style="padding:8px 12px;font-size:16pt;font-weight:700;color:${pctColor};border-bottom:1px solid #e5e7eb;text-align:center">${pct}%</td>
      <td style="padding:8px 12px;font-size:10pt;color:#374151;border-bottom:1px solid #e5e7eb;text-align:center">${r.presentCount} / ${r.totalCaCount}</td>
      <td style="padding:8px 12px;font-size:10pt;border-bottom:1px solid #e5e7eb">${status}</td>
    </tr>`
  }).join('')

  // ── Per-baseline gap detail sections ────────────────────────────────────────
  const gapSections = recommendations.filter(r => r.missingItems.length > 0).map(r => {
    const pct      = r.totalCaCount > 0 ? Math.round((r.presentCount / r.totalCaCount) * 100) : 100
    const pctColor = pct >= 70 ? '#b45309' : '#dc2626'
    const sortedMissing = [...r.missingItems].sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5))
    const rows = sortedMissing.map((item, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
      return `<tr style="background:${bg}">
        <td style="padding:7px 10px;font-family:'Courier New',monospace;font-size:9pt;color:#6b7280;white-space:nowrap;border-bottom:1px solid #e5e7eb">${esc(item.id)}</td>
        <td style="padding:7px 10px;font-size:10pt;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb">${esc(item.name)}</td>
        <td style="padding:7px 10px;white-space:nowrap;border-bottom:1px solid #e5e7eb">
          <span style="background:${SEV_BG[item.severity]||'#f3f4f6'};color:${SEV_COLOR[item.severity]||'#6b7280'};padding:2px 8px;font-size:9pt;font-weight:700">${item.severity.charAt(0).toUpperCase()+item.severity.slice(1)}</span>
        </td>
        <td style="padding:7px 10px;font-size:9pt;color:#6b7280;border-bottom:1px solid #e5e7eb">${esc(POLICY_DESC[item.id] || '')}</td>
      </tr>`
    }).join('')
    return `<h3>${esc(r.name)} — ${pct}% compliant</h3>
<p style="font-size:10pt;color:#6b7280;margin-bottom:8px">${esc(r.description || '')}</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:12px">
  <thead>
    <tr>
      <th style="background:#1a2d4a;color:#ffffff;padding:7px 10px;text-align:left;font-size:9pt;font-weight:700">Policy ID</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:7px 10px;text-align:left;font-size:9pt;font-weight:700">Recommended Policy</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:7px 10px;text-align:left;font-size:9pt;font-weight:700">Priority</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:7px 10px;text-align:left;font-size:9pt;font-weight:700">What it protects against</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
${r.unverifiableCount > 0 ? `<p style="font-size:9pt;color:#9ca3af;font-style:italic;margin-bottom:16px">${r.unverifiableCount} Identity Protection ${r.unverifiableCount === 1 ? 'policy' : 'policies'} in this baseline require a separate Entra ID Identity Protection review and an Entra ID P2 licence.</p>` : ''}`
  }).join('')

  // ── Consolidated action plan (all unique missing items, sorted by severity) ──
  const seen = new Set()
  const allMissing = []
  for (const r of recommendations) {
    for (const item of r.missingItems) {
      if (!seen.has(item.id)) { seen.add(item.id); allMissing.push(item) }
    }
  }
  allMissing.sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5))

  const actionRows = allMissing.map((item, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
    return `<tr style="background:${bg}">
      <td style="padding:7px 12px;font-size:10pt;font-weight:700;color:#1a2d4a;text-align:center;border-bottom:1px solid #e5e7eb">${i + 1}</td>
      <td style="padding:7px 12px;font-family:'Courier New',monospace;font-size:9pt;color:#6b7280;white-space:nowrap;border-bottom:1px solid #e5e7eb">${esc(item.id)}</td>
      <td style="padding:7px 12px;font-size:10pt;font-weight:600;color:#111827;border-bottom:1px solid #e5e7eb">${esc(item.name)}</td>
      <td style="padding:7px 12px;white-space:nowrap;border-bottom:1px solid #e5e7eb">
        <span style="background:${SEV_BG[item.severity]||'#f3f4f6'};color:${SEV_COLOR[item.severity]||'#6b7280'};padding:2px 8px;font-size:9pt;font-weight:700">${item.severity.charAt(0).toUpperCase()+item.severity.slice(1)}</span>
      </td>
    </tr>`
  }).join('')

  // ── HTML ────────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; }
body { font-family: 'Calibri', 'Segoe UI', sans-serif; font-size: 11pt; color: #1f2937; line-height: 1.6; background: #ffffff; }
h2 { font-size: 14pt; font-weight: 700; color: #1a2d4a; margin: 24px 0 10px 0; padding-bottom: 6px; border-bottom: 3px solid #E8A830; }
h3 { font-size: 12pt; font-weight: 700; color: #d97706; margin: 20px 0 6px 0; }
table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
th { padding: 8px 12px; text-align: left; font-size: 10pt; font-weight: 700; }
td { padding: 7px 12px; }
p { margin: 0 0 8px 0; }
strong { color: #1a2d4a; }
</style>
</head>
<body>

<!-- ═══ COVER ════════════════════════════════════════════════════════════════ -->
${coverImgHtml}
<p style="font-size:28pt;font-weight:900;color:#1a2d4a;line-height:1.1;margin-top:40px;margin-bottom:0">MICROSOFT 365</p>
<p style="font-size:28pt;font-weight:900;color:#1a2d4a;line-height:1.1;margin-top:4px;margin-bottom:20px">SECURITY POLICY REPORT</p>
<p style="font-size:1pt;border-bottom:3px solid #E8A830;margin:0 0 20px 0;line-height:0.5">&nbsp;</p>
<p style="font-size:20pt;font-weight:700;color:#1a2d4a;margin-bottom:4px">${esc(orgName || 'Tenant')}</p>
<p style="font-size:11pt;color:#6b7280;margin-bottom:40px">${esc(date)}</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:0">
  <tr>
    <td style="border-left:4px solid #E8A830;padding:14px 18px;font-size:10pt;color:#374151">
      <strong>Confidential</strong> — Prepared by Affinity IT for <strong>${esc(orgName || 'your organisation')}</strong>.
      This report provides a full analysis of your Microsoft 365 Conditional Access security configuration, identifies gaps against
      Microsoft&rsquo;s recommended security baselines, and sets out a prioritised action plan.
    </td>
  </tr>
</table>

<!-- ═══ EXECUTIVE SUMMARY ═══════════════════════════════════════════════════ -->
<h2 style="page-break-before:always">Executive Summary</h2>
<p>This report documents the Conditional Access policy configuration for <strong>${esc(orgName || 'your organisation')}</strong>
as of <strong>${esc(date)}</strong>. Conditional Access is the enforcement layer in Microsoft Entra ID that controls who can
access cloud applications, from which devices and locations, and under what conditions.</p>
<p>The assessment reviewed <strong>${policies.length} Conditional Access ${policies.length === 1 ? 'policy' : 'policies'}</strong>
and compared the configuration against Microsoft&rsquo;s recommended security baselines. The table below summarises the current posture.</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <thead>
    <tr>
      <th style="background:#1a2d4a;color:#ffffff;padding:10px 16px;text-align:center">Total Policies</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:10px 16px;text-align:center">Active (Enforced)</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:10px 16px;text-align:center">Audit Mode Only</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:10px 16px;text-align:center">Disabled</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:14px 16px;font-size:22pt;font-weight:700;color:#1a2d4a;text-align:center;border-bottom:1px solid #e5e7eb">${policies.length}</td>
      <td style="padding:14px 16px;font-size:22pt;font-weight:700;color:#15803d;text-align:center;border-bottom:1px solid #e5e7eb">${enabled.length}</td>
      <td style="padding:14px 16px;font-size:22pt;font-weight:700;color:#b45309;text-align:center;border-bottom:1px solid #e5e7eb">${reportOnly.length}</td>
      <td style="padding:14px 16px;font-size:22pt;font-weight:700;color:#9ca3af;text-align:center;border-bottom:1px solid #e5e7eb">${disabled.length}</td>
    </tr>
  </tbody>
</table>

${recommendations.length > 0 ? `
<!-- ═══ BASELINE COMPLIANCE ══════════════════════════════════════════════════ -->
<h2>Baseline Compliance Overview</h2>
<p>The table below shows how the current Conditional Access configuration compares against Microsoft&rsquo;s recommended security baselines.
Each baseline represents a curated set of policies addressing a specific security scenario.</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <thead>
    <tr>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Baseline</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px;text-align:center">Score</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px;text-align:center">Policies Detected</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Finding</th>
    </tr>
  </thead>
  <tbody>${baselineSummaryRows}</tbody>
</table>

<!-- ═══ GAP ANALYSIS ═════════════════════════════════════════════════════════ -->
<h2 style="page-break-before:always">Gap Analysis &amp; Recommendations</h2>
<p>The following section details each missing policy, its business risk, and the specific protection it provides. These findings form the
basis of the recommended action plan. Policies are matched by ID in their display name <em>or</em> by their configuration, so
any existing policy with the correct settings is detected regardless of its name.</p>

${gapSections || '<p style="color:#15803d;font-weight:700">&#10003; No gaps identified — all selected baseline policies are present.</p>'}

${allMissing.length > 0 ? `
<!-- ═══ ACTION PLAN ══════════════════════════════════════════════════════════ -->
<h2 style="page-break-before:always">Recommended Action Plan</h2>
<p>The table below consolidates all recommended policies across the selected baselines, ordered by priority. Affinity IT
can assist with the design, testing (Report Only mode), and phased enforcement of these policies in your environment.</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <thead>
    <tr>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px;text-align:center">#</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Policy ID</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Policy to Implement</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Priority</th>
    </tr>
  </thead>
  <tbody>${actionRows}</tbody>
</table>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr>
    <td style="padding:14px 18px;border-left:4px solid #E8A830;font-size:10pt;color:#374151">
      <strong style="color:#1a2d4a">Next steps:</strong> Affinity IT recommends deploying new policies in <em>Report Only</em> mode first to assess
      impact before switching to enforcement. This approach avoids accidental lockouts and provides a clear baseline for review.
      ${amName && amEmail
        ? `Contact <strong>${esc(amName)}</strong> at <a href="mailto:${esc(amEmail)}" style="color:#1a2d4a">${esc(amEmail)}</a> to discuss a phased implementation programme.`
        : 'Contact your Affinity account manager to discuss a phased implementation programme.'
      }
    </td>
  </tr>
</table>
` : ''}
` : ''}

<!-- ═══ POLICY INVENTORY ══════════════════════════════════════════════════════ -->
<h2 style="page-break-before:always">Conditional Access Policy Inventory</h2>
<p>The following table lists all ${policies.length} Conditional Access ${policies.length === 1 ? 'policy' : 'policies'} currently configured in your tenant.</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:24px">
  <thead>
    <tr>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Policy Name</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Status</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Applies To</th>
      <th style="background:#1a2d4a;color:#ffffff;padding:8px 12px">Grant Controls</th>
    </tr>
  </thead>
  <tbody>${inventoryRows}</tbody>
</table>

</body>
</html>`
}

async function generateDocxBuffer(orgName, policies, date, nameMap = {}, recommendations = [], amName = null, amEmail = null) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
    ShadingType, VerticalAlign, PageBreak, LevelFormat,
    TabStopType, SimpleField, ImageRun
  } = require('docx')

  const NAVY = '1B2A4A', MID = '2E5196', ACCENT = '4A90D9', LIGHT = 'EBF2FB'
  const CREAM = 'F7F9FC', RED = 'C0392B', AMBER = 'D68910', WHITE = 'FFFFFF'
  const BORDER = 'C8D8EC', GOLD = 'E8A020'

  const cellBorder = (color = BORDER) => ({ style: BorderStyle.SINGLE, size: 1, color })
  const allBorders = (color = BORDER) => ({
    top: cellBorder(color), bottom: cellBorder(color),
    left: cellBorder(color), right: cellBorder(color)
  })
  const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE }

  function hRule() {
    return new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 1 } },
      children: []
    })
  }

  function spacer(pts = 120) {
    return new Paragraph({ spacing: { before: 0, after: pts }, children: [] })
  }

  function priorityBadge(text) {
    const color = text === 'Critical' ? RED : AMBER
    return new TextRun({
      text: ` ${text} `, font: 'Arial', size: 16, bold: true, color: WHITE,
      shading: { fill: color, type: ShadingType.CLEAR }
    })
  }

  function sectionHeading(text) {
    return [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: 'Arial', size: 36, bold: true, color: NAVY })] }),
      hRule(),
      spacer(80)
    ]
  }

  function subHeading(text) {
    return [
      spacer(80),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: 'Arial', size: 26, bold: true, color: MID })] }),
      spacer(40)
    ]
  }

  function statBox(label, value, highlight = false) {
    return new TableCell({
      borders: allBorders(BORDER),
      shading: { fill: highlight ? MID : LIGHT, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 200, right: 200 },
      width: { size: 2460, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(value), font: 'Arial', size: 52, bold: true, color: highlight ? WHITE : NAVY })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, font: 'Arial', size: 18, color: highlight ? 'DDDDDD' : '555555' })] })
      ]
    })
  }

  function tableHeaderRow(labels, widths) {
    return new TableRow({
      tableHeader: true,
      children: labels.map((label, i) => new TableCell({
        borders: allBorders(MID),
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        width: { size: widths[i], type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true, color: WHITE })] })]
      }))
    })
  }

  function tableBodyRow(cells, widths, shadeAlt = false) {
    return new TableRow({
      children: cells.map((cell, i) => new TableCell({
        borders: allBorders(BORDER),
        shading: { fill: shadeAlt ? CREAM : WHITE, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        width: { size: widths[i], type: WidthType.DXA },
        children: [new Paragraph({
          children: Array.isArray(cell) ? cell : [new TextRun({ text: String(cell ?? ''), font: 'Arial', size: 20, color: '333333' })]
        })]
      }))
    })
  }

  const pv = (obj, ...keys) => { for (const k of keys) { if (obj?.[k] != null) return obj[k] } return null }
  const stateOf = p => p.State || p.state || 'unknown'
  const stateLabel = s => ({ enabled: 'Enabled', disabled: 'Disabled', enabledForReportingButNotEnforced: 'Report Only' }[s] || 'Unknown')
  const CTRL_LABELS = {
    mfa: 'Require MFA', compliantDevice: 'Require Compliant Device', domainJoinedDevice: 'Require Hybrid AD Join',
    approvedApplication: 'Require Approved App', compliantApplication: 'Require App Protection Policy',
    block: 'Block Access', passwordChange: 'Require Password Change'
  }
  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

  const POLICY_DESC = {
    CA001: 'Requires all users to complete MFA on every sign-in — the single most impactful control available.',
    CA002: 'Blocks legacy authentication protocols which cannot enforce MFA and account for most password-spray attacks.',
    CA003: 'Enforces MFA for privileged roles (Global Admin, Security Admin, Helpdesk Admin, etc.), protecting your highest-value accounts.',
    CA004: 'Restricts access to devices enrolled in Intune and marked compliant, or hybrid Azure AD joined.',
    CA006: 'Requires MFA before accessing Microsoft Azure management interfaces, protecting critical cloud infrastructure.',
    CA008: 'Forces a password reset when a user’s risk is detected as High (e.g. leaked credentials).',
    CA009: 'Requires step-up MFA when a sign-in is flagged as medium or high risk.',
    CA011: 'Restricts iOS device access to Intune-approved apps with app protection policies.',
    CA012: 'Restricts Android device access to Intune-approved apps with app protection policies.',
    CA014: 'Requires MFA for guest and external users accessing shared resources.',
    CA016: 'Prevents persistent browser sessions, requiring re-authentication when the browser is closed.',
    CA018: 'Blocks sign-ins from unmanaged or unsupported device platforms.',
    CA019: 'Secures MFA method registration through Conditional Access.',
    CA026: 'Requires phishing-resistant MFA (FIDO2 / Windows Hello for Business) for admin accounts.',
    CA030: 'Enables app-enforced restrictions in SharePoint and Exchange for unmanaged devices.',
    CA033: 'Requires MFA for all Microsoft 365 admin portals (Entra, Exchange, Teams, Intune).',
    CA045: 'Limits admin sessions to one hour with mandatory re-authentication.',
    IP001: 'Automatically enforces MFA for users whose account risk is High in Entra ID Identity Protection.',
    IP002: 'Enforces MFA for sign-ins detected as risky by Identity Protection.',
    IP003: 'Forces a password change for users with High risk (leaked credentials detected).',
  }

  function fmtUsers(u) {
    if (!u) return null
    const incU = pv(u, 'IncludeUsers', 'includeUsers') || []
    const incR = pv(u, 'IncludeRoles', 'includeRoles') || []
    const incG = pv(u, 'IncludeGroups', 'includeGroups') || []
    if (incU.some(x => x.toLowerCase() === 'all')) return 'All Users'
    if (incU.some(x => x.toLowerCase() === 'guestsorexternalusers')) return 'Guests & External Users'
    const parts = [
      ...(incR.length ? [`${incR.length} admin role(s)`] : []),
      ...(incG.length ? [`${incG.length} group(s)`] : []),
      ...(incU.length ? [`${incU.length} user(s)`] : [])
    ]
    return parts.join(', ') || null
  }

  function fmtGrant(g) {
    if (!g) return null
    const controls = (pv(g, 'BuiltInControls', 'builtInControls') || []).map(c => CTRL_LABELS[c] || c)
    if (pv(g, 'AuthenticationStrength', 'authenticationStrength')) controls.push('Phishing-Resistant MFA')
    return controls.join(` ${(pv(g, 'Operator', 'operator') || 'OR').toUpperCase()} `) || null
  }

  const enabled = policies.filter(p => stateOf(p) === 'enabled')
  const reportOnly = policies.filter(p => stateOf(p) === 'enabledForReportingButNotEnforced')
  const disabled = policies.filter(p => stateOf(p) === 'disabled')

  // Cover image
  const _imgBase = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../..')
  let coverImageParagraph
  try {
    const imgData = fs.readFileSync(path.join(_imgBase, 'assets/affinity-header.png'))
    const iw = (imgData[16] << 24) | (imgData[17] << 16) | (imgData[18] << 8) | imgData[19]
    const ih = (imgData[20] << 24) | (imgData[21] << 16) | (imgData[22] << 8) | imgData[23]
    const docW = 656, docH = iw > 0 ? Math.round(docW * ih / iw) : 164
    coverImageParagraph = new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [new ImageRun({ type: 'png', data: imgData, transformation: { width: docW, height: docH } })]
    })
  } catch {
    try {
      const imgData = fs.readFileSync(path.join(_imgBase, 'assets/affinity_it_services_ltd_cover.jpeg'))
      coverImageParagraph = new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [new ImageRun({ type: 'jpeg', data: imgData, transformation: { width: 656, height: 164 } })]
      })
    } catch {
      coverImageParagraph = new Paragraph({ children: [] })
    }
  }

  const coverPage = [
    coverImageParagraph,
    spacer(400),
    new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: 'MICROSOFT 365', font: 'Arial', size: 52, bold: true, color: MID })] }),
    new Paragraph({ spacing: { before: 0, after: 120 }, children: [new TextRun({ text: 'SECURITY POLICY REPORT', font: 'Arial', size: 52, bold: true, color: NAVY })] }),
    new Paragraph({ spacing: { before: 0, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 1 } }, children: [] }),
    spacer(240),
    new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: orgName || 'Tenant', font: 'Arial', size: 36, bold: true, color: NAVY })] }),
    new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: date, font: 'Arial', size: 24, color: '666666' })] }),
    spacer(240),
    new Table({
      width: { size: 9840, type: WidthType.DXA },
      columnWidths: [9840],
      rows: [new TableRow({ children: [new TableCell({
        borders: {
          top: { style: BorderStyle.SINGLE, size: 6, color: MID },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: MID },
          left: { style: BorderStyle.SINGLE, size: 24, color: GOLD },
          right: { style: BorderStyle.SINGLE, size: 6, color: MID }
        },
        shading: { fill: LIGHT, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 240, right: 240 },
        width: { size: 9840, type: WidthType.DXA },
        children: [new Paragraph({ children: [
          new TextRun({ text: 'Confidential', font: 'Arial', size: 20, bold: true, color: MID }),
          new TextRun({ text: '  —  Prepared by Affinity IT for ', font: 'Arial', size: 20, color: '444444' }),
          new TextRun({ text: orgName || 'your organisation', font: 'Arial', size: 20, bold: true, color: NAVY }),
          new TextRun({ text: '. This report provides a full analysis of your Microsoft 365 Conditional Access security configuration, identifies gaps against Microsoft’s recommended security baselines, and sets out a prioritised action plan.', font: 'Arial', size: 20, color: '444444' })
        ] })]
      })]})],
    }),
    new Paragraph({ children: [new PageBreak()] })
  ]

  const pageHeader = new Header({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9840 }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } },
      children: [
        new TextRun({ text: `${orgName || 'Security Report'}  ·  Microsoft 365 Security Report`, font: 'Arial', size: 18, color: '888888' }),
        new TextRun({ text: '\tConfidential', font: 'Arial', size: 18, color: '888888' })
      ]
    })]
  })

  const pageFooter = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9840 }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: ACCENT, space: 4 } },
      children: [
        new TextRun({ text: `Generated by M365 Security Policy Manager  ·  Affinity IT  ·  ${date}${amName ? `  ·  ${amName}` : ''}`, font: 'Arial', size: 16, color: '888888' }),
        new TextRun({ text: '\tPage ', font: 'Arial', size: 16, color: '888888' }),
        new SimpleField('PAGE')
      ]
    })]
  })

  const execSummary = [
    ...sectionHeading('Executive Summary'),
    new Paragraph({
      spacing: { before: 0, after: 160 },
      children: [
        new TextRun({ text: 'This report documents the Conditional Access policy configuration for ', font: 'Arial', size: 22, color: '333333' }),
        new TextRun({ text: orgName || 'your organisation', font: 'Arial', size: 22, bold: true, color: NAVY }),
        new TextRun({ text: ' as of ', font: 'Arial', size: 22, color: '333333' }),
        new TextRun({ text: date, font: 'Arial', size: 22, bold: true, color: NAVY }),
        new TextRun({ text: '. Conditional Access is the enforcement layer in Microsoft Entra ID that controls who can access cloud applications, from which devices and locations, and under what conditions.', font: 'Arial', size: 22, color: '333333' })
      ]
    }),
    new Paragraph({
      spacing: { before: 0, after: 240 },
      children: [
        new TextRun({ text: 'The assessment reviewed ', font: 'Arial', size: 22, color: '333333' }),
        new TextRun({ text: `${policies.length} Conditional Access ${policies.length === 1 ? 'policy' : 'policies'}`, font: 'Arial', size: 22, bold: true, color: MID }),
        new TextRun({ text: ' and compared the configuration against Microsoft’s recommended security baselines.', font: 'Arial', size: 22, color: '333333' })
      ]
    }),
    new Table({
      width: { size: 9840, type: WidthType.DXA },
      columnWidths: [2460, 2460, 2460, 2460],
      rows: [new TableRow({ children: [
        statBox('Total Policies', String(policies.length), true),
        statBox('Active (Enforced)', String(enabled.length)),
        statBox('Audit Mode Only', String(reportOnly.length)),
        statBox('Disabled', String(disabled.length))
      ]})]
    }),
    spacer(320)
  ]

  const baselineSection = recommendations.length > 0 ? [
    ...sectionHeading('Baseline Compliance Overview'),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: 'The table below shows how the current Conditional Access configuration compares against Microsoft’s recommended security baselines. Each baseline represents a curated set of policies addressing a specific security scenario.', font: 'Arial', size: 22, color: '333333' })]
    }),
    new Table({
      width: { size: 9840, type: WidthType.DXA },
      columnWidths: [2800, 1600, 2160, 3080],
      rows: [
        tableHeaderRow(['Baseline', 'Score', 'Policies Detected', 'Finding'], [2800, 1600, 2160, 3080]),
        ...recommendations.map((r, i) => {
          const pct = r.totalCaCount > 0 ? Math.round((r.presentCount / r.totalCaCount) * 100) : 100
          const finding = r.missingItems.length === 0 ? '✓ Compliant' : `${r.missingItems.length} gap${r.missingItems.length > 1 ? 's' : ''} identified`
          return tableBodyRow([r.name, `${pct}%`, `${r.presentCount} / ${r.totalCaCount}`, finding], [2800, 1600, 2160, 3080], i % 2 === 1)
        })
      ]
    }),
    spacer(320)
  ] : []

  const hasGaps = recommendations.some(r => r.missingItems.length > 0)

  const gapDetailRows = recommendations.filter(r => r.missingItems.length > 0).flatMap(r => {
    const pct = r.totalCaCount > 0 ? Math.round((r.presentCount / r.totalCaCount) * 100) : 100
    const sorted = [...r.missingItems].sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5))
    return [
      ...subHeading(`${r.name} — ${pct}% Compliant`),
      ...(r.description ? [new Paragraph({ spacing: { before: 0, after: 160 }, children: [new TextRun({ text: r.description, font: 'Arial', size: 22, color: '333333' })] })] : []),
      new Table({
        width: { size: 9840, type: WidthType.DXA },
        columnWidths: [1000, 2200, 1200, 5440],
        rows: [
          tableHeaderRow(['Policy ID', 'Recommended Policy', 'Priority', 'What it protects against'], [1000, 2200, 1200, 5440]),
          ...sorted.map((item, i) => tableBodyRow([
            item.id,
            item.name,
            [priorityBadge(item.severity.charAt(0).toUpperCase() + item.severity.slice(1))],
            POLICY_DESC[item.id] || ''
          ], [1000, 2200, 1200, 5440], i % 2 === 1))
        ]
      }),
      spacer(200)
    ]
  })

  const gapAnalysisSection = hasGaps ? [
    ...sectionHeading('Gap Analysis & Recommendations'),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: 'The following section details each missing policy, its business risk, and the specific protection it provides. Policies are matched by ID in their display name or by their configuration, so any existing policy with the correct settings is detected regardless of its name.', font: 'Arial', size: 22, color: '333333' })]
    }),
    ...gapDetailRows
  ] : []

  const seen = new Set()
  const allMissing = []
  for (const r of recommendations) {
    for (const item of r.missingItems) {
      if (!seen.has(item.id)) { seen.add(item.id); allMissing.push(item) }
    }
  }
  allMissing.sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5))

  const actionPlanSection = allMissing.length > 0 ? [
    ...sectionHeading('Recommended Action Plan'),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: 'The table below consolidates all recommended policies across the selected baselines, ordered by priority. Affinity IT can assist with the design, testing (Report Only mode), and phased enforcement of these policies in your environment.', font: 'Arial', size: 22, color: '333333' })]
    }),
    new Table({
      width: { size: 9840, type: WidthType.DXA },
      columnWidths: [600, 1200, 6000, 2040],
      rows: [
        tableHeaderRow(['#', 'Policy ID', 'Policy to Implement', 'Priority'], [600, 1200, 6000, 2040]),
        ...allMissing.map((item, i) => tableBodyRow([
          String(i + 1), item.id, item.name,
          [priorityBadge(item.severity.charAt(0).toUpperCase() + item.severity.slice(1))]
        ], [600, 1200, 6000, 2040], i % 2 === 1))
      ]
    }),
    spacer(240),
    new Table({
      width: { size: 9840, type: WidthType.DXA },
      columnWidths: [9840],
      rows: [new TableRow({ children: [new TableCell({
        borders: {
          top: { style: BorderStyle.SINGLE, size: 8, color: MID },
          bottom: { style: BorderStyle.SINGLE, size: 8, color: MID },
          left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT },
          right: cellBorder(BORDER)
        },
        shading: { fill: LIGHT, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 240, right: 240 },
        width: { size: 9840, type: WidthType.DXA },
        children: [
          new Paragraph({ spacing: { before: 0, after: 80 }, children: [new TextRun({ text: '→ Next steps', font: 'Arial', size: 22, bold: true, color: NAVY })] }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({ text: 'Affinity IT recommends deploying new policies in ', font: 'Arial', size: 22, color: '333333' }),
              new TextRun({ text: 'Report Only mode', font: 'Arial', size: 22, bold: true, color: MID }),
              new TextRun({ text: ' first to assess impact before switching to enforcement. This approach avoids accidental lockouts and provides a clear baseline for review.', font: 'Arial', size: 22, color: '333333' })
            ]
          }),
          new Paragraph({
            children: amName && amEmail ? [
              new TextRun({ text: 'Contact ', font: 'Arial', size: 22, color: '333333' }),
              new TextRun({ text: amName, font: 'Arial', size: 22, bold: true, color: NAVY }),
              new TextRun({ text: ' at ', font: 'Arial', size: 22, color: '333333' }),
              new TextRun({ text: amEmail, font: 'Arial', size: 22, color: MID }),
              new TextRun({ text: ' to discuss a phased implementation programme.', font: 'Arial', size: 22, color: '333333' })
            ] : [
              new TextRun({ text: 'Contact your Affinity account manager to discuss a phased implementation programme.', font: 'Arial', size: 22, color: '333333' })
            ]
          })
        ]
      })]})],
    }),
    spacer(320)
  ] : []

  const inventorySection = [
    ...sectionHeading('Conditional Access Policy Inventory'),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: `The following table lists all ${policies.length} Conditional Access ${policies.length === 1 ? 'policy' : 'policies'} currently configured in your tenant.`, font: 'Arial', size: 22, color: '333333' })]
    }),
    new Table({
      width: { size: 9840, type: WidthType.DXA },
      columnWidths: [3200, 1200, 1560, 3880],
      rows: [
        tableHeaderRow(['Policy Name', 'Status', 'Applies To', 'Grant Controls'], [3200, 1200, 1560, 3880]),
        ...policies.map((p, i) => tableBodyRow([
          pv(p, 'DisplayName', 'displayName') || '',
          stateLabel(stateOf(p)),
          fmtUsers(pv(pv(p, 'Conditions', 'conditions'), 'Users', 'users')) || '—',
          fmtGrant(pv(p, 'GrantControls', 'grantControls')) || '—'
        ], [3200, 1200, 1560, 3880], i % 2 === 1))
      ]
    }),
    spacer(320)
  ]

  const children = [
    ...coverPage,
    ...execSummary,
    ...baselineSection,
    ...gapAnalysisSection,
    ...actionPlanSection,
    ...inventorySection
  ]

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'action-list',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }]
    },
    styles: {
      default: { document: { run: { font: 'Arial', size: 22, color: '2C2C2C' } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 36, bold: true, font: 'Arial', color: NAVY }, paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: 'Arial', color: MID }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } },
      headers: { default: pageHeader },
      footers: { default: pageFooter },
      children
    }]
  })

  return Packer.toBuffer(doc)
}

let _win = null
let _handlersRegistered = false

// Strip read-only Graph fields and normalize PascalCase → camelCase for POST restore.
// Empty arrays are dropped — Graph rejects them in CA policy POST bodies.
// @odata.type from AdditionalProperties is preserved (needed for polymorphic types).
function cleanPolicyForRestore(policy) {
  const TOP_STRIP = new Set(['id', 'Id', 'createdDateTime', 'CreatedDateTime', 'modifiedDateTime', 'ModifiedDateTime', 'templateId', 'TemplateId'])
  const META_STRIP = new Set(['AdditionalProperties', 'BackingStore'])
  function clean(v, topLevel) {
    if (Array.isArray(v)) {
      const cleaned = v.map(item => clean(item, false)).filter(item => item !== null && item !== undefined)
      return cleaned.length > 0 ? cleaned : null  // null causes parent to drop the key
    }
    if (v && typeof v === 'object') {
      // Preserve @odata.type (polymorphic hints) but drop response-only OData keys
      const extra = {}
      if (v.AdditionalProperties && typeof v.AdditionalProperties === 'object') {
        for (const [k, val] of Object.entries(v.AdditionalProperties)) {
          if (k !== '@odata.context' && k !== '@odata.nextLink' && k !== '@odata.count') {
            extra[k] = val
          }
        }
      }
      const result = {}
      for (const [k, val] of Object.entries(v)) {
        if (META_STRIP.has(k) || k.startsWith('@')) continue
        if (topLevel && TOP_STRIP.has(k)) continue
        const cleanKey = k.charAt(0).toLowerCase() + k.slice(1)
        const cleanVal = clean(val, false)
        if (cleanVal !== null && cleanVal !== undefined) result[cleanKey] = cleanVal
      }
      const merged = { ...result, ...extra }
      return Object.keys(merged).length > 0 ? merged : null
    }
    return v
  }
  return clean(policy, true)
}

function registerIpcHandlers(win) {
  _win = win

  if (_handlersRegistered) return
  _handlersRegistered = true

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
      return await getModuleStatus()
    } catch (err) {
      logger.error(`modules:getStatus failed: ${err.message}`)
      return unknownModuleStatus()
    }
  })

  // The install/update scripts can outlive the window — guard sends
  const safeSend = (channel, line) => {
    if (_win && !_win.isDestroyed()) _win.webContents.send(channel, line)
  }

  // Module install
  ipcMain.handle('modules:install', async (_, moduleNames) => {
    logger.info(`IPC: modules:install [${moduleNames.join(', ')}]`)
    const logs = []
    const { exitCode } = await installModules(
      moduleNames,
      (line) => {
        logs.push(line)
        safeSend('ps:output', line)
      },
      (line) => {
        logs.push(`ERROR: ${line}`)
        safeSend('ps:error', line)
      }
    )
    if (exitCode !== 0) logs.push(`ERROR: PowerShell exited with code ${exitCode}`)
    return logs
  })

  // Module update
  ipcMain.handle('modules:update', async (_, moduleNames) => {
    logger.info(`IPC: modules:update [${moduleNames.join(', ')}]`)
    const logs = []
    const { exitCode } = await updateModules(
      moduleNames,
      (line) => {
        logs.push(line)
        safeSend('ps:output', line)
      },
      (line) => {
        logs.push(`ERROR: ${line}`)
        safeSend('ps:error', line)
      }
    )
    if (exitCode !== 0) logs.push(`ERROR: PowerShell exited with code ${exitCode}`)
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
          if (line.trim()) _win.webContents.send('ps:output', line)
        })
      })
      proc.stderr.on('data', (d) => {
        d.toString().split('\n').forEach(line => {
          if (line.trim()) _win.webContents.send('ps:error', line)
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
      if (!psSession.alive) await psSession.start(_win)
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
      _win.webContents.send('ps:output', 'CONNECTED: Using active tenant session — deploying policies...')
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
      (line) => { _win.webContents.send('ps:output', line); parseResult(line) },
      (line) => _win.webContents.send('ps:error', line)
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
    logger.info(`policies:update id=${id} body=${JSON.stringify(patch)}`)
    const b64 = Buffer.from(JSON.stringify(patch)).toString('base64')
    const script = `
$ctx = Get-MgContext
$scopes = if ($ctx -and $ctx.Scopes) { @($ctx.Scopes) } else { @() }
if (-not ($scopes -contains 'Policy.ReadWrite.ConditionalAccess')) {
  Write-Output "ERROR_NO_SCOPE: Token lacks Policy.ReadWrite.ConditionalAccess. Disconnect and reconnect to re-authenticate."
} else {
  try {
    $pol = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}?\`$select=id,templateId,displayName" -ErrorAction Stop
    if ($pol.templateId) {
      Write-Output "ERROR_READONLY: Policy '$($pol.displayName)' is Microsoft-managed (templateId: $($pol.templateId)) and cannot be modified through the API."
    } else {
      try {
        $body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))
        $patchResult = Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies/${safeId}" -Body $body -ContentType 'application/json'
        Write-Output "PATCH_JSON_START"
        if ($patchResult) { $patchResult | ConvertTo-Json -Depth 10 -Compress } else { Write-Output '{}' }
        Write-Output "PATCH_JSON_END"
        Write-Output "SUCCESS"
      } catch {
        $errMsg = $_.Exception.Message
        $detail = ''
        try {
          $edm = $_.ErrorDetails.Message
          if ($edm) {
            $parsed = $edm | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($parsed -and $parsed.error) { $detail = "$($parsed.error.code): $($parsed.error.message)" }
            else { $detail = $edm }
          }
        } catch {}
        if ($errMsg -match '403|Forbidden') {
          Write-Output "ERROR_403: $detail"
        } else {
          Write-Output "ERROR: $errMsg$(if ($detail) { ' | ' + $detail } else { '' })"
        }
      }
    }
  } catch {
    Write-Output "ERROR: $($_.Exception.Message)"
  }
}`
    const lines = []
    await psSession.run(script, l => lines.push(l), 120000)
    const noScope = lines.find(l => l.startsWith('ERROR_NO_SCOPE:'))
    if (noScope) throw new Error(noScope.slice('ERROR_NO_SCOPE:'.length).trim())
    const readOnly = lines.find(l => l.startsWith('ERROR_READONLY:'))
    if (readOnly) throw new Error(readOnly.slice('ERROR_READONLY:'.length).trim())
    const err403 = lines.find(l => l.startsWith('ERROR_403:'))
    if (err403) {
      const detail = err403.slice('ERROR_403:'.length).trim()
      throw new Error(`Access denied (403 Forbidden).${detail ? ` Graph error: ${detail}.` : ''} Try disconnecting and reconnecting to get a fresh token.`)
    }
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) throw new Error(errorLine.slice('ERROR:'.length).trim())

    // Parse the PATCH response body Graph returned
    const pStart = lines.indexOf('PATCH_JSON_START')
    const pEnd = lines.indexOf('PATCH_JSON_END')
    let updatedPolicy = null
    if (pStart !== -1 && pEnd > pStart) {
      try {
        const raw = lines.slice(pStart + 1, pEnd).join('')
        if (raw && raw !== '{}') {
          updatedPolicy = JSON.parse(raw)
          logger.info(`policies:update graph response keys: ${Object.keys(updatedPolicy).join(', ')}`)
        }
      } catch {}
    }
    return { success: lines.some(l => l.trim() === 'SUCCESS'), policy: updatedPolicy }
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

  // ── Backup / Restore ──────────────────────────────────────────────────────
  const getBackupDir = () => path.join(app.getPath('userData'), 'policy-backups')

  ipcMain.handle('backup:create', async (_, { policies: pols, tenantId, account, trigger }) => {
    try {
      const dir = getBackupDir()
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const ts = new Date().toISOString()
      const filename = `backup-${ts.replace(/[:.]/g, '-')}-${trigger}.json`
      const filepath = path.join(dir, filename)
      const data = {
        version: 1,
        timestamp: ts,
        tenantId: tenantId || 'unknown',
        account: account || 'unknown',
        trigger,
        policyCount: Array.isArray(pols) ? pols.length : 0,
        policies: Array.isArray(pols) ? pols : [],
      }
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8')
      logger.info(`backup:create trigger=${trigger} count=${data.policyCount} file=${filename}`)
      // Prune oldest backups, keep last 50
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
        if (files.length > 50) {
          files.slice(0, files.length - 50).forEach(f => {
            try { fs.unlinkSync(path.join(dir, f)) } catch {}
          })
        }
      } catch {}
      return { success: true, filename, timestamp: ts }
    } catch (err) {
      logger.error('backup:create error: ' + err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('backup:list', async () => {
    try {
      const dir = getBackupDir()
      if (!fs.existsSync(dir)) return { success: true, backups: [] }
      const backups = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            const { policies: _p, ...meta } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
            return { filename: f, ...meta }
          } catch { return null }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      return { success: true, backups }
    } catch (err) {
      return { success: false, error: err.message, backups: [] }
    }
  })

  ipcMain.handle('backup:get', async (_, filename) => {
    try {
      const filepath = path.join(getBackupDir(), path.basename(filename))
      const raw = fs.readFileSync(filepath, 'utf-8')
      return { success: true, data: JSON.parse(raw) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('backup:restore', async (_, policy) => {
    if (!psSession.alive) return { success: false, error: 'No active session — connect a tenant to restore policies' }
    try {
      const cleaned = cleanPolicyForRestore(policy)
      const b64 = Buffer.from(JSON.stringify(cleaned)).toString('base64')
      const script = `
$ctx = Get-MgContext
$scopes = if ($ctx -and $ctx.Scopes) { @($ctx.Scopes) } else { @() }
if (-not ($scopes -contains 'Policy.ReadWrite.ConditionalAccess')) {
  Write-Output "ERROR_NO_SCOPE: Token lacks Policy.ReadWrite.ConditionalAccess. Disconnect and reconnect to re-authenticate."
} else {
  try {
    $body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'))
    $result = Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" -Body $body -ContentType 'application/json' -ErrorAction Stop
    Write-Output "RESTORE_JSON_START"
    if ($result) { $result | ConvertTo-Json -Depth 10 -Compress } else { Write-Output '{}' }
    Write-Output "RESTORE_JSON_END"
    Write-Output "SUCCESS"
  } catch {
    $errMsg = $_.Exception.Message
    $detail = ''
    try {
      $edm = $_.ErrorDetails.Message
      if ($edm) {
        $parsed = $edm | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($parsed -and $parsed.error) { $detail = "$($parsed.error.code): $($parsed.error.message)" }
        else { $detail = $edm }
      }
    } catch {}
    if ($errMsg -match '403|Forbidden') {
      Write-Output "ERROR_403: $detail"
    } else {
      Write-Output "ERROR: $errMsg$(if ($detail) { ' | ' + $detail } else { '' })"
    }
  }
}`
      const lines = []
      await psSession.run(script, l => lines.push(l), 60000)
      const noScope = lines.find(l => l.startsWith('ERROR_NO_SCOPE:'))
      if (noScope) return { success: false, error: noScope.slice('ERROR_NO_SCOPE:'.length).trim() }
      const err403 = lines.find(l => l.startsWith('ERROR_403:'))
      if (err403) {
        const detail = err403.slice('ERROR_403:'.length).trim()
        return { success: false, error: `Access denied (403).${detail ? ` ${detail}.` : ''} Try disconnecting and reconnecting to get a fresh token.` }
      }
      const errorLine = lines.find(l => l.startsWith('ERROR:'))
      if (errorLine) return { success: false, error: errorLine.slice('ERROR:'.length).trim() }
      const rStart = lines.indexOf('RESTORE_JSON_START')
      const rEnd = lines.indexOf('RESTORE_JSON_END')
      let restoredPolicy = null
      if (rStart !== -1 && rEnd > rStart) {
        try { restoredPolicy = JSON.parse(lines.slice(rStart + 1, rEnd).join('')) } catch {}
      }
      return { success: lines.some(l => l.trim() === 'SUCCESS'), policy: restoredPolicy }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('backup:delete', async (_, filename) => {
    try {
      const filepath = path.join(getBackupDir(), path.basename(filename))
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('backup:openDir', async () => {
    const dir = getBackupDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
    return { success: true }
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
            _win.webContents.send('ps:output', line)
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

      // Fetch tenant display name
      let tenantName = null
      try {
        const orgLines = []
        await psSession.run(
          `try {
  $org = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/organization?\`$select=displayName" -ErrorAction SilentlyContinue
  if ($org -and $org.value -and $org.value.Count -gt 0) { Write-Output "TENANT_NAME:$($org.value[0].displayName)" }
} catch {}`,
          (line) => orgLines.push(line),
          15000
        )
        const nameLine = orgLines.find(l => l.startsWith('TENANT_NAME:'))
        if (nameLine) tenantName = nameLine.slice('TENANT_NAME:'.length).trim()
      } catch { /* best-effort */ }

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
  $r = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/${safe}?\`$select=displayName,userPrincipalName" -ErrorAction SilentlyContinue
  if ($r -and $r.displayName) {
    $nameMap['${safe}'] = if ($r.userPrincipalName) { "$($r.displayName) ($($r.userPrincipalName))" } else { $r.displayName }
  }
} catch {}`
          })
          const groupBlocks = excGroupIds.map(id => {
            const safe = id.replace(/'/g, "''")
            return `try {
  $r = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/groups/${safe}?\`$select=displayName" -ErrorAction SilentlyContinue
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

      return { policies, nameMap, tenantName }
    } catch (err) {
      return { error: err.message }
    }
  })

  // App: save PDF
  ipcMain.handle('app:savePDF', async (_, orgName, policiesData, nameMap = {}, recommendations = []) => {
    const sanitised = (orgName || 'report')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80)
    const timestamp = new Date().toISOString().slice(0, 10)
    const defaultFilename = `SecurityReport_${sanitised}_${timestamp}.pdf`

    const { filePath, canceled } = await dialog.showSaveDialog(_win, {
      title: 'Save Security Report',
      defaultPath: path.join(app.getPath('documents'), defaultFilename),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { cancelled: true }

    const policies = Array.isArray(policiesData) ? policiesData : []
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const html = generateReportHtml(orgName, policies, date, nameMap || {}, recommendations || [])
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

  // App: save Word doc
  ipcMain.handle('app:saveDocx', async (_, orgName, policiesData, nameMap = {}, recommendations = [], accountManager = null) => {
    const sanitised = (orgName || 'report')
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80)
    const timestamp = new Date().toISOString().slice(0, 10)
    const defaultFilename = `SecurityReport_${sanitised}_${timestamp}.docx`

    const { filePath, canceled } = await dialog.showSaveDialog(_win, {
      title: 'Save Security Report as Word Document',
      defaultPath: path.join(app.getPath('documents'), defaultFilename),
      filters: [{ name: 'Word Documents', extensions: ['docx'] }],
    })
    if (canceled || !filePath) return { cancelled: true }

    const policies = Array.isArray(policiesData) ? policiesData : []
    const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const amName  = accountManager?.name  || null
    const amEmail = accountManager?.email || null
    try {
      const buffer = await generateDocxBuffer(orgName, policies, date, nameMap || {}, recommendations || [], amName, amEmail)
      fs.writeFileSync(filePath, buffer)
      return { path: filePath }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Tenant entity search (users & groups) — used by the EntityPicker UI component
  ipcMain.handle('tenant:searchUsers', async (_, query) => {
    if (!psSession.alive) return { items: [], error: 'No active session' }
    const safeQ = safe(query || '')
    if (!safeQ) return { items: [] }
    const script = `
try {
  $q = '${safeQ}'
  $hdrs = @{ 'ConsistencyLevel' = 'eventual' }
  $sel = 'id,displayName,mail,userPrincipalName'
  $uri1 = 'https://graph.microsoft.com/v1.0/users?$search="displayName:' + $q + '"&$count=true&$top=10&$select=' + $sel
  $uri2 = 'https://graph.microsoft.com/v1.0/users?$search="userPrincipalName:' + $q + '"&$count=true&$top=10&$select=' + $sel
  $r1 = Invoke-MgGraphRequest -Method GET -Uri $uri1 -Headers $hdrs -ErrorAction Stop
  $r2 = Invoke-MgGraphRequest -Method GET -Uri $uri2 -Headers $hdrs -ErrorAction Stop
  $seen = @{}; $combined = [System.Collections.Generic.List[object]]::new()
  foreach ($u in (@($r1.value) + @($r2.value))) {
    if ($u -and $u.id -and -not $seen.ContainsKey($u.id)) { $seen[$u.id] = $true; $combined.Add($u) }
  }
  $result = @($combined | Select-Object -First 15 | ForEach-Object {
    @{ id = $_.id; displayName = $_.displayName; mail = if ($_.mail) { $_.mail } else { $_.userPrincipalName } }
  })
  Write-Output "SEARCH_JSON_START"
  if ($result.Count -eq 0) { Write-Output '[]' } else { Write-Output ($result | ConvertTo-Json -Compress) }
  Write-Output "SEARCH_JSON_END"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`
    const lines = []
    await psSession.run(script, l => lines.push(l))
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) return { items: [], error: errorLine.slice(6).trim() }
    const startIdx = lines.indexOf('SEARCH_JSON_START')
    const endIdx = lines.indexOf('SEARCH_JSON_END')
    if (startIdx === -1 || endIdx <= startIdx) return { items: [] }
    try {
      const items = JSON.parse(lines.slice(startIdx + 1, endIdx).join('') || '[]')
      return { items: Array.isArray(items) ? items : [items] }
    } catch {
      return { items: [] }
    }
  })

  ipcMain.handle('tenant:searchGroups', async (_, query) => {
    if (!psSession.alive) return { items: [], error: 'No active session' }
    const safeQ = safe(query || '')
    if (!safeQ) return { items: [] }
    const script = `
try {
  $q = '${safeQ}'
  $uri = 'https://graph.microsoft.com/v1.0/groups?$search="displayName:' + $q + '"&$count=true&$top=15&$select=id,displayName,description'
  $resp = Invoke-MgGraphRequest -Method GET -Uri $uri -Headers @{ 'ConsistencyLevel' = 'eventual' } -ErrorAction Stop
  $result = @($resp.value | Where-Object { $_ } | ForEach-Object {
    @{ id = $_.id; displayName = $_.displayName; description = $_.description }
  })
  Write-Output "SEARCH_JSON_START"
  if ($result.Count -eq 0) { Write-Output '[]' } else { Write-Output ($result | ConvertTo-Json -Compress) }
  Write-Output "SEARCH_JSON_END"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
}`
    const lines = []
    await psSession.run(script, l => lines.push(l))
    const errorLine = lines.find(l => l.startsWith('ERROR:'))
    if (errorLine) return { items: [], error: errorLine.slice(6).trim() }
    const startIdx = lines.indexOf('SEARCH_JSON_START')
    const endIdx = lines.indexOf('SEARCH_JSON_END')
    if (startIdx === -1 || endIdx <= startIdx) return { items: [] }
    try {
      const items = JSON.parse(lines.slice(startIdx + 1, endIdx).join('') || '[]')
      return { items: Array.isArray(items) ? items : [items] }
    } catch {
      return { items: [] }
    }
  })

}

module.exports = { registerIpcHandlers }
