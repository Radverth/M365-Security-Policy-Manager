import React, { useEffect, useState, useRef } from 'react'
import { HashRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import useStore from './store'
import Modal from './components/Modal'
import Button from './components/Button'
import StatusIndicator from './components/StatusIndicator'
import DeviceCodeModal, { parseDeviceCode } from './components/DeviceCodeModal'

import Dashboard from './pages/Dashboard'
import CreatePolicies from './pages/CreatePolicies'
import ManagePolicies from './pages/ManagePolicies'
import SecurityReport from './pages/SecurityReport'
import Modules from './pages/Modules'
import Settings from './pages/Settings'
import Baselines from './pages/Baselines'
import UpdaterModal from './components/UpdaterModal'

const VERSION = '1.1.0'

function NavItem({ to, icon, label, end, badge }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 relative',
          isActive
            ? 'bg-white/15 text-white shadow-sm'
            : 'text-white/65 hover:text-white hover:bg-white/10',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-gold rounded-r-full" />
          )}
          <span className={[
            'flex-shrink-0 transition-transform duration-150',
            'group-hover:scale-110',
          ].join(' ')}>
            {icon}
          </span>
          <span className="flex-1">{label}</span>
          {badge && (
            <svg className="animate-spin w-3.5 h-3.5 text-gold flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
        </>
      )}
    </NavLink>
  )
}

function TenantWidget({ session, onConnect, onSwitch }) {
  if (!session) {
    return (
      <div className="px-3 mb-3">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-white/25 flex-shrink-0" />
            <span className="text-xs text-white/40">No tenant connected</span>
          </div>
          <button
            onClick={onConnect}
            className="w-full py-1.5 rounded-md bg-gold/20 border border-gold/30 text-gold text-xs font-semibold hover:bg-gold/30 transition-colors"
          >
            Connect Tenant
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="px-3 mb-3">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{session.Account}</p>
              <p className="text-xs text-white/35 truncate">Connected</p>
            </div>
          </div>
          <button
            onClick={onSwitch}
            className="text-xs text-amber-400/80 hover:text-amber-300 transition-colors flex-shrink-0 font-medium"
          >
            Switch
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Switch-tenant confirmation modal ─────────────────────────────────────────

function SwitchTenantModal() {
  const { switchModalOpen, closeSwitchModal, disconnectSession, tenantSession } = useStore()
  const [disconnecting, setDisconnecting] = React.useState(false)

  React.useEffect(() => {
    if (!switchModalOpen) setDisconnecting(false)
  }, [switchModalOpen])

  const handleConfirm = async () => {
    setDisconnecting(true)
    await disconnectSession()
  }

  if (!switchModalOpen) return null

  return (
    <Modal open={switchModalOpen} onClose={closeSwitchModal} title="Switch Tenant" size="sm">
      <div className="space-y-4 py-1">
        {/* Warning banner */}
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">You will be signed out</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Switching tenants will disconnect your current PowerShell session. Any in-progress operations will be cancelled.
            </p>
          </div>
        </div>

        {/* Current session */}
        {tenantSession && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Currently connected as</p>
            <p className="text-sm font-semibold text-gray-900">{tenantSession.Account}</p>
            {tenantSession.TenantId && (
              <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{tenantSession.TenantId}</p>
            )}
          </div>
        )}

        <p className="text-sm text-gray-600">
          After signing out you'll be able to connect to a different tenant.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={closeSwitchModal} disabled={disconnecting}>
            Cancel
          </Button>
          <Button
            variant="amber"
            onClick={handleConfirm}
            loading={disconnecting}
          >
            {disconnecting ? 'Signing out…' : 'Sign Out & Switch'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Sidebar({ modules, psStatus }) {
  const { updateInfo, updaterStatus, showUpdater, tenantSession, openConnectModal, openSwitchModal, moduleOpInProgress } = useStore()
  const installed = modules.filter((m) => m.Status === 'up_to_date').length
  const total = modules.length
  const healthStatus = !psStatus?.found
    ? 'error'
    : installed === total && total > 0
    ? 'ok'
    : installed < total
    ? 'warning'
    : 'unknown'

  const healthPct = total > 0 ? Math.round((installed / total) * 100) : 0
  const healthColor = healthStatus === 'ok' ? '#4ade80' : healthStatus === 'warning' ? '#fbbf24' : '#f87171'

  return (
    <aside className="flex flex-col w-64 bg-navy text-white flex-shrink-0 select-none">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="w-9 h-9 rounded-lg bg-gold flex items-center justify-center flex-shrink-0 shadow-md">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold leading-tight text-white">M365 Security</div>
          <div className="text-xs text-gold font-medium">Policy Manager</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <NavItem end to="/" label="Dashboard" icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        } />
        <NavItem to="/create" label="Create Policies" icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        } />
        <NavItem to="/manage" label="Manage Policies" icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        } />
        <NavItem to="/report" label="Security Report" icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        } />

        <div className="my-2 border-t border-white/10" />

        <NavItem to="/baselines" label="Baselines" icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        } />
        <NavItem to="/modules" label="Modules" badge={moduleOpInProgress} icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
        } />
        <NavItem to="/settings" label="Settings" icon={
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        } />
      </nav>

      {/* Footer */}
      <div className="px-0 py-4 border-t border-white/10 space-y-3">
        {/* Tenant widget */}
        <TenantWidget
          session={tenantSession}
          onConnect={openConnectModal}
          onSwitch={openSwitchModal}
        />

        <div className="px-4 space-y-3">
          {/* Update banner */}
          {updaterStatus === 'checking' && (
            <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
              <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-xs text-white/40 leading-tight">Checking for updates…</p>
            </div>
          )}
          {(updateInfo?.hasUpdate || updaterStatus === 'downloaded') && (
            <button
              onClick={showUpdater}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gold/20 border border-gold/40 hover:bg-gold/30 active:scale-95 transition-all text-left"
            >
              <svg className="w-3.5 h-3.5 text-gold flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gold leading-tight">
                  {updaterStatus === 'downloaded' ? 'Ready to install' : 'Update available'}
                </p>
                <p className="text-xs text-gold/70 leading-tight">v{updateInfo?.latestVersion} — click to update</p>
              </div>
            </button>
          )}

          {/* Module health bar */}
          {total > 0 && (
            <div className="px-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <StatusIndicator status={healthStatus} showLabel={false} />
                  <span className="text-xs text-white/60">
                    {!psStatus ? 'Checking…' : !psStatus.found ? 'PowerShell not found' : `${installed}/${total} modules ready`}
                  </span>
                </div>
                {total > 0 && psStatus?.found && (
                  <span className="text-xs font-medium" style={{ color: healthColor }}>{healthPct}%</span>
                )}
              </div>
              {psStatus?.found && total > 0 && (
                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${healthPct}%`, backgroundColor: healthColor }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-white/30">v{VERSION}</span>
            <span className="text-xs text-white/30">M365 Policy Mgr</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

/* Notification icons */
const NOTIF_ICONS = {
  success: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
}

const NOTIF_STYLES = {
  success: { bg: 'bg-white border-l-4 border-l-green-500 shadow-lg', icon: 'bg-green-100 text-green-600', bar: 'bg-green-500' },
  error:   { bg: 'bg-white border-l-4 border-l-red-500 shadow-lg',   icon: 'bg-red-100 text-red-600',   bar: 'bg-red-500' },
  warning: { bg: 'bg-white border-l-4 border-l-amber-500 shadow-lg', icon: 'bg-amber-100 text-amber-600', bar: 'bg-amber-500' },
  info:    { bg: 'bg-white border-l-4 border-l-blue-500 shadow-lg',  icon: 'bg-blue-100 text-blue-600',  bar: 'bg-blue-500' },
}

const NOTIF_DURATION = 4500

function NotificationItem({ n, onRemove }) {
  const style = NOTIF_STYLES[n.type] || NOTIF_STYLES.info
  const [leaving, setLeaving] = useState(false)

  const dismiss = () => {
    setLeaving(true)
    setTimeout(() => onRemove(n.id), 200)
  }

  useEffect(() => {
    const t = setTimeout(dismiss, NOTIF_DURATION)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className={[
      'flex flex-col rounded-lg overflow-hidden max-w-sm w-full',
      style.bg,
      leaving ? 'animate-slide-out-right' : 'animate-slide-in-right',
    ].join(' ')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={['w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0', style.icon].join(' ')}>
          {NOTIF_ICONS[n.type] || NOTIF_ICONS.info}
        </div>
        <p className="flex-1 text-sm text-gray-800 leading-snug pt-0.5">{n.msg}</p>
        <button
          onClick={dismiss}
          className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 mt-0.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {/* Auto-dismiss progress bar */}
      <div className="h-0.5 bg-gray-100">
        <div
          className={['h-full rounded-full', style.bar].join(' ')}
          style={{ animation: `progress-shrink ${NOTIF_DURATION}ms linear forwards` }}
        />
      </div>
    </div>
  )
}

function Notifications() {
  const { notifications, removeNotification } = useStore()
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <NotificationItem n={n} onRemove={removeNotification} />
        </div>
      ))}
    </div>
  )
}

/* Fade-in wrapper on route change */
function PageWrapper({ children }) {
  const location = useLocation()
  return (
    <div key={location.pathname} className="animate-fade-in-up h-full">
      {children}
    </div>
  )
}

function FirstRunModal() {
  const { firstRun, completeFirstRun } = useStore()

  if (!firstRun) return null

  return (
    <Modal
      open={firstRun}
      onClose={() => {}}
      title="Welcome to M365 Security Policy Manager"
      size="lg"
    >
      <div className="space-y-4 py-2">
        <div className="space-y-3">
          <p className="text-gray-700">
            Thank you for using the M365 Security Policy Manager. Before you start, let's make sure your environment is set up correctly.
          </p>
          <div className="bg-navy-50 border border-navy-100 rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-semibold text-navy">Prerequisites</h3>
            <ul className="text-sm text-gray-600 space-y-1.5">
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                PowerShell 7+ installed on this machine
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Microsoft Graph PowerShell modules (we'll help install these)
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                IT Glue API key (optional, for credential management)
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                M365 Global Admin or Security Admin credentials
              </li>
            </ul>
          </div>
        </div>
        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={completeFirstRun}>Skip Setup</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={completeFirstRun}>Configure Later</Button>
            <Button variant="primary" onClick={() => { completeFirstRun(); window.location.hash = '/modules' }}>
              Go to Modules
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Connect Modal ─────────────────────────────────────────────────────────────

function ItGlueConnectPanel({ credentials, setCredentials }) {
  const { orgs, orgsLoading, loadOrgs, settings } = useStore()
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [passwords, setPasswords] = useState([])
  const [pwLoading, setPwLoading] = useState(false)
  const [selectedPwId, setSelectedPwId] = useState(null)

  useEffect(() => {
    if (settings.itGlueApiKey) loadOrgs()
  }, [])

  useEffect(() => {
    if (!selectedOrg || !window.api) return
    setPwLoading(true)
    setCredentials(null)
    setSelectedPwId(null)
    window.api.itglue.getPasswords(selectedOrg.id)
      .then((res) => setPasswords(res || []))
      .catch(() => setPasswords([]))
      .finally(() => setPwLoading(false))
  }, [selectedOrg?.id])

  if (!settings.itGlueApiKey) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        IT Glue API key not configured. Go to Settings to add your key, or use Interactive mode.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1.5">Organisation</p>
        <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-1">
          {orgsLoading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />)
          ) : orgs.length === 0 ? (
            <p className="text-xs text-gray-400 p-3 text-center">No organisations found</p>
          ) : orgs.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelectedOrg(o)}
              className={[
                'w-full text-left px-3 py-2 rounded text-sm transition-colors',
                selectedOrg?.id === o.id ? 'bg-navy text-white font-medium' : 'hover:bg-gray-50 text-gray-800',
              ].join(' ')}
            >
              {o.name}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1.5">Credential</p>
        <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-1">
          {!selectedOrg ? (
            <p className="text-xs text-gray-400 p-3 text-center">Select an organisation first</p>
          ) : pwLoading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-9 bg-gray-100 rounded animate-pulse" />)
          ) : passwords.length === 0 ? (
            <p className="text-xs text-gray-400 p-3 text-center">No passwords found</p>
          ) : passwords.map((pw) => (
            <button
              key={pw.id}
              onClick={() => { setSelectedPwId(pw.id); setCredentials({ username: pw.username, password: pw.password }) }}
              className={[
                'w-full text-left px-3 py-2 rounded text-sm transition-colors',
                selectedPwId === pw.id ? 'bg-navy text-white font-medium' : 'hover:bg-gray-50 text-gray-800',
              ].join(' ')}
            >
              <p className="font-medium truncate">{pw.name}</p>
              <p className={`text-xs truncate ${credentials?.username === pw.username ? 'text-white/70' : 'text-gray-400'}`}>{pw.username}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConnectModal() {
  const { connectModalOpen, closeConnectModal, setTenantSession } = useStore()
  const [authMode, setAuthMode] = useState('itglue')
  const [credentials, setCredentials] = useState(null)
  const [username, setUsername] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [deviceCodeInfo, setDeviceCodeInfo] = useState(null)

  useEffect(() => {
    if (!connectModalOpen) {
      setConnecting(false)
      setError('')
      setDeviceCodeInfo(null)
      setCredentials(null)
      setUsername('')
    }
  }, [connectModalOpen])

  useEffect(() => {
    if (!window.api || !connectModalOpen) return
    const unsub = window.api.onPsOutput((line) => {
      const dc = parseDeviceCode(line)
      if (dc) setDeviceCodeInfo(dc)
      if (/connected\.|CONNECTED:|welcome to microsoft graph/i.test(line)) setDeviceCodeInfo(null)
    })
    return () => unsub?.()
  }, [connectModalOpen])

  const canConnect = authMode === 'interactive' || !!(credentials?.username && credentials?.password)

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    try {
      if (!window.api?.session) {
        setError('Session API unavailable — please fully restart the application (not just reload)')
        return
      }
      const creds = authMode === 'interactive'
        ? (username ? { username } : null)
        : credentials
      const result = await window.api.session.connect(creds, authMode)
      if (result.error) {
        setError(result.error)
      } else {
        setTenantSession(result.context)
        closeConnectModal()
      }
    } catch (err) {
      setError(err.message || 'Connection failed')
    } finally {
      setConnecting(false)
      setDeviceCodeInfo(null)
    }
  }

  if (!connectModalOpen) return null

  return (
    <>
      <Modal
        open={connectModalOpen}
        onClose={closeConnectModal}
        title="Connect to Tenant"
        size="lg"
      >
        <div className="space-y-4 py-2">
          {/* Auth mode tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {[{ id: 'itglue', label: 'IT Glue' }, { id: 'interactive', label: 'Interactive' }].map((m) => (
              <button
                key={m.id}
                onClick={() => { setAuthMode(m.id); setCredentials(null); setError('') }}
                className={[
                  'flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all',
                  authMode === m.id ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>

          {authMode === 'itglue' ? (
            <ItGlueConnectPanel credentials={credentials} setCredentials={setCredentials} />
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Username (optional)</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin@contoso.onmicrosoft.com"
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-blue-700 mb-0.5">Device code sign-in</p>
                <p className="text-xs text-blue-600 leading-relaxed">
                  A device code will appear. Visit <span className="font-medium">microsoft.com/devicelogin</span> and enter it to authenticate.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-red-700 mb-0.5">Connection failed</p>
              <p className="text-xs text-red-600 break-words">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={closeConnectModal} disabled={connecting}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleConnect}
              loading={connecting}
              disabled={!canConnect || connecting}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </div>
      </Modal>
      <DeviceCodeModal info={deviceCodeInfo} onDismiss={() => setDeviceCodeInfo(null)} />
    </>
  )
}

function SigningOutOverlay() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(16, 24, 40, 0.82)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-5 max-w-xs w-full mx-4">
        <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: '#1a2d4a' }}>
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-gray-900">Signing out</p>
          <p className="text-sm text-gray-400 mt-1">Clearing your session…</p>
        </div>
        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: '#1a2d4a' }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}

export default function App() {
  const { modules, psStatus, loadModules, loadSettings, checkFirstRun, initUpdaterListeners, appendLog, checkExistingSession, clearTenantSession } = useStore()
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    loadSettings()
    loadModules()
    checkFirstRun()
    initUpdaterListeners()
    checkExistingSession()

    if (window.api) {
      const unsubOut = window.api.onPsOutput((line) => appendLog(line, 'output'))
      const unsubErr = window.api.onPsError((line) => appendLog(line, 'error'))
      const unsubDisc = window.api.onSessionDisconnected?.(() => clearTenantSession())
      const unsubQuit = window.api.app?.onDisconnecting?.(() => setSigningOut(true))
      return () => {
        unsubOut?.()
        unsubErr?.()
        unsubDisc?.()
        unsubQuit?.()
      }
    }
  }, [])


  return (
    <Router>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar modules={modules} psStatus={psStatus} />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<PageWrapper><Dashboard /></PageWrapper>} />
            <Route path="/create" element={<PageWrapper><CreatePolicies /></PageWrapper>} />
            <Route path="/report" element={<PageWrapper><SecurityReport /></PageWrapper>} />
            <Route path="/manage" element={<PageWrapper><ManagePolicies /></PageWrapper>} />
            <Route path="/baselines" element={<PageWrapper><Baselines /></PageWrapper>} />
            <Route path="/modules" element={<PageWrapper><Modules /></PageWrapper>} />
            <Route path="/settings" element={<PageWrapper><Settings /></PageWrapper>} />
          </Routes>
        </main>
      </div>
      <FirstRunModal />
      <ConnectModal />
      <SwitchTenantModal />
      <UpdaterModal />
      <Notifications />
      {signingOut && <SigningOutOverlay />}
    </Router>
  )
}
