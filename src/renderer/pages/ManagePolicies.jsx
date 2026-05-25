import React, { useState, useEffect } from 'react'
import useStore from '../store'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'
import Modal from '../components/Modal'
import SearchInput from '../components/SearchInput'
import EntityPicker from '../components/EntityPicker'

// Handle PascalCase (PS) and camelCase (Graph API) property names
function pick(obj, ...keys) {
  if (!obj) return undefined
  for (const k of keys) { if (obj[k] !== undefined) return obj[k] }
}

// Recursively convert PascalCase keys to camelCase and strip PS SDK metadata
// (AdditionalProperties, BackingStore, @-prefixed OData keys) before sending to Graph.
const _STRIP_KEYS = new Set(['AdditionalProperties', 'BackingStore'])
function cleanForGraph(v) {
  if (Array.isArray(v)) return v.map(cleanForGraph)
  if (v && typeof v === 'object') {
    // AdditionalProperties holds Graph OData metadata (e.g. @odata.type for polymorphic
    // types like ExternalTenants). Merge its contents in rather than discarding them.
    const extra = (v.AdditionalProperties && typeof v.AdditionalProperties === 'object')
      ? v.AdditionalProperties : {}
    const cleaned = Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !_STRIP_KEYS.has(k) && !k.startsWith('@'))
        .map(([k, val]) => [k.charAt(0).toLowerCase() + k.slice(1), cleanForGraph(val)])
        .filter(([, val]) => val !== null && val !== undefined)
    )
    return { ...cleaned, ...extra }
  }
  return v
}

// Build a safe, explicit Graph API conditions object by extracting only known fields
// using pick() for PascalCase/camelCase tolerance. Avoids AdditionalProperties
// corruption that cleanForGraph causes at the conditions level.
function buildGraphConditions(rawCond, usersOverride) {
  const result = { users: usersOverride }

  const apps = pick(rawCond, 'Applications', 'applications')
  if (apps) {
    const a = {}
    const incA = pick(apps, 'IncludeApplications', 'includeApplications')
    if (incA) a.includeApplications = incA
    const excA = pick(apps, 'ExcludeApplications', 'excludeApplications')
    if (excA) a.excludeApplications = excA
    const ua = pick(apps, 'IncludeUserActions', 'includeUserActions')
    if (ua) a.includeUserActions = ua
    const authCtx = pick(apps, 'IncludeAuthenticationContextClassReferences', 'includeAuthenticationContextClassReferences')
    if (authCtx) a.includeAuthenticationContextClassReferences = authCtx
    const appFilter = pick(apps, 'ApplicationFilter', 'applicationFilter')
    if (appFilter) a.applicationFilter = { mode: pick(appFilter, 'Mode', 'mode'), rule: pick(appFilter, 'Rule', 'rule') }
    result.applications = a
  }

  const cat = pick(rawCond, 'ClientAppTypes', 'clientAppTypes')
  if (cat) result.clientAppTypes = cat

  const plat = pick(rawCond, 'Platforms', 'platforms')
  if (plat) {
    const p = {}
    const incP = pick(plat, 'IncludePlatforms', 'includePlatforms')
    if (incP) p.includePlatforms = incP
    const excP = pick(plat, 'ExcludePlatforms', 'excludePlatforms')
    if (excP) p.excludePlatforms = excP
    result.platforms = p
  }

  const loc = pick(rawCond, 'Locations', 'locations')
  if (loc) {
    const l = {}
    const incL = pick(loc, 'IncludeLocations', 'includeLocations')
    if (incL) l.includeLocations = incL
    const excL = pick(loc, 'ExcludeLocations', 'excludeLocations')
    if (excL) l.excludeLocations = excL
    result.locations = l
  }

  const srl = pick(rawCond, 'SignInRiskLevels', 'signInRiskLevels')
  if (srl) result.signInRiskLevels = srl

  const url = pick(rawCond, 'UserRiskLevels', 'userRiskLevels')
  if (url) result.userRiskLevels = url

  const sprl = pick(rawCond, 'ServicePrincipalRiskLevels', 'servicePrincipalRiskLevels')
  if (sprl) result.servicePrincipalRiskLevels = sprl

  const dev = pick(rawCond, 'Devices', 'devices')
  if (dev) {
    const df = pick(dev, 'DeviceFilter', 'deviceFilter')
    if (df) result.devices = { deviceFilter: { mode: pick(df, 'Mode', 'mode'), rule: pick(df, 'Rule', 'rule') } }
  }

  return result
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

const GRANT_OPTIONS = [
  { value: 'mfa',                  label: 'Require MFA' },
  { value: 'compliantDevice',      label: 'Require Compliant Device' },
  { value: 'domainJoinedDevice',   label: 'Require Hybrid AD Join' },
  { value: 'approvedApplication',  label: 'Require Approved App' },
  { value: 'compliantApplication', label: 'Require App Protection' },
  { value: 'passwordChange',       label: 'Require Password Change' },
  { value: 'block',                label: 'Block Access' },
]

function PolicyEditor({ policy, onSave, onCancel, saving, noSession }) {
  const [name, setName] = React.useState(pick(policy,'DisplayName','displayName') || '')
  const [state, setState] = React.useState(pick(policy,'State','state') || 'enabled')

  const cond     = pick(policy,'Conditions','conditions') || {}
  const condUsers = pick(cond,'Users','users') || {}
  const grant    = pick(policy,'GrantControls','grantControls') || {}
  const hasAuthStrength = !!(pick(grant,'AuthenticationStrength','authenticationStrength'))

  // Existing exclusions — pre-populate as { id } objects (display names resolved via search)
  const initExcGrps  = (pick(condUsers,'ExcludeGroups','excludeGroups') || []).map(id => ({ id, displayName: id }))
  const initExcUsers = (pick(condUsers,'ExcludeUsers','excludeUsers') || []).map(id => ({ id, displayName: id }))
  const initControls = new Set(pick(grant,'BuiltInControls','builtInControls') || [])
  const initOperator = pick(grant,'Operator','operator') || 'OR'

  const [excludeGroups,   setExcludeGroups]   = React.useState(initExcGrps)
  const [excludeUsers,    setExcludeUsers]     = React.useState(initExcUsers)
  const [selectedControls,setSelectedControls] = React.useState(initControls)
  const [operator,        setOperator]         = React.useState(initOperator)

  const sessionStr = fmtSession(pick(policy,'SessionControls','sessionControls'))
  const inputCls   = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy'

  const toggleControl = (ctrl) => setSelectedControls(s => {
    const ns = new Set(s); ns.has(ctrl) ? ns.delete(ctrl) : ns.add(ctrl); return ns
  })

  const handleSave = () => {
    const excGrpIds  = excludeGroups.map(g => g.id)
    const excUserIds = excludeUsers.map(u => u.id)

    // Preserve existing user inclusions so the PATCH doesn't wipe them
    const incUsers  = pick(condUsers,'IncludeUsers','includeUsers') || []
    const incGroups = pick(condUsers,'IncludeGroups','includeGroups') || []
    const incRoles  = pick(condUsers,'IncludeRoles','includeRoles') || []
    const excRoles  = pick(condUsers,'ExcludeRoles','excludeRoles') || []
    const incGuests = pick(condUsers,'IncludeGuestsOrExternalUsers','includeGuestsOrExternalUsers')

    const usersObj = {}
    if (incUsers.length)  usersObj.includeUsers  = incUsers
    if (incGroups.length) usersObj.includeGroups = incGroups
    if (incRoles.length)  usersObj.includeRoles  = incRoles
    if (excRoles.length)  usersObj.excludeRoles  = excRoles
    if (incGuests)        usersObj.includeGuestsOrExternalUsers = cleanForGraph(incGuests)
    if (excGrpIds.length)  usersObj.excludeGroups = excGrpIds
    if (excUserIds.length) usersObj.excludeUsers  = excUserIds

    const patch = {
      displayName: name,
      state,
      conditions: buildGraphConditions(cond, usersObj),
    }

    if (!hasAuthStrength) {
      patch.grantControls = selectedControls.size > 0
        ? { operator, builtInControls: [...selectedControls] }
        : null
    }

    onSave(patch)
  }

  return (
    <div className="pt-2 pb-4 space-y-5">
      {/* ── Name & State ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
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

      {/* ── Grant Controls ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Grant Controls</p>
        {hasAuthStrength ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            This policy uses an Authentication Strength — edit grant controls in the Entra portal.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
              {GRANT_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedControls.has(opt.value)}
                    onChange={() => toggleControl(opt.value)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-navy"
                  />
                  <span className="text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
            {selectedControls.size > 1 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-500">Require</span>
                <select
                  className="text-xs rounded border border-gray-300 px-2 py-1 focus:border-navy focus:outline-none"
                  value={operator}
                  onChange={e => setOperator(e.target.value)}
                >
                  <option value="OR">any one of the selected (OR)</option>
                  <option value="AND">all of the selected (AND)</option>
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── User Exclusions ──────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Exclusions</p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Exclude Groups</label>
            <EntityPicker
              type="groups"
              selected={excludeGroups}
              onChange={setExcludeGroups}
              noSession={noSession}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Exclude Users</label>
            <EntityPicker
              type="users"
              selected={excludeUsers}
              onChange={setExcludeUsers}
              noSession={noSession}
            />
          </div>
        </div>
      </div>

      {/* ── Read-only summary ────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Other Conditions (read-only)</p>
        <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-100">
          <SummaryRow label="Users" value={fmtUsers(condUsers)} />
          <SummaryRow label="Applications" value={fmtApps(pick(cond,'Applications','applications'))} />
          {sessionStr && <SummaryRow label="Session Controls" value={sessionStr} />}
        </div>
        <p className="text-xs text-gray-400 mt-2">To change user inclusions, applications, or session controls, edit in the Entra portal.</p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Save Changes
        </Button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ManagePolicies() {
  const { addNotification, tenantSession, openConnectModal, openSwitchModal } = useStore()
  const [connectedAs, setConnectedAs] = useState(null)
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
  // Effective connection: prefer local connectedAs, fall back to global session
  const effectiveSession = connectedAs || tenantSession

  const handleLoad = async () => {
    if (!window.api) return
    setLoading(true)
    try {
      const result = await window.api.policies.list()
      if (result?.error) {
        addNotification('Failed to load policies: ' + result.error, 'error')
        return
      }
      const { policies: loadedPolicies = [], context = null } = result || {}
      setPolicies(Array.isArray(loadedPolicies) ? loadedPolicies : [])
      setSelectedRows(new Set())
      if (context) setConnectedAs(context)
    } catch (err) {
      addNotification('Failed to load policies: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Auto-load policies when the global tenant session is available
  useEffect(() => {
    if (tenantSession && !connectedAs && policies.length === 0 && !loading) {
      handleLoad()
    }
  }, [tenantSession])  // eslint-disable-line react-hooks/exhaustive-deps

  // Clear local state when the global session is disconnected
  useEffect(() => {
    if (!tenantSession) {
      setConnectedAs(null)
      setPolicies([])
      setSelectedRows(new Set())
    }
  }, [tenantSession])

  const handleSwitchTenant = () => openSwitchModal()

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
      await window.api.policies.delete(deleteTarget.Id, connectedAs?.TenantId)
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
      await window.api.policies.toggleState(policy.Id, newState, connectedAs?.TenantId)
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
        await Promise.all(ids.map((id) => window.api.policies.delete(id, connectedAs?.TenantId)))
        setPolicies((ps) => ps.filter((p) => !selectedRows.has(p.Id)))
        addNotification(`${ids.length} policies deleted`, 'success')
      } else {
        await Promise.all(ids.map((id) => window.api.policies.toggleState(id, bulkAction, connectedAs?.TenantId)))
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
      const result = await window.api.policies.update(editTarget.Id, patch)
      setPolicies(ps => ps.map(p => {
        if (p.Id !== editTarget.Id) return p
        // Use the authoritative Graph response body if returned; fall back to optimistic update
        if (result?.policy && Object.keys(result.policy).length > 0) return result.policy
        return {
          ...p,
          ...(patch.displayName !== undefined && { DisplayName: patch.displayName }),
          ...(patch.state       !== undefined && { State: patch.state }),
          ...(patch.conditions  !== undefined && { Conditions: { ...p.Conditions, ...patch.conditions } }),
          ...(patch.grantControls !== undefined && { GrantControls: patch.grantControls }),
        }
      }))
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
          {effectiveSession ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse" />
                <div>
                  <p className="text-xs font-medium text-emerald-600 uppercase tracking-wide">Connected</p>
                  <p className="text-sm font-semibold text-emerald-900">{effectiveSession.Account}</p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={handleSwitchTenant}>
                Switch Tenant
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-blue-900">No tenant connected</p>
                <p className="text-xs text-blue-700 mt-0.5">Use the sidebar or the button below to sign in to a tenant.</p>
              </div>
              <Button variant="primary" size="sm" onClick={openConnectModal}>Connect Tenant</Button>
            </div>
          )}
          {loading && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p className="font-medium mb-1">Loading policies…</p>
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
            <p className="text-sm">Connect to a tenant above to view its policies.</p>
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
                      <td className="px-6 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(policy)}>Edit</Button>
                          {!managed && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const url = `https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/PolicyBlade/policyId/${policy.Id}`
                                window.api?.app?.openExternal(url)
                              }}
                            >
                              ↗
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => handleToggle(policy)}>
                            {policy.State === 'enabled' ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(policy)}>
                            <span className="text-red-600">Delete</span>
                          </Button>
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

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Edit: ${editTarget.DisplayName || editTarget.displayName}` : 'Edit Policy'}
        size="xl"
      >
        <PolicyEditor
          policy={editTarget}
          onSave={handleSaveEdit}
          onCancel={() => setEditTarget(null)}
          saving={saveLoading}
          noSession={!effectiveSession}
        />
      </Modal>
    </div>
  )
}
