import React, { useEffect } from 'react'
import { HashRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import useStore from './store'
import Modal from './components/Modal'
import Button from './components/Button'
import StatusIndicator from './components/StatusIndicator'

import Dashboard from './pages/Dashboard'
import CreatePolicies from './pages/CreatePolicies'
import ManagePolicies from './pages/ManagePolicies'
import Modules from './pages/Modules'
import Settings from './pages/Settings'
import Templates from './pages/Templates'
import EngineerDeploy from './pages/EngineerDeploy'
import RoleSelect from './pages/RoleSelect'

const VERSION = '1.0.0'

function NavItem({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
          isActive
            ? 'bg-white/15 text-white'
            : 'text-white/70 hover:text-white hover:bg-white/10',
        ].join(' ')
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

function AdminNav() {
  return (
    <>
      <NavItem
        to="/"
        label="Dashboard"
        icon={
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        }
      />
      <NavItem
        to="/create"
        label="Create Policies"
        icon={
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        }
      />
      <NavItem
        to="/manage"
        label="Manage Policies"
        icon={
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        }
      />
      <NavItem
        to="/templates"
        label="Templates"
        icon={
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        }
      />
      <NavItem
        to="/modules"
        label="Modules"
        icon={
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
        }
      />
      <NavItem
        to="/settings"
        label="Settings"
        icon={
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        }
      />
    </>
  )
}

function EngineerNav() {
  return (
    <NavItem
      to="/"
      label="Deploy Template"
      icon={
        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      }
    />
  )
}

function RoleBadge({ onSwitch }) {
  return (
    <button
      onClick={onSwitch}
      title="Switch role"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-all text-xs"
    >
      <span className="text-gold">★ Admin</span>
      <svg className="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    </button>
  )
}

function Sidebar({ modules, psStatus, role, onSwitchRole }) {
  const installed = modules.filter((m) => m.Status === 'up_to_date').length
  const total = modules.length
  const healthStatus = !psStatus?.found
    ? 'error'
    : installed === total && total > 0
    ? 'ok'
    : installed < total
    ? 'warning'
    : 'unknown'

  return (
    <aside className="flex flex-col w-64 bg-navy text-white flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="w-9 h-9 rounded-lg bg-gold flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold leading-tight text-white">M365 Security</div>
          <div className="text-xs text-gold font-medium">Policy Manager</div>
        </div>
        {role === 'admin' && <RoleBadge onSwitch={onSwitchRole} />}
        {role === 'engineer' && (
          <span className="text-xs text-white/50 px-2 py-1">Engineer</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {role === 'admin' ? <AdminNav /> : <EngineerNav />}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-2 px-1">
          <StatusIndicator status={healthStatus} showLabel={false} />
          <span className="text-xs text-white/60">
            {!psStatus ? 'Checking...' : !psStatus.found ? 'PowerShell not found' : `${installed}/${total} modules ready`}
          </span>
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-white/40">v{VERSION}</span>
          <span className="text-xs text-white/40">M365 Policy Mgr</span>
        </div>
      </div>
    </aside>
  )
}

function Notifications() {
  const { notifications, removeNotification } = useStore()
  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none">
      {notifications.map((n) => {
        const bg = { info: 'bg-blue-600', success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-amber-600' }[n.type] || 'bg-gray-800'
        return (
          <div
            key={n.id}
            className={[
              'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white text-sm max-w-sm pointer-events-auto',
              bg,
            ].join(' ')}
          >
            <span className="flex-1">{n.msg}</span>
            <button onClick={() => removeNotification(n.id)} className="text-white/70 hover:text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function FirstRunModal() {
  const { firstRun, completeFirstRun } = useStore()
  const [step, setStep] = React.useState(0)

  if (!firstRun) return null

  return (
    <Modal
      open={firstRun}
      onClose={() => {}}
      title="Welcome to M365 Security Policy Manager"
      size="lg"
    >
      <div className="space-y-4 py-2">
        {step === 0 && (
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
        )}
        <div className="flex justify-between pt-2">
          {step === 0 ? (
            <>
              <Button variant="ghost" onClick={completeFirstRun}>Skip Setup</Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={completeFirstRun}>Configure Later</Button>
                <Button variant="primary" onClick={() => { completeFirstRun(); window.location.hash = '/modules' }}>
                  Go to Modules
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

export default function App() {
  const { modules, psStatus, role, setRole, loadModules, loadSettings, checkFirstRun, appendLog } = useStore()

  useEffect(() => {
    loadSettings()
    loadModules()
    checkFirstRun()

    if (window.api) {
      const unsubOut = window.api.onPsOutput((line) => appendLog(line, 'output'))
      const unsubErr = window.api.onPsError((line) => appendLog(line, 'error'))
      return () => {
        unsubOut?.()
        unsubErr?.()
      }
    }
  }, [])

  // Role selection gate — show before the main app
  if (!role) {
    return <RoleSelect />
  }

  return (
    <Router>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar modules={modules} psStatus={psStatus} role={role} onSwitchRole={() => setRole(null)} />
        <main className="flex-1 overflow-y-auto">
          {role === 'engineer' ? (
            <Routes>
              <Route path="*" element={<EngineerDeploy />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/create" element={<CreatePolicies />} />
              <Route path="/manage" element={<ManagePolicies />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/modules" element={<Modules />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          )}
        </main>
      </div>
      <FirstRunModal />
      <Notifications />
    </Router>
  )
}
