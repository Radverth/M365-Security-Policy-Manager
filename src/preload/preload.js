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

  // Policies
  policies: {
    list: (credentials) => ipcRenderer.invoke('policies:list', credentials),
    create: (options) => ipcRenderer.invoke('policies:create', options),
    update: (id, patch) => ipcRenderer.invoke('policies:update', id, patch),
    delete: (id) => ipcRenderer.invoke('policies:delete', id),
    toggleState: (id, state) => ipcRenderer.invoke('policies:toggleState', id, state),
  },

  // Templates (file-based when a shared path is configured)
  templates: {
    load: () => ipcRenderer.invoke('templates:load'),
    save: (templates) => ipcRenderer.invoke('templates:save', templates),
  },

  // Native dialogs
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
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
})
