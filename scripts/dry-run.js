#!/usr/bin/env node
'use strict'

// CLI dry-run harness for the M365 Security Policy Manager.
//
// Generates the PowerShell for every policy module, validates it (structural
// checks + real PowerShell syntax parsing when pwsh is installed), prints a
// readable per-category summary, and exports a debugging bundle:
//
//   dry-run-output/
//     dry-run-report.json   full machine-readable report (share this for debugging)
//     dry-run-report.md     human-readable report
//     deploy-script.ps1     the full script exactly as the app would run it
//                           (interactive/device-code auth — no credentials embedded)
//
// Usage:
//   npm run dryrun                          all policies
//   npm run dryrun -- --category CA         one category (prefix key or full name)
//   npm run dryrun -- --policy CA001,EX004  specific policies
//   npm run dryrun -- --baseline zero-trust a baseline from the Baselines page
//   npm run dryrun -- --prefix "ACME"       apply a display-name prefix
//   npm run dryrun -- --config my.json      policy config overrides { "CA015": { ... } }
//   npm run dryrun -- --no-syntax           skip PowerShell syntax validation
//   npm run dryrun -- --out ./somewhere     change the export directory
//   npm run dryrun -- --quiet               summary only (no per-policy lines)
//
// Exit code: 0 when no errors, 1 when any policy has errors (CI-friendly).

const fs = require('fs')
const path = require('path')

const { runDryRun, reportToMarkdown, reportToText } = require('../src/main/dryRun')
const { getCatalog } = require('../src/main/policyCatalog')

function parseArgs(argv) {
  const args = { out: path.join(process.cwd(), 'dry-run-output'), syntax: true, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--category': args.category = argv[++i]; break
      case '--policy': args.policy = argv[++i]; break
      case '--baseline': args.baseline = argv[++i]; break
      case '--prefix': args.prefix = argv[++i]; break
      case '--config': args.config = argv[++i]; break
      case '--out': args.out = argv[++i]; break
      case '--no-syntax': args.syntax = false; break
      case '--quiet': args.quiet = true; break
      case '--json': args.json = true; break
      case '--help': case '-h': args.help = true; break
      default:
        console.error(`Unknown argument: ${a} (use --help)`)
        process.exit(2)
    }
  }
  return args
}

function usage() {
  console.log(`M365 Policy Manager dry-run harness

Options:
  --category <key|name>   Only one category (CA, EX, ... or "Conditional Access")
  --policy <ids>          Comma-separated policy IDs (CA001,EX004)
  --baseline <id>         Policies from a baseline (secure-foundation, zero-trust,
                          remote-work, protect-admins)
  --prefix <text>         Display-name prefix applied at deploy time
  --config <file.json>    Policy config overrides: { "CA015": { "sessionFrequencyHours": 4 } }
  --out <dir>             Export directory (default ./dry-run-output)
  --no-syntax             Skip PowerShell syntax validation
  --json                  Print the JSON report to stdout instead of the summary
  --quiet                 Summary only`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return 0 }

  const catalog = getCatalog()
  const options = { syntaxCheck: args.syntax, prefix: args.prefix || '' }

  if (args.category) {
    const byKey = catalog.POLICY_CATEGORIES[args.category.toUpperCase()]
    const name = byKey || Object.values(catalog.POLICY_CATEGORIES).find(
      (c) => c.toLowerCase() === args.category.toLowerCase()
    )
    if (!name) {
      console.error(`Unknown category "${args.category}". Known: ${Object.entries(catalog.POLICY_CATEGORIES).map(([k, v]) => `${k} (${v})`).join(', ')}`)
      return 2
    }
    options.categories = [name]
  }

  if (args.policy) options.policyIds = args.policy.split(',').map((s) => s.trim()).filter(Boolean)

  if (args.baseline) {
    const bl = catalog.BASELINES.find((b) => b.id === args.baseline)
    if (!bl) {
      console.error(`Unknown baseline "${args.baseline}". Known: ${catalog.BASELINES.map((b) => b.id).join(', ')}`)
      return 2
    }
    options.policyIds = bl.policyIds
  }

  if (args.config) {
    options.policyConfigs = JSON.parse(fs.readFileSync(args.config, 'utf8'))
  }

  const report = await runDryRun(options)

  // Exports
  fs.mkdirSync(args.out, { recursive: true })
  const jsonPath = path.join(args.out, 'dry-run-report.json')
  const mdPath = path.join(args.out, 'dry-run-report.md')
  const ps1Path = path.join(args.out, 'deploy-script.ps1')
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(mdPath, reportToMarkdown(report), 'utf8')
  if (report.fullScript) fs.writeFileSync(ps1Path, report.fullScript, 'utf8')

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const useColor = process.stdout.isTTY
    let text = reportToText(report, useColor)
    if (args.quiet) {
      const idx = text.indexOf('── Summary')
      const header = text.split('\n').slice(0, 3).join('\n')
      text = header + '\n\n' + text.slice(idx)
    }
    console.log(text)
    console.log('')
    console.log(`Exported: ${jsonPath}`)
    console.log(`          ${mdPath}`)
    if (report.fullScript) console.log(`          ${ps1Path}`)
  }

  return report.summary.errors > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => { console.error(`dry-run failed: ${err.stack || err.message}`); process.exit(2) }
)
