const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Store
  store: {
    /** @param {string} key @returns {Promise<any>} */
    get: (key) => ipcRenderer.invoke('store:get', key),
    /** @param {string} key @param {any} value */
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    /** @param {string} key */
    delete: (key) => ipcRenderer.invoke('store:delete', key),
  },

  // Modules
  modules: {
    checkPs: () => ipcRenderer.invoke('modules:checkPs'),
    getStatus: () => ipcRenderer.invoke('modules:getStatus'),
    install: (moduleNames) => ipcRenderer.invoke('modules:install', moduleNames),
    update: (moduleNames) => ipcRenderer.invoke('modules:update', moduleNames),
    installPowerShell: () => ipcRenderer.invoke('modules:installPowerShell'),
  },

  // IT Glue
  itglue: {
    test: (apiKey) => ipcRenderer.invoke('itglue:test', apiKey),
    getOrgs: () => ipcRenderer.invoke('itglue:getOrgs'),
    getPasswords: (orgId) => ipcRenderer.invoke('itglue:getPasswords', orgId),
  },

  // Session
  session: {
    connect: (credentials, authMode) => ipcRenderer.invoke('session:connect', credentials, authMode),
    disconnect: () => ipcRenderer.invoke('session:disconnect'),
    getContext: () => ipcRenderer.invoke('session:getContext'),
    getLicenses: () => ipcRenderer.invoke('session:getLicenses'),
  },

  // Policies
  policies: {
    list: () => ipcRenderer.invoke('policies:list'),
    disconnect: () => ipcRenderer.invoke('policies:disconnect'),
    create: (options) => ipcRenderer.invoke('policies:create', options),
    update: (id, patch) => ipcRenderer.invoke('policies:update', id, patch),
    delete: (id) => ipcRenderer.invoke('policies:delete', id),
    toggleState: (id, state) => ipcRenderer.invoke('policies:toggleState', id, state),
  },

  // Backup / Restore
  backup: {
    create: (data) => ipcRenderer.invoke('backup:create', data),
    list: () => ipcRenderer.invoke('backup:list'),
    get: (filename) => ipcRenderer.invoke('backup:get', filename),
    restore: (policy) => ipcRenderer.invoke('backup:restore', policy),
    delete: (filename) => ipcRenderer.invoke('backup:delete', filename),
    openDir: () => ipcRenderer.invoke('backup:openDir'),
  },

  // App
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    getLogDir: () => ipcRenderer.invoke('app:getLogDir'),
    onDisconnecting: (cb) => {
      const h = () => cb()
      ipcRenderer.on('app:disconnecting', h)
      return () => ipcRenderer.removeListener('app:disconnecting', h)
    },
  },

  // Auto-updater
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onChecking: (cb) => {
      const h = () => cb()
      ipcRenderer.on('updater:checking', h)
      return () => ipcRenderer.removeListener('updater:checking', h)
    },
    onAvailable: (cb) => {
      const h = (_, info) => cb(info)
      ipcRenderer.on('updater:available', h)
      return () => ipcRenderer.removeListener('updater:available', h)
    },
    onNotAvailable: (cb) => {
      const h = () => cb()
      ipcRenderer.on('updater:not-available', h)
      return () => ipcRenderer.removeListener('updater:not-available', h)
    },
    onProgress: (cb) => {
      const h = (_, p) => cb(p)
      ipcRenderer.on('updater:progress', h)
      return () => ipcRenderer.removeListener('updater:progress', h)
    },
    onDownloaded: (cb) => {
      const h = (_, info) => cb(info)
      ipcRenderer.on('updater:downloaded', h)
      return () => ipcRenderer.removeListener('updater:downloaded', h)
    },
    onError: (cb) => {
      const h = (_, msg) => cb(msg)
      ipcRenderer.on('updater:error', h)
      return () => ipcRenderer.removeListener('updater:error', h)
    },
  },

  // Report
  report: {
    audit: () => ipcRenderer.invoke('report:audit'),
    savePDF: (orgName, policies, nameMap, recommendations, licenses) => ipcRenderer.invoke('app:savePDF', orgName, policies, nameMap, recommendations, licenses),
    saveDocx: (orgName, policies, nameMap, recommendations, accountManager, licenses) => ipcRenderer.invoke('app:saveDocx', orgName, policies, nameMap, recommendations, accountManager, licenses),
  },

  // Tenant entity search (used by EntityPicker in the editor UI)
  tenant: {
    searchUsers:  (query) => ipcRenderer.invoke('tenant:searchUsers',  query),
    searchGroups: (query) => ipcRenderer.invoke('tenant:searchGroups', query),
  },

  // PS event listeners
  onPsOutput: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('ps:output', handler)
    return () => ipcRenderer.removeListener('ps:output', handler)
  },
  onPsError: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('ps:error', handler)
    return () => ipcRenderer.removeListener('ps:error', handler)
  },

  // Session disconnected listener
  onSessionDisconnected: (cb) => {
    const h = () => cb()
    ipcRenderer.on('session:disconnected', h)
    return () => ipcRenderer.removeListener('session:disconnected', h)
  },
})
