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
// Empty arrays and empty/incomplete sub-objects are omitted so Graph doesn't reject them.
function buildGraphConditions(rawCond, usersOverride) {
  const result = { users: usersOverride }
  const arr = (v) => (Array.isArray(v) && v.length > 0 ? v : null)

  const apps = pick(rawCond, 'Applications', 'applications')
  if (apps) {
    const a = {}
    const incA = arr(pick(apps, 'IncludeApplications', 'includeApplications'))
    if (incA) a.includeApplications = incA
    const excA = arr(pick(apps, 'ExcludeApplications', 'excludeApplications'))
    if (excA) a.excludeApplications = excA
    const ua = arr(pick(apps, 'IncludeUserActions', 'includeUserActions'))
    if (ua) a.includeUserActions = ua
    const authCtx = arr(pick(apps, 'IncludeAuthenticationContextClassReferences', 'includeAuthenticationContextClassReferences'))
    if (authCtx) a.includeAuthenticationContextClassReferences = authCtx
    const appFilter = pick(apps, 'ApplicationFilter', 'applicationFilter')
    if (appFilter) {
      const mode = pick(appFilter, 'Mode', 'mode')
      const rule = pick(appFilter, 'Rule', 'rule')
      if (mode && rule) a.applicationFilter = { mode, rule }
    }
    if (Object.keys(a).length) result.applications = a
  }

  const cat = arr(pick(rawCond, 'ClientAppTypes', 'clientAppTypes'))
  if (cat) result.clientAppTypes = cat

  const plat = pick(rawCond, 'Platforms', 'platforms')
  if (plat) {
    const p = {}
    const incP = arr(pick(plat, 'IncludePlatforms', 'includePlatforms'))
    if (incP) p.includePlatforms = incP
    const excP = arr(pick(plat, 'ExcludePlatforms', 'excludePlatforms'))
    if (excP) p.excludePlatforms = excP
    if (Object.keys(p).length) result.platforms = p
  }

  const loc = pick(rawCond, 'Locations', 'locations')
  if (loc) {
    const l = {}
    const incL = arr(pick(loc, 'IncludeLocations', 'includeLocations'))
    if (incL) l.includeLocations = incL
    const excL = arr(pick(loc, 'ExcludeLocations', 'excludeLocations'))
    if (excL) l.excludeLocations = excL
    if (Object.keys(l).length) result.locations = l
  }

  const srl = arr(pick(rawCond, 'SignInRiskLevels', 'signInRiskLevels'))
  if (srl) result.signInRiskLevels = srl

  const url = arr(pick(rawCond, 'UserRiskLevels', 'userRiskLevels'))
  if (url) result.userRiskLevels = url

  const sprl = arr(pick(rawCond, 'ServicePrincipalRiskLevels', 'servicePrincipalRiskLevels'))
  if (sprl) result.servicePrincipalRiskLevels = sprl

  const dev = pick(rawCond, 'Devices', 'devices')
  if (dev) {
    const df = pick(dev, 'DeviceFilter', 'deviceFilter')
    if (df) {
      const mode = pick(df, 'Mode', 'mode')
      const rule = pick(df, 'Rule', 'rule')
      if (mode && rule) result.devices = { deviceFilter: { mode, rule } }
    }
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

// ── Backup helpers ────────────────────────────────────────────────────────────

const TRIGGER_META = {
  login:        { label: 'Login',       cls: 'bg-blue-100 text-blue-700' },
  'pre-edit':   { label: 'Pre-Edit',    cls: 'bg-amber-100 text-amber-700' },
  'pre-delete': { label: 'Pre-Delete',  cls: 'bg-red-100 text-red-700' },
  manual:       { label: 'Manual',      cls: 'bg-gray-100 text-gray-600' },
}

function fmtBackupTime(ts) {
  if (!ts) return null
  try {
    const diffMins = Math.floor((Date.now() - new Date(ts)) / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return new Date(ts).toLocaleDateString()
  } catch { return null }
}

function fmtFullTs(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return ts }
}

function TriggerBadge({ trigger }) {
  const meta = TRIGGER_META[trigger] || { label: trigger || 'Unknown', cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

// ── Backup/Restore modal ──────────────────────────────────────────────────────
function BackupRestoreModal({ open, onClose }) {
  const { addNotification } = useStore()
  const [backups, setBackups] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [selectedBackup, setSelectedBackup] = useState(null)
  const [loadingBackup, setLoadingBackup] = useState(false)
  const [selectedPolicies, setSelectedPolicies] = useState(new Set())
  const [restoring, setRestoring] = useState(false)
  const [view, setView] = useState('list')

  useEffect(() => {
    if (open) {
      setView('list')
      setSelectedBackup(null)
      setSelectedPolicies(new Set())
      fetchBackups()
    }
  }, [open])

  const fetchBackups = async () => {
    if (!window.api?.backup) return
    setLoadingList(true)
    try {
      const result = await window.api.backup.list()
      setBackups(result.success ? (result.backups || []) : [])
    } finally {
      setLoadingList(false)
    }
  }

  const handleViewBackup = async (backup) => {
    setLoadingBackup(true)
    try {
      const result = await window.api.backup.get(backup.filename)
      if (result.success && result.data) {
        setSelectedBackup(result.data)
        setSelectedPolicies(new Set((result.data.policies || []).map(p => p.Id || p.id)))
        setView('detail')
      } else {
        addNotification('Failed to load backup', 'error')
      }
    } finally {
      setLoadingBackup(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedBackup || selectedPolicies.size === 0) return
    setRestoring(true)
    const toRestore = (selectedBackup.policies || []).filter(p => selectedPolicies.has(p.Id || p.id))
    let successCount = 0
    const failedNames = []
    for (const policy of toRestore) {
      const result = await window.api.backup.restore(policy)
      if (result.success) {
        successCount++
      } else {
        failedNames.push(policy.DisplayName || policy.displayName || 'Unknown policy')
      }
    }
    if (successCount > 0) {
      addNotification(`Restored ${successCount} polic${successCount === 1 ? 'y' : 'ies'} successfully`, 'success')
    }
    if (failedNames.length > 0) {
      addNotification(`Failed to restore: ${failedNames.join(', ')}`, 'error')
    }
    setRestoring(false)
    if (failedNames.length === 0) onClose()
  }

  const handleDeleteBackup = async (backup, e) => {
    e.stopPropagation()
    if (!window.api?.backup) return
    await window.api.backup.delete(backup.filename)
    setBackups(bs => bs.filter(b => b.filename !== backup.filename))
  }

  const togglePolicy = (id) => {
    setSelectedPolicies(prev => {
      const ns = new Set(prev)
      ns.has(id) ? ns.delete(id) : ns.add(id)
      return ns
    })
  }

  const allPolicyIds = (selectedBackup?.policies || []).map(p => p.Id || p.id)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={view === 'list' ? 'Policy Backups' : 'Restore Policies from Backup'}
      size="xl"
    >
      {view === 'list' ? (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-gray-500">
            Backups are created automatically before edits, deletions, and when policies are first loaded from a tenant.
          </p>

          {loadingList ? (
            <div className="py-10 flex items-center justify-center gap-2 text-gray-400 text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Loading backups…
            </div>
          ) : backups.length === 0 ? (
            <div className="py-10 flex flex-col items-center text-gray-400">
              <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              <p className="text-sm font-medium">No backups yet</p>
              <p className="text-xs text-gray-300 mt-1">Load policies to create your first automatic backup</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {backups.map(backup => (
                <div
                  key={backup.filename}
                  className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <TriggerBadge trigger={backup.trigger} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{fmtFullTs(backup.timestamp)}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {backup.policyCount} polic{backup.policyCount !== 1 ? 'ies' : 'y'}
                        {backup.account && backup.account !== 'unknown' && ` · ${backup.account}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleViewBackup(backup)}
                      loading={loadingBackup}
                    >
                      View &amp; Restore
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => handleDeleteBackup(backup, e)}>
                      <span className="text-red-500 text-xs">Delete</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between items-center pt-3 border-t border-gray-100 mt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.api?.backup?.openDir()}
            >
              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Open Backup Folder
            </Button>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        /* Detail / restore view */
        <div className="space-y-3 pt-1">
          {/* Back + backup info */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setView('list')}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to all backups
            </button>
            <div className="flex items-center gap-2">
              <TriggerBadge trigger={selectedBackup?.trigger} />
              <span className="text-xs text-gray-400">{fmtFullTs(selectedBackup?.timestamp)}</span>
            </div>
          </div>

          {/* Warning */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs text-amber-800">
              Restoring creates <strong>new copies</strong> of the selected policies in the current connected tenant. Original policy IDs are not preserved.
            </p>
          </div>

          {/* Select all / none */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500">
              {selectedPolicies.size} of {allPolicyIds.length} selected
            </span>
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedPolicies(new Set(allPolicyIds))}
                className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
              >
                Select all
              </button>
              <button
                onClick={() => setSelectedPolicies(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Policy checklist */}
          <div className="rounded-lg border border-gray-200 overflow-hidden max-h-72 overflow-y-auto">
            {(selectedBackup?.policies || []).map((policy, idx) => {
              const id = policy.Id || policy.id
              const name = policy.DisplayName || policy.displayName || 'Unnamed policy'
              const state = policy.State || policy.state
              return (
                <label
                  key={id || idx}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedPolicies.has(id)}
                    onChange={() => togglePolicy(id)}
                    className="h-4 w-4 rounded border-gray-300 text-navy flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">{id}</p>
                  </div>
                  <div className="flex-shrink-0">{stateBadge(state)}</div>
                </label>
              )
            })}
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setView('list')}>Back</Button>
            <div className="flex items-center gap-3">
              {selectedPolicies.size > 0 && (
                <span className="text-xs text-gray-400">
                  Will create {selectedPolicies.size} new polic{selectedPolicies.size !== 1 ? 'ies' : 'y'}
                </span>
              )}
              <Button
                variant="primary"
                onClick={handleRestore}
                loading={restoring}
                disabled={selectedPolicies.size === 0}
              >
                Restore Selected
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
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
    if (incGuests) {
      const guestTypes = pick(incGuests, 'GuestOrExternalUserTypes', 'guestOrExternalUserTypes')
      if (guestTypes) usersObj.includeGuestsOrExternalUsers = cleanForGraph(incGuests)
    }
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
  // Backup state
  const [lastBackup, setLastBackup] = useState(null)
  const [backupCount, setBackupCount] = useState(0)
  const [showBackups, setShowBackups] = useState(false)
  // Effective connection: prefer local connectedAs, fall back to global session
  const effectiveSession = connectedAs || tenantSession

  // Load existing backup metadata on mount
  useEffect(() => {
    if (!window.api?.backup) return
    window.api.backup.list().then(result => {
      if (result.success && result.backups.length > 0) {
        setLastBackup(result.backups[0])
        setBackupCount(result.backups.length)
      }
    }).catch(() => {})
  }, [])

  // Helper: silently create a backup and update status state
  const createBackup = async (policyList, trigger) => {
    if (!window.api?.backup) return
    try {
      const session = connectedAs || tenantSession
      const result = await window.api.backup.create({
        policies: policyList,
        tenantId: session?.TenantId,
        account: session?.Account,
        trigger,
      })
      if (result.success) {
        setLastBackup({ timestamp: result.timestamp, trigger, policyCount: policyList.length })
        setBackupCount(c => c + 1)
      }
    } catch {}
  }

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
      const normalizedPolicies = Array.isArray(loadedPolicies) ? loadedPolicies : []
      setPolicies(normalizedPolicies)
      setSelectedRows(new Set())
      if (context) setConnectedAs(context)
      // Auto-backup on tenant login / initial load
      if (normalizedPolicies.length > 0) {
        createBackup(normalizedPolicies, 'login')
      }
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
      // Backup before deleting
      await createBackup([deleteTarget], 'pre-delete')
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
        // Backup all policies being deleted before proceeding
        const policiesToBackup = policies.filter(p => ids.includes(p.Id))
        await createBackup(policiesToBackup, 'pre-delete')
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
      // Backup original policy before applying changes
      await createBackup([editTarget], 'pre-edit')
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

          {/* Backup status — visible when connected */}
          {effectiveSession && (
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Policy Backups</p>
                  {lastBackup ? (
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <p className="text-sm text-gray-700">
                        Last: <span className="font-medium">{fmtBackupTime(lastBackup.timestamp)}</span>
                      </p>
                      <TriggerBadge trigger={lastBackup.trigger} />
                      {backupCount > 1 && (
                        <span className="text-xs text-gray-400">{backupCount} saved</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 mt-0.5">
                      {policies.length > 0 ? 'Backup will run automatically' : 'Backup will run when policies load'}
                    </p>
                  )}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setShowBackups(true)}>
                View Backups
              </Button>
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
            <Button size="sm" variant="secondary" onClick={() => setShowBackups(true)}>
              <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Backups
            </Button>
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

      {/* Delete confirmation modal */}
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
        <div className="py-2 space-y-3">
          <p>
            Are you sure you want to delete <strong>{deleteTarget?.DisplayName}</strong>? This cannot be undone.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <p className="text-xs text-emerald-800">
              A backup will be created automatically before deletion so you can restore it later.
            </p>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
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

      {/* Backup/Restore modal */}
      <BackupRestoreModal
        open={showBackups}
        onClose={() => setShowBackups(false)}
      />
    </div>
  )
}
