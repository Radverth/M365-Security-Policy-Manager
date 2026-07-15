'use strict'

// Dry-run / diagnostics engine.
//
// Generates the PowerShell that WOULD be deployed for every policy (or a
// selection), then validates it WITHOUT touching a tenant:
//   1. structural checks  — output markers, balanced delimiters (always run)
//   2. syntax validation  — the real PowerShell parser, when pwsh is installed
//   3. local module check — which required PS modules are installed (optional)
//
// Pure Node (fs/os/path/child_process only) so it runs identically from the
// Electron main process and from `npm run dryrun` on a dev machine or CI.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const { buildScript, buildPoliciesScript, buildPolicyScript, needsExo, needsIpps } = require('./policyBuilder')
const { getCatalog, defaultConfigFor } = require('./policyCatalog')

// ─── PowerShell discovery (standalone — no electron-store dependency) ─────────

function findPwsh(preferred) {
  const candidates = []
  if (preferred) candidates.push(preferred)
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
      'pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'powershell.exe',
    )
  } else {
    candidates.push('/usr/bin/pwsh', '/usr/local/bin/pwsh', '/snap/bin/pwsh', '/opt/microsoft/powershell/7/pwsh', 'pwsh')
  }
  for (const c of candidates) {
    if (path.isAbsolute(c)) {
      try { if (!fs.existsSync(c)) continue } catch { continue }
    }
    return c
  }
  return null
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

function execCapture(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: err.message })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { try { proc.kill() } catch {} }, timeoutMs)
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8') })
    proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }) })
    proc.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, stdout, stderr: err.message }) })
  })
}

async function detectPwsh(preferred) {
  const pwsh = findPwsh(preferred)
  if (!pwsh) return { found: false, path: null, version: null }
  const res = await execCapture(pwsh, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], 30000)
  if (!res.ok || !res.stdout.trim()) return { found: false, path: pwsh, version: null }
  return { found: true, path: pwsh, version: res.stdout.trim().split('\n')[0].trim() }
}

// ─── Structural checks ────────────────────────────────────────────────────────

// Counts {} () [] outside of strings and comments. Content inside quoted
// strings is treated as opaque (a "$($x.Id)" sub-expression is balanced in
// practice, and literal text like "(included in E3)" must not count).
function checkDelimiters(script) {
  const counts = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0 }
  let mode = 'code' // code | squote | dquote | comment
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]
    const next = script[i + 1]
    if (mode === 'comment') {
      if (ch === '\n') mode = 'code'
      continue
    }
    if (mode === 'squote') {
      if (ch === "'") {
        if (next === "'") { i++; continue } // '' escape
        mode = 'code'
      }
      continue
    }
    if (mode === 'dquote') {
      if (ch === '`') { i++; continue } // backtick escape
      if (ch === '"') {
        if (next === '"') { i++; continue } // "" escape
        mode = 'code'
      }
      continue
    }
    // code
    if (ch === '#') { mode = 'comment'; continue }
    if (ch === "'") { mode = 'squote'; continue }
    if (ch === '"') { mode = 'dquote'; continue }
    if (ch in counts) counts[ch]++
  }
  const problems = []
  if (counts['{'] !== counts['}']) problems.push(`unbalanced braces ({ ${counts['{']} vs } ${counts['}']})`)
  if (counts['('] !== counts[')']) problems.push(`unbalanced parentheses (( ${counts['(']} vs ) ${counts[')']})`)
  if (counts['['] !== counts[']']) problems.push(`unbalanced brackets ([ ${counts['[']} vs ] ${counts[']']})`)
  if (mode === 'squote' || mode === 'dquote') problems.push('unterminated string literal')
  return problems
}

// Cmdlets invoked by a script block — approved-verb whitelist keeps display
// names like "Anti-Spam" out of the list.
const PS_VERBS = new Set([
  'Get', 'Set', 'New', 'Remove', 'Add', 'Update', 'Enable', 'Disable',
  'Connect', 'Disconnect', 'Invoke', 'Import', 'Export', 'Install', 'Uninstall',
  'Find', 'Test', 'Start', 'Stop', 'ConvertTo', 'ConvertFrom', 'Select', 'Sort',
  'Where', 'ForEach', 'Out', 'Write',
])
const NOISE_CMDLETS = new Set([
  'Write-Output', 'Out-Null', 'Select-Object', 'Sort-Object', 'Where-Object',
  'ForEach-Object', 'ConvertTo-Json', 'ConvertFrom-Json', 'ConvertTo-SecureString',
  'New-Object', 'Write-Host',
])
function extractCmdlets(script) {
  const found = new Set()
  const re = /\b([A-Z][a-zA-Z]+)-([A-Z][A-Za-z0-9]+)\b/g
  let m
  while ((m = re.exec(script)) !== null) {
    const name = `${m[1]}-${m[2]}`
    if (PS_VERBS.has(m[1]) && !NOISE_CMDLETS.has(name)) found.add(name)
  }
  return [...found].sort()
}

// ─── Per-policy analysis ──────────────────────────────────────────────────────

function connectionFor(policy) {
  if (needsIpps(policy)) return 'ipps'
  if (needsExo(policy)) return 'exo'
  return 'graph'
}

const CONNECTION_LABELS = {
  graph: 'Microsoft Graph',
  exo: 'Exchange Online',
  ipps: 'Security & Compliance (IPPS)',
}

const CONNECTION_MODULES = {
  graph: ['Microsoft.Graph.Authentication', 'Microsoft.Graph.Identity.SignIns', 'Microsoft.Graph.Identity.DirectoryManagement', 'Microsoft.Graph.DeviceManagement'],
  exo: ['ExchangeOnlineManagement'],
  ipps: ['ExchangeOnlineManagement'],
}

function licenseLabelsFor(policy) {
  const { LICENSE_LABELS, LICENSE_SHORT } = getCatalog()
  return (policy.requiredLicenses || []).map((k) => ({
    key: k,
    label: LICENSE_LABELS[k] || k,
    short: LICENSE_SHORT[k] || k,
  }))
}

function analyzePolicy(policy, config, prefix) {
  const errors = []
  const warnings = []

  let script
  try {
    script = buildPolicyScript(policy, config, prefix)
  } catch (err) {
    return {
      id: policy.id,
      name: policy.name,
      category: policy.category,
      severity: policy.severity || null,
      action: 'error',
      status: 'error',
      reason: `Script generation threw: ${err.message}`,
      connection: connectionFor(policy),
      requiredLicenses: policy.requiredLicenses || [],
      licenses: licenseLabelsFor(policy),
      cmdlets: [],
      errors: [`Script generation threw: ${err.message}`],
      warnings: [],
      syntax: { status: 'not-checked', errors: [] },
      script: '',
    }
  }

  const isSkip = script.includes('SKIPPED:')
  // skipBlock writes the reason on its INFO line
  const infoMatch = script.match(/Write-Output "INFO: [A-Z]{2}\d{3} - ([^"]+)"/)
  const reason = isSkip ? (infoMatch ? infoMatch[1] : 'Manual configuration required') : null

  if (!script.includes(`CREATING: ${policy.id}`)) errors.push('Missing CREATING output marker')
  if (!isSkip) {
    if (!script.includes(`SUCCESS: ${policy.id}`)) errors.push('Missing SUCCESS output marker')
    if (!script.includes(`FAILURE: ${policy.id}`)) errors.push('Missing FAILURE output marker (errors would be silent)')
    if (!script.includes('try {') || !script.includes('} catch {')) errors.push('Missing try/catch error handling')
  }
  for (const p of checkDelimiters(script)) errors.push(p)

  if (/graph\.microsoft\.com\/beta\//.test(script)) {
    warnings.push('Uses the Graph beta endpoint — subject to change by Microsoft')
  }

  return {
    id: policy.id,
    name: policy.name,
    category: policy.category,
    severity: policy.severity || null,
    action: isSkip ? 'manual' : 'deploy',
    status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok',
    reason,
    connection: connectionFor(policy),
    requiredLicenses: policy.requiredLicenses || [],
    licenses: licenseLabelsFor(policy),
    cmdlets: extractCmdlets(script),
    errors,
    warnings,
    syntax: { status: 'not-checked', errors: [] },
    script,
  }
}

// ─── PowerShell syntax validation (parse only — nothing is executed) ──────────

async function validateSyntax(namedScripts, pwshPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm365-dryrun-'))
  try {
    // Targets live in a subdirectory so the runner itself is never a target.
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(scriptsDir)
    for (const [name, script] of Object.entries(namedScripts)) {
      // BOM required — deploy-time scripts are written with a BOM too, and
      // Windows PowerShell 5.1 parses BOM-less files as ANSI, which corrupts
      // non-ASCII characters (em-dashes decode as string-terminating quotes).
      fs.writeFileSync(path.join(scriptsDir, `${name}.ps1`), '\ufeff' + script, 'utf8')
    }
    const runner = path.join(dir, 'runner.ps1')
    fs.writeFileSync(runner, `
$results = @()
Get-ChildItem -LiteralPath '${scriptsDir.replace(/'/g, "''")}' -Filter '*.ps1' | Sort-Object Name | ForEach-Object {
    $tokens = $null; $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    $results += [PSCustomObject]@{
        file = $_.BaseName
        errors = @($errors | ForEach-Object { [PSCustomObject]@{
            message = $_.Message
            line = $_.Extent.StartLineNumber
            column = $_.Extent.StartColumnNumber
            text = "$($_.Extent.Text)"
        } })
    }
}
Write-Output 'SYNTAX_JSON_START'
ConvertTo-Json -InputObject $results -Depth 5 -Compress
Write-Output 'SYNTAX_JSON_END'
`, 'utf8')

    const res = await execCapture(pwshPath, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', runner,
    ], 180000)

    const out = res.stdout || ''
    const start = out.indexOf('SYNTAX_JSON_START')
    const end = out.indexOf('SYNTAX_JSON_END')
    if (start === -1 || end === -1) {
      const err = stripAnsi(res.stderr || 'Syntax validator produced no output').trim().slice(0, 500)
      return { ok: false, error: err, results: {} }
    }
    const json = out.slice(start + 'SYNTAX_JSON_START'.length, end).trim()
    const parsed = JSON.parse(json)
    const arr = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
    const results = {}
    for (const r of arr) {
      results[r.file] = (r.errors || []).map((e) => ({
        message: e.message,
        line: e.line,
        column: e.column,
        text: e.text,
      }))
    }
    return { ok: true, results }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// ─── Local module availability (Get-Module -ListAvailable only, no network) ───

async function checkLocalModules(pwshPath, moduleNames) {
  const namesPs = moduleNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')
  const res = await execCapture(pwshPath, [
    '-NoProfile', '-NonInteractive', '-Command',
    `$out=@{}; foreach ($n in @(${namesPs})) { $m = Get-Module -ListAvailable -Name $n | Sort-Object Version -Descending | Select-Object -First 1; $out[$n] = if ($m) { $m.Version.ToString() } else { $null } }; Write-Output 'MODULES_JSON_START'; $out | ConvertTo-Json -Compress; Write-Output 'MODULES_JSON_END'`,
  ], 60000)
  const out = res.stdout || ''
  const start = out.indexOf('MODULES_JSON_START')
  const end = out.indexOf('MODULES_JSON_END')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(out.slice(start + 'MODULES_JSON_START'.length, end).trim())
  } catch {
    return null
  }
}

// ─── Report assembly ──────────────────────────────────────────────────────────

function appVersion() {
  try { return require('../../package.json').version } catch { return 'unknown' }
}

/**
 * Run a dry run.
 * @param {object} options
 *   policies       — array of policy objects; defaults to the full catalog
 *   policyIds      — filter to these IDs (applied to `policies`)
 *   categories     — filter to these categories
 *   policyConfigs  — { [id]: config } overrides; defaults filled per policy
 *   prefix         — display-name prefix (as used at deploy time)
 *   pwshPath       — preferred pwsh executable
 *   syntaxCheck    — default true; set false to skip PowerShell parsing
 *   moduleCheck    — default true; set false to skip local module lookup
 */
async function runDryRun(options = {}) {
  const startedAt = Date.now()
  const catalog = getCatalog()

  let policies = options.policies && options.policies.length ? options.policies : catalog.POLICIES
  if (options.categories && options.categories.length) {
    const cats = new Set(options.categories)
    policies = policies.filter((p) => cats.has(p.category))
  }
  if (options.policyIds && options.policyIds.length) {
    const ids = new Set(options.policyIds)
    policies = policies.filter((p) => ids.has(p.id))
  }
  if (!policies.length) throw new Error('No policies matched the requested scope')

  const prefix = options.prefix || ''
  const configs = {}
  for (const p of policies) {
    configs[p.id] = { ...defaultConfigFor(p), ...(options.policyConfigs?.[p.id] || {}) }
  }

  const entries = policies.map((p) => analyzePolicy(p, configs[p.id], prefix))

  // Full scripts exactly as the app would run them. Interactive/device-code
  // auth mode means no credentials are embedded — safe to export.
  let fullScriptSession = ''
  let fullScriptStandalone = ''
  const fullScriptErrors = []
  try {
    fullScriptSession = buildPoliciesScript(policies, prefix, configs)
  } catch (err) {
    fullScriptErrors.push(`buildPoliciesScript threw: ${err.message}`)
  }
  try {
    fullScriptStandalone = buildScript(policies, {}, prefix, 'interactive', configs)
  } catch (err) {
    fullScriptErrors.push(`buildScript threw: ${err.message}`)
  }

  // Syntax validation via the real PowerShell parser
  const pwsh = await detectPwsh(options.pwshPath)
  let syntaxRun = { attempted: false, ok: false, error: null }
  if (options.syntaxCheck !== false && pwsh.found) {
    syntaxRun.attempted = true
    const namedScripts = {}
    for (const e of entries) { if (e.script) namedScripts[e.id] = e.script }
    if (fullScriptSession) namedScripts['_full-session'] = fullScriptSession
    if (fullScriptStandalone) namedScripts['_full-standalone'] = fullScriptStandalone
    const val = await validateSyntax(namedScripts, pwsh.path)
    syntaxRun.ok = val.ok
    syntaxRun.error = val.error || null
    if (val.ok) {
      for (const e of entries) {
        const errs = val.results[e.id]
        if (errs === undefined) continue
        e.syntax = { status: errs.length ? 'error' : 'ok', errors: errs }
        if (errs.length) {
          e.status = 'error'
          for (const se of errs) e.errors.push(`Syntax: ${se.message} (line ${se.line})`)
        }
      }
      for (const key of ['_full-session', '_full-standalone']) {
        const errs = val.results[key] || []
        if (errs.length) fullScriptErrors.push(...errs.map((se) => `${key}: ${se.message} (line ${se.line})`))
      }
    }
  }

  // Which modules does this scope need, and are they installed locally?
  const connectionsNeeded = [...new Set(entries.map((e) => e.connection))]
  const modulesNeeded = [...new Set(connectionsNeeded.flatMap((c) => CONNECTION_MODULES[c]))].sort()
  let installedModules = null
  if (options.moduleCheck !== false && pwsh.found) {
    installedModules = await checkLocalModules(pwsh.path, modulesNeeded)
  }

  const byCategory = {}
  for (const e of entries) {
    if (!byCategory[e.category]) byCategory[e.category] = { total: 0, deploy: 0, manual: 0, errors: 0, warnings: 0 }
    const c = byCategory[e.category]
    c.total++
    if (e.action === 'deploy') c.deploy++
    if (e.action === 'manual') c.manual++
    if (e.status === 'error') c.errors++
    if (e.status === 'warning') c.warnings++
  }

  // Licence requirements across this scope — which licences are needed, what
  // plans include them, and exactly which policies depend on each.
  const licenseKeys = [...new Set(entries.flatMap((e) => e.requiredLicenses))]
  const licenses = licenseKeys.map((k) => {
    const dependent = entries.filter((e) => e.requiredLicenses.includes(k))
    return {
      key: k,
      label: catalog.LICENSE_LABELS[k] || k,
      short: catalog.LICENSE_SHORT[k] || k,
      plans: catalog.LICENSE_PLANS[k] || null,
      policyCount: dependent.length,
      policyIds: dependent.map((e) => e.id),
    }
  }).sort((a, b) => b.policyCount - a.policyCount)
  const noLicensePolicies = entries.filter((e) => e.requiredLicenses.length === 0)

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      appVersion: appVersion(),
      platform: `${process.platform} ${os.release()}`,
      node: process.version,
      powershell: pwsh,
      prefix,
      scope: {
        policyCount: policies.length,
        categories: [...new Set(policies.map((p) => p.category))],
        policyIds: options.policyIds || null,
      },
      syntaxValidation: !syntaxRun.attempted
        ? (options.syntaxCheck === false ? 'disabled' : 'skipped — PowerShell not found')
        : syntaxRun.ok ? 'ran' : `failed: ${syntaxRun.error}`,
      durationMs: 0, // set below
    },
    summary: {
      total: entries.length,
      deploy: entries.filter((e) => e.action === 'deploy').length,
      manual: entries.filter((e) => e.action === 'manual').length,
      errors: entries.filter((e) => e.status === 'error').length,
      warnings: entries.filter((e) => e.status === 'warning').length,
      byCategory,
      connections: connectionsNeeded.map((c) => ({
        key: c,
        label: CONNECTION_LABELS[c],
        policyCount: entries.filter((e) => e.connection === c).length,
        modules: CONNECTION_MODULES[c].map((m) => ({
          name: m,
          installedVersion: installedModules ? (installedModules[m] || null) : undefined,
        })),
      })),
      licenses,
      noLicensePolicyCount: noLicensePolicies.length,
      fullScriptErrors,
    },
    policies: entries,
    fullScript: fullScriptStandalone,
  }
  report.meta.durationMs = Date.now() - startedAt
  return report
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const STATUS_ICON = { ok: '✓', warning: '⚠', error: '✗' }

function reportToMarkdown(report) {
  const { meta, summary, policies } = report
  const lines = []
  lines.push('# M365 Policy Manager — Dry Run Report')
  lines.push('')
  lines.push(`| | |`)
  lines.push(`|---|---|`)
  lines.push(`| Generated | ${meta.generatedAt} |`)
  lines.push(`| App version | ${meta.appVersion} |`)
  lines.push(`| Host | ${meta.platform}, Node ${meta.node} |`)
  lines.push(`| PowerShell | ${meta.powershell.found ? `${meta.powershell.version} (${meta.powershell.path})` : 'not found'} |`)
  lines.push(`| Syntax validation | ${meta.syntaxValidation} |`)
  lines.push(`| Scope | ${meta.scope.policyCount} policies, ${meta.scope.categories.length} categories |`)
  lines.push(`| Name prefix | ${meta.prefix || '(none)'} |`)
  lines.push(`| Duration | ${meta.durationMs} ms |`)
  lines.push('')

  lines.push('## Summary')
  lines.push('')
  lines.push(`- **${summary.total}** policies analysed`)
  lines.push(`- **${summary.deploy}** automated (script generated)`)
  lines.push(`- **${summary.manual}** manual steps (cannot be automated — instructions provided)`)
  lines.push(`- **${summary.errors}** with errors, **${summary.warnings}** with warnings`)
  lines.push('')

  lines.push('### By category')
  lines.push('')
  lines.push('| Category | Total | Automated | Manual | Errors | Warnings |')
  lines.push('|---|---|---|---|---|---|')
  for (const [cat, c] of Object.entries(summary.byCategory)) {
    lines.push(`| ${cat} | ${c.total} | ${c.deploy} | ${c.manual} | ${c.errors} | ${c.warnings} |`)
  }
  lines.push('')

  lines.push('### Connections & required modules')
  lines.push('')
  lines.push('| Connection | Policies | Module | Installed |')
  lines.push('|---|---|---|---|')
  for (const conn of summary.connections) {
    for (const m of conn.modules) {
      const inst = m.installedVersion === undefined ? 'not checked' : (m.installedVersion || '**missing**')
      lines.push(`| ${conn.label} | ${conn.policyCount} | ${m.name} | ${inst} |`)
    }
  }
  lines.push('')

  if (summary.licenses.length) {
    lines.push('### Licence requirements')
    lines.push('')
    lines.push('| Licence | Policies | Included in | Required by |')
    lines.push('|---|---|---|---|')
    for (const l of summary.licenses) {
      const plans = (l.plans || '').replace(/^Included in:\s*/i, '') || '—'
      const ids = l.policyIds.length > 12
        ? `${l.policyIds.slice(0, 12).join(', ')} … (+${l.policyIds.length - 12} more)`
        : l.policyIds.join(', ')
      lines.push(`| ${l.label} | ${l.policyCount} | ${plans} | ${ids} |`)
    }
    if (summary.noLicensePolicyCount > 0) {
      lines.push(`| _No specific licence_ | ${summary.noLicensePolicyCount} | Any Microsoft 365 subscription | |`)
    }
    lines.push('')
    lines.push('> A policy listing multiple licences requires **all** of them (e.g. device-compliance Conditional Access needs Entra ID P1 **and** Intune). At deploy time the app also detects the tenant\'s actual licences and emits a WARNING line for any policy the tenant isn\'t licensed for.')
    lines.push('')
  }

  if (summary.fullScriptErrors.length) {
    lines.push('### Full deployment script issues')
    lines.push('')
    for (const e of summary.fullScriptErrors) lines.push(`- ${e}`)
    lines.push('')
  }

  lines.push('## Policies')
  lines.push('')
  const cats = [...new Set(policies.map((p) => p.category))]
  for (const cat of cats) {
    lines.push(`### ${cat}`)
    lines.push('')
    lines.push('| | ID | Name | Action | Syntax | Licences | Notes |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const p of policies.filter((x) => x.category === cat)) {
      const notes = [...p.errors, ...p.warnings, ...(p.reason ? [p.reason] : [])].join('; ').replace(/\|/g, '\\|')
      const lic = (p.licenses || []).map((l) => l.short).join(' + ') || '—'
      lines.push(`| ${STATUS_ICON[p.status] || '?'} | ${p.id} | ${p.name.replace(/\|/g, '\\|')} | ${p.action} | ${p.syntax.status} | ${lic} | ${notes} |`)
    }
    lines.push('')
  }

  const problems = policies.filter((p) => p.status === 'error')
  if (problems.length) {
    lines.push('## Problem details')
    lines.push('')
    for (const p of problems) {
      lines.push(`### ${p.id} — ${p.name}`)
      lines.push('')
      for (const e of p.errors) lines.push(`- ✗ ${e}`)
      for (const w of p.warnings) lines.push(`- ⚠ ${w}`)
      lines.push('')
      lines.push('```powershell')
      lines.push(p.script.trim())
      lines.push('```')
      lines.push('')
    }
  }

  return lines.join('\n')
}

function reportToText(report, useColor = false) {
  const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
  const green = (s) => c('32', s)
  const red = (s) => c('31', s)
  const yellow = (s) => c('33', s)
  const dim = (s) => c('2', s)
  const bold = (s) => c('1', s)

  const { meta, summary, policies } = report
  const lines = []
  lines.push(bold('M365 Policy Manager — Dry Run'))
  lines.push(dim(`Generated ${meta.generatedAt} · app v${meta.appVersion} · ${meta.platform} · Node ${meta.node}`))
  lines.push(dim(`PowerShell: ${meta.powershell.found ? `${meta.powershell.version} (${meta.powershell.path})` : 'NOT FOUND'} · syntax validation: ${meta.syntaxValidation}`))
  lines.push('')

  const cats = [...new Set(policies.map((p) => p.category))]
  for (const cat of cats) {
    lines.push(bold(`── ${cat} ${'─'.repeat(Math.max(2, 58 - cat.length))}`))
    for (const p of policies.filter((x) => x.category === cat)) {
      const icon = p.status === 'ok' ? green('✓') : p.status === 'warning' ? yellow('⚠') : red('✗')
      const action = p.action === 'deploy' ? green('deploy') : yellow('manual')
      const lic = (p.licenses || []).length ? dim(`  [${p.licenses.map((l) => l.short).join(' + ')}]`) : ''
      lines.push(`  ${icon} ${p.id}  ${p.name.padEnd(52).slice(0, 52)} ${action}${p.syntax.status === 'ok' ? dim('  syntax ok') : p.syntax.status === 'error' ? red('  SYNTAX ERROR') : ''}${lic}`)
      for (const e of p.errors) lines.push(red(`      ✗ ${e}`))
      for (const w of p.warnings) lines.push(yellow(`      ⚠ ${w}`))
      if (p.reason) lines.push(dim(`      · ${p.reason}`))
    }
    lines.push('')
  }

  lines.push(bold('── Summary ' + '─'.repeat(51)))
  lines.push(`  ${summary.total} policies · ${green(`${summary.deploy} automated`)} · ${yellow(`${summary.manual} manual`)} · ${summary.errors ? red(`${summary.errors} errors`) : green('0 errors')} · ${summary.warnings ? yellow(`${summary.warnings} warnings`) : '0 warnings'}`)
  for (const conn of summary.connections) {
    const mods = conn.modules.map((m) => `${m.name}${m.installedVersion === undefined ? '' : m.installedVersion ? ` (${m.installedVersion})` : red(' (missing)')}`).join(', ')
    lines.push(dim(`  ${conn.label}: ${conn.policyCount} policies — needs ${mods}`))
  }
  if (summary.licenses.length) {
    lines.push('')
    lines.push(bold('── Licence requirements ' + '─'.repeat(38)))
    for (const l of summary.licenses) {
      const plans = (l.plans || '').replace(/^Included in:\s*/i, '')
      lines.push(`  ${l.label} — ${l.policyCount} ${l.policyCount === 1 ? 'policy' : 'policies'}${plans ? dim(` (included in: ${plans})`) : ''}`)
    }
    if (summary.noLicensePolicyCount > 0) {
      lines.push(dim(`  No specific licence — ${summary.noLicensePolicyCount} policies (any Microsoft 365 subscription)`))
    }
  }
  if (summary.fullScriptErrors.length) {
    lines.push(red(`  Full script issues:`))
    for (const e of summary.fullScriptErrors) lines.push(red(`    ✗ ${e}`))
  }
  return lines.join('\n')
}

module.exports = { runDryRun, reportToMarkdown, reportToText, detectPwsh, validateSyntax, checkDelimiters, extractCmdlets, analyzePolicy, CONNECTION_LABELS, CONNECTION_MODULES }
