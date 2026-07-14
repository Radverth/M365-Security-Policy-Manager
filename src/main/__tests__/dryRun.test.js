'use strict'

// Tests the dry-run/diagnostics harness across the ENTIRE policy catalog —
// every category (module) and every policy is generated and validated, so a
// broken script builder fails CI before it ever reaches a tenant.
//
// These tests are hermetic: PowerShell syntax validation and local module
// checks are disabled (they run when pwsh is available via `npm run dryrun`).

const { runDryRun, reportToMarkdown, reportToText, checkDelimiters, extractCmdlets, analyzePolicy } = require('../dryRun')
const { getCatalog, defaultConfigFor } = require('../policyCatalog')
const { buildPolicyScript } = require('../policyBuilder')

const HERMETIC = { syntaxCheck: false, moduleCheck: false }

// ─── Catalog integrity ────────────────────────────────────────────────────────

describe('policy catalog', () => {
  const catalog = getCatalog()

  test('loads a non-trivial policy list', () => {
    expect(catalog.POLICIES.length).toBeGreaterThan(100)
  })

  test('policy IDs are unique', () => {
    const ids = catalog.POLICIES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every policy has a known category', () => {
    const known = new Set(Object.values(catalog.POLICY_CATEGORIES))
    for (const p of catalog.POLICIES) {
      expect(known).toContain(p.category)
    }
  })

  test('every policy ID matches its category prefix', () => {
    const prefixFor = Object.fromEntries(
      Object.entries(catalog.POLICY_CATEGORIES).map(([k, v]) => [v, k])
    )
    for (const p of catalog.POLICIES) {
      expect(p.id.startsWith(prefixFor[p.category])).toBe(true)
    }
  })

  test('baselines only reference policies that exist', () => {
    const ids = new Set(catalog.POLICIES.map((p) => p.id))
    for (const b of catalog.BASELINES) {
      for (const pid of b.policyIds) {
        if (!ids.has(pid)) {
          throw new Error(`Baseline "${b.id}" references unknown policy ${pid}`)
        }
      }
    }
  })

  test('defaultConfigFor fills category and per-policy defaults', () => {
    const ca015 = catalog.POLICIES.find((p) => p.id === 'CA015')
    const cfg = defaultConfigFor(ca015)
    expect(cfg.state).toBe('enabled')
    expect(cfg.sessionFrequencyHours).toBe(8)
  })
})

// ─── Every policy generates valid structure ───────────────────────────────────

describe('script generation across the full catalog', () => {
  const catalog = getCatalog()

  test.each(catalog.POLICIES.map((p) => [p.id, p]))('%s generates a well-formed block', (_, policy) => {
    const script = buildPolicyScript(policy, defaultConfigFor(policy), '')
    expect(script).toContain(`CREATING: ${policy.id}`)
    const isSkip = script.includes('SKIPPED:')
    if (!isSkip) {
      expect(script).toContain(`SUCCESS: ${policy.id}`)
      expect(script).toContain(`FAILURE: ${policy.id}`)
      expect(script).toContain('try {')
      expect(script).toContain('} catch {')
    }
    // Balanced delimiters outside strings/comments
    expect(checkDelimiters(script)).toEqual([])
  })

  test('prefix is applied to display names', () => {
    const ca001 = catalog.POLICIES.find((p) => p.id === 'CA001')
    const script = buildPolicyScript(ca001, defaultConfigFor(ca001), 'ACME')
    expect(script).toContain('ACME - CA001')
  })
})

// ─── Structural check helpers ─────────────────────────────────────────────────

describe('checkDelimiters', () => {
  test('passes balanced code with braces inside strings', () => {
    expect(checkDelimiters(`$x = @{ a = 'text with ) and }' }\nWrite-Output "val ($($x.a))"`)).toEqual([])
  })
  test('catches an unbalanced brace', () => {
    expect(checkDelimiters('if ($x) { Write-Output "y"').join(' ')).toMatch(/unbalanced braces/)
  })
  test('catches an unterminated string', () => {
    expect(checkDelimiters("Write-Output 'oops").join(' ')).toMatch(/unterminated string/)
  })
  test('handles doubled-quote escapes', () => {
    expect(checkDelimiters("Write-Output 'it''s fine'")).toEqual([])
  })
  test('ignores comments', () => {
    expect(checkDelimiters('# comment with { ( [\nWrite-Output "ok"')).toEqual([])
  })
})

describe('extractCmdlets', () => {
  test('finds real cmdlets and skips display-name lookalikes', () => {
    const cmdlets = extractCmdlets(`
Write-Output "CREATING: EX004 - Anti-Spam: Inbound Policy"
New-HostedContentFilterPolicy -Name $pn
Set-HostedContentFilterPolicy -Identity $pn
`)
    expect(cmdlets).toContain('New-HostedContentFilterPolicy')
    expect(cmdlets).toContain('Set-HostedContentFilterPolicy')
    expect(cmdlets).not.toContain('Anti-Spam')
    expect(cmdlets).not.toContain('Write-Output')
  })
})

// ─── analyzePolicy classification ─────────────────────────────────────────────

describe('analyzePolicy', () => {
  const catalog = getCatalog()
  const byId = Object.fromEntries(catalog.POLICIES.map((p) => [p.id, p]))

  test('automatable policy → deploy', () => {
    const e = analyzePolicy(byId.CA001, defaultConfigFor(byId.CA001), '')
    expect(e.action).toBe('deploy')
    expect(e.status).toBe('ok')
    expect(e.connection).toBe('graph')
    expect(e.cmdlets).toContain('New-MgIdentityConditionalAccessPolicy')
  })

  test('manual-only policy → manual with a reason', () => {
    const e = analyzePolicy(byId.TE015, defaultConfigFor(byId.TE015), '')
    expect(e.action).toBe('manual')
    expect(e.reason).toBeTruthy()
  })

  test('config-dependent skip (CA028 without IP ranges) → manual', () => {
    const e = analyzePolicy(byId.CA028, defaultConfigFor(byId.CA028), '')
    expect(e.action).toBe('manual')
    expect(e.reason).toMatch(/No IP ranges/)
  })

  test('Exchange policy → exo connection', () => {
    const e = analyzePolicy(byId.EX001, defaultConfigFor(byId.EX001), '')
    expect(e.connection).toBe('exo')
  })

  test('Purview policy → ipps connection', () => {
    const e = analyzePolicy(byId.AC007, defaultConfigFor(byId.AC007), '')
    expect(e.connection).toBe('ipps')
  })

  test('beta Graph endpoint flagged as warning', () => {
    const e = analyzePolicy(byId.IP001, defaultConfigFor(byId.IP001), '')
    expect(e.warnings.join(' ')).toMatch(/beta endpoint/)
  })
})

// ─── Full dry run ─────────────────────────────────────────────────────────────

describe('runDryRun (full catalog, hermetic)', () => {
  let report
  beforeAll(async () => { report = await runDryRun(HERMETIC) })

  test('analyses every catalog policy', () => {
    expect(report.summary.total).toBe(getCatalog().POLICIES.length)
    expect(report.policies.length).toBe(report.summary.total)
  })

  test('no policy has structural errors', () => {
    const broken = report.policies.filter((p) => p.status === 'error')
    expect(broken.map((p) => `${p.id}: ${p.errors.join('; ')}`)).toEqual([])
  })

  test('summary counts are consistent', () => {
    expect(report.summary.deploy + report.summary.manual).toBe(report.summary.total)
    const catTotal = Object.values(report.summary.byCategory).reduce((a, c) => a + c.total, 0)
    expect(catTotal).toBe(report.summary.total)
  })

  test('full deployment scripts assemble without errors', () => {
    expect(report.summary.fullScriptErrors).toEqual([])
    expect(report.fullScript).toContain('Connect-MgGraph')
    expect(report.fullScript).toContain('Disconnect-MgGraph')
  })

  test('exported script contains no embedded credentials', () => {
    expect(report.fullScript).not.toContain('ConvertTo-SecureString')
    expect(report.fullScript).toContain('-UseDeviceAuthentication')
  })

  test('reports all three connection types for the full catalog', () => {
    const keys = report.summary.connections.map((c) => c.key).sort()
    expect(keys).toEqual(['exo', 'graph', 'ipps'])
  })

  test('markdown export renders', () => {
    const md = reportToMarkdown(report)
    expect(md).toContain('# M365 Policy Manager — Dry Run Report')
    expect(md).toContain('| Category | Total |')
    expect(md).toContain('CA001')
  })

  test('text export renders', () => {
    const txt = reportToText(report, false)
    expect(txt).toContain('Summary')
    expect(txt).toContain('CA001')
  })
})

describe('runDryRun scoping', () => {
  test('filters by category', async () => {
    const report = await runDryRun({ ...HERMETIC, categories: ['Teams'] })
    expect(report.summary.total).toBeGreaterThan(0)
    expect(report.policies.every((p) => p.category === 'Teams')).toBe(true)
  })

  test('filters by policy IDs', async () => {
    const report = await runDryRun({ ...HERMETIC, policyIds: ['CA001', 'EX001'] })
    expect(report.policies.map((p) => p.id).sort()).toEqual(['CA001', 'EX001'])
  })

  test('applies config overrides', async () => {
    const report = await runDryRun({
      ...HERMETIC,
      policyIds: ['CA028'],
      policyConfigs: { CA028: { ipRanges: '203.0.113.0/24' } },
    })
    expect(report.policies[0].action).toBe('deploy')
    expect(report.policies[0].script).toContain('203.0.113.0/24')
  })

  test('throws on an empty scope', async () => {
    await expect(runDryRun({ ...HERMETIC, policyIds: ['ZZ999'] })).rejects.toThrow(/No policies matched/)
  })
})
