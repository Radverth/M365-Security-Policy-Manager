import React, { useState } from 'react'
import { POLICIES, CATEGORY_FIELDS, POLICY_EXTRA_FIELDS } from '../../shared/constants'

// Merge category defaults + policy-specific extra fields
function getFields(policy) {
  const base   = CATEGORY_FIELDS[policy.category] || []
  const extras = POLICY_EXTRA_FIELDS[policy.id]   || []
  return [...base, ...extras]
}

function getDefaults(policy) {
  return Object.fromEntries(getFields(policy).map(f => [f.key, f.default ?? '']))
}

// Single field renderer
function FieldInput({ field, value, onChange }) {
  const cls = 'block w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy'

  if (field.type === 'callout') {
    return (
      <div className="col-span-2 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
        <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <p className="text-xs text-amber-800 leading-relaxed">{field.text}</p>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls}>
        {(field.options || []).map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={value}
        min={field.min}
        max={field.max}
        onChange={e => onChange(e.target.value)}
        className={cls}
      />
    )
  }
  return (
    <input
      type="text"
      value={value}
      placeholder={field.hint || ''}
      onChange={e => onChange(e.target.value)}
      className={cls}
    />
  )
}

// One policy row (collapsed by default, expand to edit fields)
function PolicyRow({ policy, config, onChange }) {
  const [open, setOpen] = useState(false)
  const fields = getFields(policy)
  const state = config.state || fields.find(f => f.key === 'state')?.default || 'enabled'

  const stateColour = {
    enabled: 'text-green-700 bg-green-50 border-green-200',
    disabled: 'text-gray-500 bg-gray-50 border-gray-200',
    enabledForReportingButNotEnforced: 'text-amber-700 bg-amber-50 border-amber-200',
  }[state] || 'text-gray-500 bg-gray-50 border-gray-200'

  const stateLabel = {
    enabled: 'Enabled',
    disabled: 'Disabled',
    enabledForReportingButNotEnforced: 'Report Only',
  }[state] || state

  // Count non-default, non-state customisations
  const customCount = fields.filter(f => f.key !== 'state' && f.type !== 'callout' && config[f.key] !== undefined && config[f.key] !== (f.default ?? '')).length

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{policy.id}</span>
        <span className="text-sm text-gray-800 flex-1">{policy.name}</span>
        {customCount > 0 && (
          <span className="text-xs bg-navy text-white rounded-full px-2 py-0.5">{customCount} custom</span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${stateColour}`}>
          {stateLabel}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-3">
          <p className="text-xs text-gray-500 mb-2">{policy.description}</p>
          <div className="grid grid-cols-2 gap-3">
            {fields.map(field => (
              <div key={field.key} className={field.type === 'callout' || (field.type === 'text' && !field.options && fields.length <= 2) ? 'col-span-2' : ''}>
                {field.type !== 'callout' && <label className="block text-xs font-medium text-gray-600 mb-1">{field.label}</label>}
                <FieldInput
                  field={field}
                  value={config[field.key] ?? (field.default ?? '')}
                  onChange={val => onChange({ ...config, [field.key]: val })}
                />
                {field.hint && (
                  <p className="mt-1 text-xs text-gray-400">{field.hint}</p>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => onChange(getDefaults(policy))}
            className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  )
}

export default function ConfigurePolicies({ selectedIds, policyConfigs, setPolicyConfigs }) {
  const [search, setSearch] = useState('')
  const [expandedCategory, setExpandedCategory] = useState(null)

  const selectedPolicies = POLICIES.filter(p => selectedIds.includes(p.id))

  // Group by category
  const byCategory = selectedPolicies.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})

  const filteredCategories = Object.fromEntries(
    Object.entries(byCategory).map(([cat, policies]) => [
      cat,
      policies.filter(p =>
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.id.toLowerCase().includes(search.toLowerCase())
      )
    ]).filter(([, ps]) => ps.length > 0)
  )

  function getConfig(policy) {
    if (policyConfigs[policy.id]) return policyConfigs[policy.id]
    return getDefaults(policy)
  }

  function setConfig(policyId, config) {
    setPolicyConfigs(prev => ({ ...prev, [policyId]: config }))
  }

  function resetAll() {
    setPolicyConfigs({})
  }

  // Count policies with non-default config
  const customisedCount = selectedPolicies.filter(p => {
    const cfg = policyConfigs[p.id]
    if (!cfg) return false
    const defaults = getDefaults(p)
    return Object.entries(cfg).some(([k, v]) => v !== defaults[k])
  }).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search policies..."
            className="rounded border border-gray-300 px-3 py-1.5 text-sm w-56 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
          {customisedCount > 0 && (
            <span className="text-xs text-navy font-medium">{customisedCount} customised</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetAll}
            className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
          >
            Reset all to defaults
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Expand any policy to configure its parameters — state, who it applies to, exclusions, and policy-specific settings. Defaults are pre-filled based on best practice.
      </div>

      <div className="max-h-[440px] overflow-y-auto space-y-3 pr-1">
        {Object.entries(filteredCategories).map(([cat, policies]) => {
          const isExpanded = expandedCategory === null || expandedCategory === cat
          const catCustomised = policies.filter(p => {
            const cfg = policyConfigs[p.id]
            if (!cfg) return false
            const defaults = getDefaults(p)
            return Object.entries(cfg).some(([k, v]) => v !== defaults[k])
          }).length

          return (
            <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">{cat}</span>
                  <span className="text-xs bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">{policies.length}</span>
                  {catCustomised > 0 && (
                    <span className="text-xs bg-navy text-white rounded-full px-2 py-0.5">{catCustomised} custom</span>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expandedCategory !== cat ? '' : 'rotate-180'}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expandedCategory === cat && (
                <div className="divide-y divide-gray-100">
                  {policies.map(p => (
                    <PolicyRow
                      key={p.id}
                      policy={p}
                      config={getConfig(p)}
                      onChange={cfg => setConfig(p.id, cfg)}
                    />
                  ))}
                </div>
              )}

              {expandedCategory !== cat && (
                <div className="px-4 py-2 text-xs text-gray-400">
                  {policies.map(p => p.id).join(', ')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { getDefaults }
