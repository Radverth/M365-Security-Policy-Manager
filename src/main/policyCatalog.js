'use strict'

// CommonJS loader for the ES-module data files shared with the renderer
// (src/shared/constants.js and src/renderer/data/baselines.js). The main
// process and the CLI dry-run harness are CommonJS, so we read the source,
// strip the `export ` keywords and evaluate it in a sandbox instead of
// duplicating the ~130-policy catalog.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

function loadEsmConstants(file) {
  const src = fs.readFileSync(file, 'utf8')
  const names = [...src.matchAll(/^export const (\w+)/gm)].map((m) => m[1])
  if (names.length === 0) throw new Error(`No exports found in ${file}`)
  const body = src.replace(/^export /gm, '')
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(`${body}\n;__exports = { ${names.join(', ')} }`, sandbox, { filename: file })
  return sandbox.__exports
}

let _catalog = null

function getCatalog() {
  if (_catalog) return _catalog

  const constantsPath = path.join(__dirname, '..', 'shared', 'constants.js')
  const baselinesPath = path.join(__dirname, '..', 'renderer', 'data', 'baselines.js')

  const constants = loadEsmConstants(constantsPath)

  let baselines = []
  try {
    baselines = loadEsmConstants(baselinesPath).BASELINES || []
  } catch {
    // Baselines are optional for the dry-run harness — carry on without them.
  }

  _catalog = {
    POLICIES: constants.POLICIES || [],
    POLICY_CATEGORIES: constants.POLICY_CATEGORIES || {},
    CATEGORY_FIELDS: constants.CATEGORY_FIELDS || {},
    POLICY_EXTRA_FIELDS: constants.POLICY_EXTRA_FIELDS || {},
    LICENSE_LABELS: constants.LICENSE_LABELS || {},
    LICENSE_SHORT: constants.LICENSE_SHORT || {},
    LICENSE_PLANS: constants.LICENSE_PLANS || {},
    BASELINES: baselines,
  }
  return _catalog
}

// Default config for a policy — the same defaults the Configure step starts
// with (category fields + per-policy extra fields).
function defaultConfigFor(policy) {
  const { CATEGORY_FIELDS, POLICY_EXTRA_FIELDS } = getCatalog()
  const config = {}
  const fields = [
    ...(CATEGORY_FIELDS[policy.category] || []),
    ...(POLICY_EXTRA_FIELDS[policy.id] || []),
  ]
  for (const f of fields) {
    if (f.type === 'callout') continue
    if (f.default !== undefined) config[f.key] = f.default
  }
  return config
}

module.exports = { getCatalog, defaultConfigFor }
