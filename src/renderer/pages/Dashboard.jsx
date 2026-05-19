import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store'
import Card from '../components/Card'
import Badge from '../components/Badge'
import Button from '../components/Button'
import StatusIndicator from '../components/StatusIndicator'

/* Counts a number up from 0 when the target changes */
function useCountUp(target, duration = 600) {
  const [count, setCount] = useState(0)
  const frame = useRef(null)
  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) return
    const start = performance.now()
    const from = 0
    const run = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out
      const ease = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(from + (target - from) * ease))
      if (progress < 1) frame.current = requestAnimationFrame(run)
    }
    frame.current = requestAnimationFrame(run)
    return () => cancelAnimationFrame(frame.current)
  }, [target, duration])
  return count
}

const ACCENT = {
  blue:   { ring: 'ring-blue-200',   icon: 'bg-blue-50 text-blue-600',   bar: 'bg-blue-500',  dot: 'bg-blue-500'  },
  green:  { ring: 'ring-green-200',  icon: 'bg-green-50 text-green-600', bar: 'bg-green-500', dot: 'bg-green-500' },
  amber:  { ring: 'ring-amber-200',  icon: 'bg-amber-50 text-amber-600', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  red:    { ring: 'ring-red-200',    icon: 'bg-red-50 text-red-600',     bar: 'bg-red-500',   dot: 'bg-red-500'   },
  navy:   { ring: 'ring-navy-200',   icon: 'bg-navy text-white',         bar: 'bg-navy',      dot: 'bg-navy'      },
}

function StatCard({ label, value, sub, icon, color = 'navy', onClick, delay = 0 }) {
  const acc = ACCENT[color] || ACCENT.navy
  const animated = useCountUp(typeof value === 'number' ? value : NaN)
  const display = typeof value === 'number' ? animated : value

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <Card
        hoverable={!!onClick}
        onClick={onClick}
        className="p-5 relative overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">{label}</p>
            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-none">{display}</p>
            {sub && <p className="mt-1.5 text-xs text-gray-400">{sub}</p>}
          </div>
          <div className={['w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ring-2', acc.icon, acc.ring].join(' ')}>
            {icon}
          </div>
        </div>
        {/* Subtle bottom accent line */}
        <div className={['absolute bottom-0 left-0 right-0 h-0.5', acc.bar].join(' ')} />
      </Card>
    </div>
  )
}

function QuickActionCard({ title, description, icon, onClick, variant = 'default', delay = 0 }) {
  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <Card
        hoverable
        onClick={onClick}
        className={[
          'p-4 cursor-pointer border-2 transition-all group',
          variant === 'primary' ? 'border-navy hover:border-navy-600 bg-navy/[0.02]' : 'border-transparent hover:border-navy/20',
        ].join(' ')}
      >
        <div className="flex items-start gap-4">
          <div className={[
            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110',
            variant === 'primary' ? 'bg-navy text-white shadow-sm' : 'bg-gray-100 text-navy group-hover:bg-navy group-hover:text-white',
          ].join(' ')}>
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0 ml-auto group-hover:text-navy group-hover:translate-x-0.5 transition-all mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </Card>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { modules, psStatus, modulesLoading, logs, loadModules, settings } = useStore()

  useEffect(() => {
    loadModules()
  }, [])

  const upToDate    = modules.filter((m) => m.Status === 'up_to_date').length
  const updateAvail = modules.filter((m) => m.Status === 'update_available').length
  const notInstalled = modules.filter((m) => m.Status === 'not_installed').length
  const recentLogs  = logs.slice(-10).reverse()

  const moduleHealth = !psStatus?.found ? 'error' : notInstalled > 0 ? 'warning' : updateAvail > 0 ? 'warning' : upToDate > 0 ? 'ok' : 'unknown'

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">M365 Security Policy Manager overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="PowerShell"
          value={psStatus?.found ? 'Ready' : modulesLoading ? '…' : 'Not Found'}
          sub={psStatus?.version || (psStatus?.found === false ? 'Install required' : 'Checking…')}
          color={psStatus?.found ? 'blue' : 'red'}
          delay={0}
          onClick={() => navigate('/modules')}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard
          label="Up-to-Date"
          value={modulesLoading ? '…' : upToDate}
          sub={`of ${modules.length} required`}
          color="green"
          delay={75}
          onClick={() => navigate('/modules')}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Updates Available"
          value={modulesLoading ? '…' : updateAvail}
          sub="modules need updating"
          color={updateAvail > 0 ? 'amber' : 'green'}
          delay={150}
          onClick={() => navigate('/modules')}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          }
        />
        <StatCard
          label="Not Installed"
          value={modulesLoading ? '…' : notInstalled}
          sub="modules missing"
          color={notInstalled > 0 ? 'red' : 'green'}
          delay={225}
          onClick={() => navigate('/modules')}
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          }
        />
      </div>

      {/* IT Glue connection status */}
      <div className="animate-fade-in-up mb-8" style={{ animationDelay: '300ms' }}>
        <Card>
          <Card.Header>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">IT Glue Connection</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>Configure</Button>
            </div>
          </Card.Header>
          <Card.Body>
            {settings.itGlueApiKey ? (
              <div className="flex items-center gap-3">
                <StatusIndicator status="ok" label="API key configured" />
                <span className="text-xs text-gray-400">Base URL: {settings.itGlueBaseUrl}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <StatusIndicator status="warning" label="No API key configured" />
                <span className="text-xs text-gray-400">
                  Configure your IT Glue API key in Settings to enable organisation and credential lookup.
                </span>
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Quick Actions */}
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 animate-fade-in-up" style={{ animationDelay: '350ms' }}>
            Quick Actions
          </p>
          <div className="space-y-2.5">
            <QuickActionCard
              variant="primary"
              title="Create Policies"
              description="Walk through the 6-step wizard to create security policies for an M365 tenant."
              onClick={() => navigate('/create')}
              delay={375}
              icon={
                <svg className="w-4.5 h-4.5 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              }
            />
            <QuickActionCard
              title="Check Module Health"
              description="Verify all required PowerShell modules are installed and up-to-date."
              onClick={() => navigate('/modules')}
              delay={425}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <QuickActionCard
              title="Manage Existing Policies"
              description="View, edit, enable/disable, or delete existing conditional access policies."
              onClick={() => navigate('/manage')}
              delay={475}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
            />
            <QuickActionCard
              title="Configure Settings"
              description="Set up IT Glue integration, PowerShell path, and application preferences."
              onClick={() => navigate('/settings')}
              delay={525}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="animate-fade-in-up" style={{ animationDelay: '350ms' }}>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Recent Activity</p>
          <Card>
            <Card.Body className="p-0">
              {recentLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-gray-300">
                  <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-400">No recent activity</p>
                  <p className="text-xs text-gray-300 mt-1">Activity will appear here as you use the app</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {recentLogs.map((entry, i) => {
                    const line = typeof entry === 'string' ? entry : entry.line
                    const type = typeof entry === 'object' ? entry.type : 'output'
                    const isError   = type === 'error' || /^(ERROR|FAILURE):/i.test(line)
                    const isSuccess = /^(SUCCESS|CONNECTED|DONE):/i.test(line)
                    const isInfo    = /^(INFO|CREATING):/i.test(line)
                    const badgeVariant = isError ? 'error' : isSuccess ? 'success' : isInfo ? 'info' : 'neutral'
                    return (
                      <li key={i} className="flex items-start gap-3 px-5 py-2.5 hover:bg-gray-50/50 transition-colors">
                        <Badge variant={badgeVariant} className="mt-0.5 flex-shrink-0 text-[10px]">
                          {isError ? 'ERR' : isSuccess ? 'OK' : isInfo ? 'INFO' : 'LOG'}
                        </Badge>
                        <span className="text-xs text-gray-500 font-mono break-all leading-relaxed">{line}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card.Body>
          </Card>
        </div>
      </div>
    </div>
  )
}
