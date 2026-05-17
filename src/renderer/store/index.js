import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    itGlueApiKey: '',
    itGlueBaseUrl: 'https://api.itglue.com',
    defaultPolicyPrefix: '',
    powershellPath: '',
    executionPolicy: 'RemoteSigned',
    theme: 'system',
    adminPin: '',
    templatesPath: '',
  },
  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  loadSettings: async () => {
    if (!window.api) return
    const keys = ['itGlueApiKey', 'itGlueBaseUrl', 'defaultPolicyPrefix', 'powershellPath', 'executionPolicy', 'theme', 'adminPin', 'templatesPath']
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

  // ── Role ──────────────────────────────────────────────────────────────────
  role: null, // 'admin' | 'engineer' | null (session-only, not persisted)
  setRole: (role) => set({ role }),

  // ── Templates ─────────────────────────────────────────────────────────────
  templates: [],
  loadTemplates: async () => {
    if (!window.api) return
    const t = await window.api.templates.load()
    set({ templates: t || [] })
  },
  saveTemplate: async (template) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2)
    const t = { ...template, id, createdAt: new Date().toISOString() }
    const templates = [...get().templates, t]
    await window.api.templates.save(templates)
    set({ templates })
    return t
  },
  updateTemplate: async (id, patch) => {
    const templates = get().templates.map((t) => (t.id === id ? { ...t, ...patch } : t))
    await window.api.templates.save(templates)
    set({ templates })
  },
  deleteTemplate: async (id) => {
    const templates = get().templates.filter((t) => t.id !== id)
    await window.api.templates.save(templates)
    set({ templates })
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
