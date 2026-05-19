import React, { useState, useEffect } from 'react'
import useStore from '../store'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import Modal from '../components/Modal'
import SlideOver from '../components/SlideOver'
import SearchInput from '../components/SearchInput'
import DeviceCodeModal, { parseDeviceCode } from '../components/DeviceCodeModal'

// Handle PascalCase (PS) and camelCase (Graph API) property names
function pick(obj, ...keys) {
  if (!obj) return undefined
  for (const k of keys) { if (obj[k] !== undefined) return obj[k] }
}

const GRANT_LABELS = {
  mfa: 'Require MFA', compliantDevice: 'Require compliant device',
  domainJoinedDevice: 'Require hybrid joined', approvedApplication: 'Require approved app',
  compliantApplication: 'Require app protection', passwordChange: 'Require password change',
  block: 'Block access',
}

function fmtUsers(u) {
  if (!u) return 'All Users'
  const inc = pick(u,'IncludeUsers','includeUsers') || []
  const incG = pick(u,'IncludeGroups','includeGroups') || []
  const excU = pick(u,'ExcludeUsers','excludeUsers') || []
  const excG = pick(u,'ExcludeGroups','excludeGroups') || []
  if (inc.includes('All') || inc.includes('all')) {
    const ex = [...(excU.length ? [`${excU.length} user(s) excl.`] : []), ...(excG.length ? [`${excG.length} group(s) excl.`] : [])]
    return ex.length ? `All Users (${ex.join(', ')})` : 'All Users'
  }
  const parts = [...(incG.length ? [`${incG.length} group(s)`] : []), ...(inc.length ? [`${inc.length} user(s)`] : [])]
  return parts.join(', ') || 'Specific users'
}

function fmtApps(a) {
  if (!a) return 'All Apps'
  const inc = pick(a,'IncludeApplications','includeApplications') || []
  const exc = pick(a,'ExcludeApplications','excludeApplications') || []
  if (inc.includes('All') || inc.includes('all')) return exc.length ? `All Apps (${exc.length} excl.)` : 'All Apps'
  return inc.length ? `${inc.length} app(s)` : 'Specific apps'
}

function fmtGrant(g) {
  if (!g) return '—'
  const controls = pick(g,'BuiltInControls','builtInControls') || []
  const op = pick(g,'Operator','operator') || 'OR'
  if (!controls.length) return '—'
  return controls.map(c => GRANT_LABELS[c] || c).join(` ${op} `)
}

function fmtSession(s) {
  if (!s) return null
  const parts = []
  const sf = pick(s,'SignInFrequency','signInFrequency')
  const pb = pick(s,'PersistentBrowser','persistentBrowser')
  if (sf?.IsEnabled || sf?.isEnabled) parts.push(`Sign-in frequency: ${sf.Value || sf.value}h`)
  if (pb?.IsEnabled || pb?.isEnabled) parts.push(`Persistent browser: ${pb.Mode || pb.mode}`)
  return parts.join(', ') || null
}

// Detect policies created by this tool: "CA001: ..." or "Prefix — CA001: ..."
function isToolManaged(displayName) {
  return /(?:^.+ — )?[A-Z]{2}\d{3}: /.test(displayName || '')
}

function stateBadge(state) {
  if (!state) return <Badge variant="neutral">Unknown</Badge>
  const s = state.toLowerCase()
  if (s === 'enabled') return <Badge variant="success">Enabled</Badge>
  if (s === 'disabled') return <Badge variant="neutral">Disabled</Badge>
  if (s.includes('report')) return <Badge variant="info">Report Only</Badge>
  return <Badge variant="neutral">{state}</Badge>
}

function formatDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString() } catch { return d }
}

// ── Policy editor ─────────────────────────────────────────────────────────────
function SummaryRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 px-4 py-2.5 text-sm">
      <span className="text-xs font-medium text-gray-500 w-32 flex-shrink-0 mt-0.5">{label}</span>
      <span className="text-xs text-gray-800 flex-1">{value}</span>
    </div>
  )
}

function PolicyEditor({ policy, onSave, onCancel, saving }) {
  const [name, setName] = React.useState(pick(policy,'DisplayName','displayName') || '')
  const [state, setState] = React.useState(pick(policy,'State','state') || 'enabled')

  const cond = pick(policy,'Conditions','conditions') || {}
  const sessionStr = fmtSession(pick(policy,'SessionControls','sessionControls'))
  const inputCls = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy'

  return (
    <div className="p-6 space-y-5">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
          <select className={inputCls} value={state} onChange={e => setState(e.target.value)}>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
            <option value="enabledForReportingButNotEnforced">Report Only</option>
          </select>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Policy conditions (read-only)</p>
        <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-100">
          <SummaryRow label="Users" value={fmtUsers(pick(cond,'Users','users'))} />
          <SummaryRow label="Applications" value={fmtApps(pick(cond,'Applications','applications'))} />
          <SummaryRow label="Grant Controls" value={fmtGrant(pick(policy,'GrantControls','grantControls'))} />
          {sessionStr && <SummaryRow label="Session Controls" value={sessionStr} />}
        </div>
        <p className="text-xs text-gray-400 mt-2">To change conditions or grant controls, edit in the Entra portal.</p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave({ DisplayName: name, State: state })} loading={saving}>
          Save Changes
        </Button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ManagePolicies() {
  const { addNotification, tenantSession, openConnectModal, clearTenantSession } = useStore()
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [managedOnly, setManagedOnly] = useState(false)
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [bulkAction, setBulkAction] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [deviceCodeInfo, setDeviceCodeInfo] = useState(null)

  useEffect(() => {
    if (!window.api) return
    const unOut = window.api.onPsOutput((line) => {
      const dc = parseDeviceCode(line)
      if (dc) setDeviceCodeInfo(dc)
      if (/connected\.|CONNECTED:|welcome to microsoft graph/i.test(line)) setDeviceCodeInfo(null)
    })
    const unDisc = window.api.onSessionDisconnected?.(() => {
      clearTenantSession()
      setPolicies([])
      setSelectedRows(new Set())
    })
    return () => { unOut?.(); unDisc?.() }
  }, [])

  const handleLoad = async () => {
    if (!window.api || !tenantSession) return
    setLoading(true)
    try {
      const result = await window.api.policies.list()
      if (result.error) { addNotification(result.error, 'error'); return }
      setPolicies(Array.isArray(result.policies) ? result.policies : [])
      setSelectedRows(new Set())
    } catch (err) {
      addNotification('Failed to load policies: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = () => {
    clearTenantSession()
    setPolicies([])
    setSelectedRows(new Set())
    window.api?.policies?.disconnect?.().catch(() => {})
  }

  const filtered = policies.filter((p) => {
    if (managedOnly && !isToolManaged(p.DisplayName)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (p.DisplayName || '').toLowerCase().includes(q) ||
      (p.State || '').toLowerCase().includes(q)
    )
  })

  const toggleRow = (id) => setSelectedRows((s) => {
    const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns
  })

  const toggleAll = () => {
    if (selectedRows.size === filtered.length) setSelectedRows(new Set())
    else setSelectedRows(new Set(filtered.map((p) => p.Id)))
  }

  const handleDelete = async () => {
    if (!window.api || !deleteTarget) return
    setDeleteLoading(true)
    try {
      await window.api.policies.delete(deleteTarget.Id)
      setPolicies((ps) => ps.filter((p) => p.Id !== deleteTarget.Id))
      addNotification('Policy deleted', 'success')
    } catch (err) {
      addNotification('Delete failed: ' + err.message, 'error')
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }

  const handleToggle = async (policy) => {
    if (!window.api) return
    const newState = policy.State === 'enabled' ? 'disabled' : 'enabled'
    try {
      await window.api.policies.toggleState(policy.Id, newState)
      setPolicies((ps) => ps.map((p) => p.Id === policy.Id ? { ...p, State: newState } : p))
      addNotification(`Policy ${newState}`, 'success')
    } catch (err) {
      addNotification('Toggle failed: ' + err.message, 'error')
    }
  }

  const handleBulk = async () => {
    if (!window.api || !bulkAction || selectedRows.size === 0) return
    setBulkLoading(true)
    const ids = [...selectedRows]
    try {
      if (bulkAction === 'delete') {
        await Promise.all(ids.map((id) => window.api.policies.delete(id)))
        setPolicies((ps) => ps.filter((p) => !selectedRows.has(p.Id)))
        addNotification(`${ids.length} policies deleted`, 'success')
      } else {
        await Promise.all(ids.map((id) => window.api.policies.toggleState(id, bulkAction)))
        setPolicies((ps) => ps.map((p) => selectedRows.has(p.Id) ? { ...p, State: bulkAction } : p))
        addNotification(`${ids.length} policies ${bulkAction}`, 'success')
      }
      setSelectedRows(new Set())
    } catch (err) {
      addNotification('Bulk action failed: ' + err.message, 'error')
    } finally {
      setBulkLoading(false)
      setBulkAction('')
    }
  }

  const handleEdit = (policy) => { setEditTarget(policy) }

  const handleSaveEdit = async (patch) => {
    if (!window.api || !editTarget) return
    setSaveLoading(true)
    try {
      await window.api.policies.update(editTarget.Id, patch)
      setPolicies(ps => ps.map(p => p.Id === editTarget.Id ? { ...p, ...patch } : p))
      addNotification('Policy updated', 'success')
      setEditTarget(null)
    } catch (err) {
      addNotification('Save failed: ' + err.message, 'error')
    } finally {
      setSaveLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Manage Policies</h1>
        <p className="mt-1 text-sm text-gray-500">View and manage Conditional Access policies for a connected tenant</p>
      </div>

      {/* Connection card */}
      <Card className="mb-6">
        <Card.Header>
          <h2 className="text-sm font-semibold text-gray-900">Tenant Connection</h2>
        </Card.Header>
        <Card.Body className="space-y-4">
          {tenantSession ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Connected</p>
                  <p className="text-sm font-semibold text-emerald-900">{tenantSession.Account}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" onClick={handleLoad} loading={loading}>
                  {policies.length > 0 ? 'Refresh' : 'Load Policies'}
                </Button>
                <Button size="sm" variant="secondary" onClick={openConnectModal}>Switch Account</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0" />
                <p className="text-sm text-gray-500">No tenant connected</p>
              </div>
              <Button size="sm" variant="primary" onClick={openConnectModal}>Connect Tenant</Button>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Toolbar */}
      {policies.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search policies..." className="w-72" />
            <button
              onClick={() => setManagedOnly(v => !v)}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                managedOnly
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400',
              ].join(' ')}
            >
              {managedOnly ? 'Managed by tool ✓' : 'All policies'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {selectedRows.size > 0 && (
              <>
                <span className="text-xs text-gray-500">{selectedRows.size} selected</span>
                <select
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                  className="rounded-md border border-gray-300 text-sm px-2 py-1.5 focus:border-navy focus:ring-1 focus:ring-navy"
                >
                  <option value="">Bulk action...</option>
                  <option value="enabled">Enable</option>
                  <option value="disabled">Disable</option>
                  <option value="delete">Delete</option>
                </select>
                <Button size="sm" variant="secondary" onClick={handleBulk} loading={bulkLoading} disabled={!bulkAction}>Apply</Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={handleLoad} loading={loading}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </Button>
          </div>
        </div>
      )}

      {/* Policy table */}
      <Card>
        {policies.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-12 h-12 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">
              {tenantSession ? 'Click "Load Policies" above to fetch policies.' : 'Connect to a tenant above to view its policies.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left w-8">
                    <input
                      type="checkbox"
                      checked={selectedRows.size === filtered.length && filtered.length > 0}
                      ref={(el) => { if (el) el.indeterminate = selectedRows.size > 0 && selectedRows.size < filtered.length }}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-navy"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Modified</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{[1,2,3,4,5,6].map((j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                    ))}</tr>
                  ))
                ) : filtered.map((policy) => {
                  const managed = isToolManaged(policy.DisplayName)
                  return (
                    <tr key={policy.Id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedRows.has(policy.Id)} onChange={() => toggleRow(policy.Id)} className="h-4 w-4 rounded border-gray-300 text-navy" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{policy.DisplayName}</span>
                          {!managed && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">External</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{policy.Id}</div>
                      </td>
                      <td className="px-4 py-3">{stateBadge(policy.State)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(policy.CreatedDateTime)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(policy.ModifiedDateTime)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end items-center gap-1">
                          {managed ? (
                            <button
                              onClick={() => handleEdit(policy)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Edit
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                const url = `https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/PolicyBlade/policyId/${policy.Id}`
                                window.api?.app?.openExternal(url)
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Open in Entra portal"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              Entra
                            </button>
                          )}
                          <button
                            onClick={() => handleToggle(policy)}
                            className={[
                              'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                              policy.State === 'enabled'
                                ? 'text-amber-600 hover:bg-amber-50'
                                : 'text-emerald-600 hover:bg-emerald-50',
                            ].join(' ')}
                          >
                            {policy.State === 'enabled' ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(policy)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        variant="danger"
        title="Delete Policy"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        loading={deleteLoading}
      >
        <p className="py-2">
          Are you sure you want to delete <strong>{deleteTarget?.DisplayName}</strong>? This cannot be undone.
        </p>
      </Modal>

      <SlideOver open={!!editTarget} onClose={() => setEditTarget(null)} title={editTarget ? `Edit: ${editTarget.DisplayName}` : 'Edit Policy'}>
        <PolicyEditor
          policy={editTarget}
          onSave={handleSaveEdit}
          onCancel={() => setEditTarget(null)}
          saving={saveLoading}
        />
      </SlideOver>

      <DeviceCodeModal info={deviceCodeInfo} onDismiss={() => setDeviceCodeInfo(null)} />
    </div>
  )
}
