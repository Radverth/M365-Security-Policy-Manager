const Store = require('electron-store')

const store = new Store({
  name: 'm365-policy-manager',
  encryptionKey: 'M365PolicyMgr-2025',
  defaults: {
    itGlueApiKey: '',
    itGlueBaseUrl: 'https://api.eu.itglue.com',
    defaultPolicyPrefix: '',
    powershellPath: '',
    executionPolicy: 'RemoteSigned',
    theme: 'system',
    firstRun: true,
  },
})

module.exports = store
