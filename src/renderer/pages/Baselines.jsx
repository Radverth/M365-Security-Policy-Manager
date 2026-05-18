import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { POLICIES } from '../../shared/constants'
import { BASELINES } from '../data/baselines'
import Badge from '../components/Badge'
import Button from '../components/Button'
import Modal from '../components/Modal'

const POLICY_INDEX = Object.fromEntries(POLICIES.map((p) => [p.id, p]))

function categoryBreakdown(policyIds) {
  const counts = {}
  policyIds.forEach((id) => {
    const p = POLICY_INDEX[id]
    if (!p) return
    counts[p.category] = (counts[p.category] || 0) + 1
  })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3 inline-block ml-0.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

function BaselineDetailModal({ baseline, open, onClose, onApply }) {
  if (!baseline) return null
  const policies = baseline.policyIds.map((id) => POLICY_INDEX[id]).filter(Boolean)
  const breakdown = categoryBreakdown(baseline.policyIds)
  const criticalCount = policies.filter((p) => p.severity === 'critical').length

  return (
    <Modal open={open} onClose={onClose} title={baseline.name} size="lg">
      <div className="space-y-5 py-1">

        {/* Source reference — prominent */}
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${baseline.color.card}`}>
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-0.5">Source</p>
            <p className="text-sm font-semibold text-gray-900">{baseline.source}</p>
            <button
              onClick={() => window.api?.app?.openExternal(baseline.sourceUrl)}
              className="text-xs text-blue-600 hover:underline mt-0.5"
            >
              {baseline.sourceLabel}
              <ExternalLinkIcon />
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-700">{baseline.description}</p>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{baseline.policyIds.length}</p>
            <p className="text-xs text-gray-500">Total policies</p>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center">
            <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
            <p className="text-xs text-gray-500">Critical severity</p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{breakdown.length}</p>
            <p className="text-xs text-gray-500">Policy categories</p>
          </div>
        </div>

        {/* Category breakdown */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Coverage by category</p>
          <div className="space-y-1.5">
            {breakdown.map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-44 flex-shrink-0 truncate">{cat}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${baseline.color.accent}`}
                    style={{ width: `${Math.min(100, (count / 10) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-500 w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Full policy list */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Included policies</p>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
            {policies.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                <span className="text-xs font-mono text-gray-400 w-12 flex-shrink-0">{p.id}</span>
                <span className="text-xs text-gray-700 flex-1">{p.name}</span>
                <Badge variant={{ critical: 'error', high: 'high', medium: 'warning', low: 'info', info: 'neutral' }[p.severity] || 'neutral'}>
                  {p.severity}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => { onClose(); onApply(baseline) }}>
            Apply this Baseline
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function Baselines() {
  const navigate = useNavigate()
  const [detail, setDetail] = useState(null)

  function handleApply(baseline) {
    // Store selected policy IDs in sessionStorage so CreatePolicies can pick them up
    sessionStorage.setItem('baseline-policyIds', JSON.stringify(baseline.policyIds))
    sessionStorage.setItem('baseline-name', baseline.name)
    navigate('/create')
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Security Baselines</h1>
        <p className="mt-1 text-sm text-gray-500">
          Industry-standard policy sets from authoritative sources. Apply a baseline to pre-select policies in the Create wizard.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {BASELINES.map((baseline) => {
          const breakdown = categoryBreakdown(baseline.policyIds)
          const topCats = breakdown.slice(0, 3)

          return (
            <div
              key={baseline.id}
              className={`rounded-xl border-2 p-5 flex flex-col gap-4 ${baseline.color.card}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-gray-900 leading-tight">{baseline.name}</h2>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{baseline.subtitle}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${baseline.color.badge}`}>
                  {baseline.policyIds.length} policies
                </span>
              </div>

              {/* Source reference */}
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <button
                  onClick={() => window.api?.app?.openExternal(baseline.sourceUrl)}
                  className={`text-xs font-medium px-2 py-0.5 rounded-full hover:opacity-80 transition-opacity ${baseline.color.source}`}
                >
                  {baseline.source}
                  <ExternalLinkIcon />
                </button>
              </div>

              {/* Description */}
              <p className="text-sm text-gray-700 leading-relaxed line-clamp-3">{baseline.description}</p>

              {/* Highlights */}
              <ul className="space-y-1">
                {baseline.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2 text-xs text-gray-700">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {h}
                  </li>
                ))}
              </ul>

              {/* Category mini-breakdown */}
              <div className="flex flex-wrap gap-1.5">
                {topCats.map(([cat, count]) => (
                  <span key={cat} className="text-xs bg-white/70 border border-gray-200 rounded px-2 py-0.5 text-gray-600">
                    {cat.split(' ')[0]} <span className="font-semibold">{count}</span>
                  </span>
                ))}
                {breakdown.length > 3 && (
                  <span className="text-xs bg-white/70 border border-gray-200 rounded px-2 py-0.5 text-gray-400">
                    +{breakdown.length - 3} more
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-auto pt-1">
                <Button variant="ghost" size="sm" onClick={() => setDetail(baseline)}>
                  View details
                </Button>
                <Button variant="primary" size="sm" onClick={() => handleApply(baseline)}>
                  Apply Baseline
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <BaselineDetailModal
        baseline={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onApply={handleApply}
      />
    </div>
  )
}
