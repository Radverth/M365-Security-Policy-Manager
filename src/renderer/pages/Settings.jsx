import React, { useState, useEffect } from 'react'
import useStore from '../store'
import Card from '../components/Card'
import Button from '../components/Button'
import Badge from '../components/Badge'

const EXECUTION_POLICIES = ['Restricted', 'AllSigned', 'RemoteSigned', 'Unrestricted', 'Bypass']

function FormGroup({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', className = '' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={[
        'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400',
        'focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy',
        className,
      ].join(' ')}
    />
  )
}

export default function Settings() {
  const { settings, saveSettings, addNotification } = useStore()

  const [form, setForm] = useState({ ...settings })
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setForm({ ...settings })
  }, [settings])

  const set = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }))
    setTestResult(null)
  }

  const handleTest = async () => {
    if (!window.api || !form.itGlueApiKey) {
      setTestResult({ success: false, message: 'No API key entered' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.itglue.test(form.itGlueApiKey)
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSettings(form)
      setSaved(true)
      addNotification('Settings saved successfully', 'success')
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      addNotification('Failed to save settings: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Configure integration, PowerShell, and application preferences</p>
      </div>

      <div className="space-y-6">
        {/* IT Glue */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-gray-900">IT Glue Integration</h2>
            </div>
          </Card.Header>
          <Card.Body className="space-y-4">
            <FormGroup
              label="IT Glue API Key"
              hint="Your IT Glue API key. This is stored encrypted on your local machine."
            >
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <TextInput
                    type={showApiKey ? 'text' : 'password'}
                    value={form.itGlueApiKey}
                    onChange={(v) => set('itGlueApiKey', v)}
                    placeholder="Enter your IT Glue API key..."
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                  >
                    {showApiKey ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                <Button variant="secondary" onClick={handleTest} loading={testing} disabled={!form.itGlueApiKey}>
                  Test
                </Button>
              </div>
              {testResult && (
                <div className={[
                  'mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                  testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
                ].join(' ')}>
                  {testResult.success
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  }
                  {testResult.message}
                </div>
              )}
            </FormGroup>

            <FormGroup
              label="IT Glue Base URL"
              hint="Leave default unless you are on a custom IT Glue instance (e.g., EU region)."
            >
              <TextInput
                value={form.itGlueBaseUrl}
                onChange={(v) => set('itGlueBaseUrl', v)}
                placeholder="https://api.itglue.com"
              />
            </FormGroup>
          </Card.Body>
        </Card>

        {/* Policy Defaults */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-navy-50 flex items-center justify-center">
                <svg className="w-4 h-4 text-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-gray-900">Policy Defaults</h2>
            </div>
          </Card.Header>
          <Card.Body>
            <FormGroup
              label="Default Policy Prefix"
              hint='Optional prefix prepended to all created policy names (e.g., "AffinityIT" → "AffinityIT — CA001: Require MFA").'
            >
              <TextInput
                value={form.defaultPolicyPrefix}
                onChange={(v) => set('defaultPolicyPrefix', v)}
                placeholder="e.g. Client Name"
              />
              {form.defaultPolicyPrefix && (
                <div className="mt-2 p-2 bg-gray-50 rounded text-xs font-mono text-gray-600">
                  Preview: {form.defaultPolicyPrefix} — CA001: Require MFA for All Users
                </div>
              )}
            </FormGroup>
          </Card.Body>
        </Card>

        {/* PowerShell */}
        <Card>
          <Card.Header>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-sm font-semibold text-gray-900">PowerShell Configuration</h2>
            </div>
          </Card.Header>
          <Card.Body className="space-y-4">
            <FormGroup
              label="PowerShell Executable Path"
              hint='Leave blank to use the auto-detected path (recommended). Override if you have a custom PowerShell installation.'
            >
              <TextInput
                value={form.powershellPath}
                onChange={(v) => set('powershellPath', v)}
                placeholder="Auto-detect (leave blank)"
              />
            </FormGroup>

            <FormGroup
              label="Execution Policy"
              hint='Controls how PowerShell scripts are executed. "RemoteSigned" is recommended for most environments.'
            >
              <select
                value={form.executionPolicy}
                onChange={(e) => set('executionPolicy', e.target.value)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              >
                {EXECUTION_POLICIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </FormGroup>
          </Card.Body>
        </Card>

        {/* Save button */}
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            className="min-w-[120px]"
          >
            {saved ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </>
            ) : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  )
}
