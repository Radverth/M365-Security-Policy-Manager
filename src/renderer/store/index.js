import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    itGlueApiKey: '',
    itGlueBaseUrl: 'https://api.eu.itglue.com',
    defaultPolicyPrefix: '',
    powershellPath: '',
    executionPolicy: 'RemoteSigned',
    theme: 'system',
  },
  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  loadSettings: async () => {
    if (!window.api) return
    const keys = ['itGlueApiKey', 'itGlueBaseUrl', 'defaultPolicyPrefix', 'powershellPath', 'executionPolicy', 'theme']
    const values = await Promise.all(keys.map((k) => window.api.store.get(k)))
    const patch = {}
    keys.forEach((k, i) => { if (values[i] !== undefined && values[i] !== null) patch[k] = values[i] })
    set((s) => ({ settings: { ...s.settings, ...patch } }))
  },

  saveSettings: async (patch) => {
    if (!window.api) return
    for (const [k, v] of Object.entries(patch)) {
      await window.api.store.set(k, v)
    }
    set((s) => ({ settings: { ...s.settings, ...patch } }))
  },

  // ── PowerShell ────────────────────────────────────────────────────────────
  psStatus: null, // { found, path, version }
  setPsStatus: (psStatus) => set({ psStatus }),

  // ── Modules ───────────────────────────────────────────────────────────────
  modules: [],
  modulesLoading: false,
  setModules: (modules) => set({ modules }),
  setModulesLoading: (modulesLoading) => set({ modulesLoading }),

  loadModules: async () => {
    if (!window.api) return
    set({ modulesLoading: true })
    try {
      const [psRes, moduleRes] = await Promise.all([
        window.api.modules.checkPs(),
        window.api.modules.getStatus(),
      ])
      set({ psStatus: psRes, modules: moduleRes || [] })
    } catch (err) {
      console.error('loadModules error', err)
    } finally {
      set({ modulesLoading: false })
    }
  },

  // ── Organisations ─────────────────────────────────────────────────────────
  orgs: [],
  orgsLoading: false,
  selectedOrg: null,
  setOrgs: (orgs) => set({ orgs }),
  setOrgsLoading: (orgsLoading) => set({ orgsLoading }),
  setSelectedOrg: (selectedOrg) => set({ selectedOrg }),

  loadOrgs: async () => {
    if (!window.api) return
    set({ orgsLoading: true })
    try {
      const orgs = await window.api.itglue.getOrgs()
      set({ orgs: orgs || [] })
    } catch (err) {
      console.error('loadOrgs error', err)
      set({ orgs: [] })
    } finally {
      set({ orgsLoading: false })
    }
  },

  // ── Policies ──────────────────────────────────────────────────────────────
  policies: [],
  policiesLoading: false,
  setPolicies: (policies) => set({ policies }),
  setPoliciesLoading: (policiesLoading) => set({ policiesLoading }),

  // ── UI / Logs ─────────────────────────────────────────────────────────────
  logs: [],
  appendLog: (line, type = 'output') =>
    set((s) => ({
      logs: [...s.logs.slice(-499), { line, type, ts: Date.now() }],
    })),
  clearLogs: () => set({ logs: [] }),

  notifications: [],
  addNotification: (msg, type = 'info') => {
    const id = Date.now() + Math.random()
    set((s) => ({
      notifications: [...s.notifications, { id, msg, type }],
    }))
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
    }, 4000)
  },
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  // ── Updater ───────────────────────────────────────────────────────────────
  // status: idle | checking | available | downloading | downloaded | error
  updaterStatus: 'idle',
  updaterInfo: null,      // { version, releaseDate, releaseNotes }
  downloadProgress: null, // { percent, transferred, total, bytesPerSecond }
  updaterError: null,
  updateInfo: null,       // kept for sidebar banner compat

  initUpdaterListeners: () => {
    if (!window.api?.updater) return
    window.api.updater.onChecking(() => set({ updaterStatus: 'checking' }))
    window.api.updater.onAvailable((info) =>
      set({ updaterStatus: 'available', updaterInfo: info, updateInfo: { hasUpdate: true, latestVersion: info.version } })
    )
    window.api.updater.onNotAvailable(() => set({ updaterStatus: 'idle' }))
    window.api.updater.onProgress((p) =>
      set({ updaterStatus: 'downloading', downloadProgress: p })
    )
    window.api.updater.onDownloaded((info) =>
      set({ updaterStatus: 'downloaded', updaterInfo: info })
    )
    window.api.updater.onError((msg) =>
      set({ updaterStatus: 'error', updaterError: msg })
    )
  },

  triggerCheck: () => window.api?.updater?.check(),
  showUpdater: () => {
    const { updaterStatus, updaterInfo } = get()
    if (updaterStatus === 'idle' && updaterInfo) set({ updaterStatus: 'available' })
    else window.api?.updater?.check()
  },
  triggerDownload: () => {
    set({ updaterStatus: 'downloading', downloadProgress: null })
    window.api?.updater?.download()
  },
  triggerInstall: () => window.api?.updater?.install(),
  dismissUpdater: () => set({ updaterStatus: 'idle', updaterError: null }),

  // ── Tenant Session ────────────────────────────────────────────────────────────
  tenantSession: null,  // { Account, TenantId } | null
  setTenantSession: (session) => set({ tenantSession: session }),
  clearTenantSession: () => set({ tenantSession: null }),

  connectModalOpen: false,
  openConnectModal: () => set({ connectModalOpen: true }),
  closeConnectModal: () => set({ connectModalOpen: false }),

  checkExistingSession: async () => {
    if (!window.api?.session) return
    const ctx = await window.api.session.getContext()
    if (ctx) set({ tenantSession: ctx })
  },

  // ── First Run ─────────────────────────────────────────────────────────────
  firstRun: false,
  setFirstRun: (firstRun) => set({ firstRun }),
  checkFirstRun: async () => {
    if (!window.api) return
    const val = await window.api.store.get('firstRun')
    set({ firstRun: val === true || val === undefined })
  },
  completeFirstRun: async () => {
    if (!window.api) return
    await window.api.store.set('firstRun', false)
    set({ firstRun: false })
  },
}))

export default useStore
