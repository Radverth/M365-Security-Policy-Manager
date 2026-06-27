const { safeStorage } = require('electron')
const Store = require('electron-store')
const logger = require('./logger')

const store = new Store({
  name: 'm365-policy-manager',
  encryptionKey: 'M365PolicyMgr-2025', // kept for reading legacy encrypted values
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

// ── Secure API key storage via OS credential store ────────────────────────────
// Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
// Falls back to the encrypted electron-store value if safeStorage is unavailable.
// Migration: on first read, moves the legacy stored key to safeStorage.

function getApiKey() {
  if (!safeStorage.isEncryptionAvailable()) {
    return store.get('itGlueApiKey') || ''
  }
  const enc = store.get('_itGlueApiKey_safe')
  if (enc) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch (err) {
      logger.warn('safeStorage decrypt failed for API key:', err.message)
      return ''
    }
  }
  // Migrate legacy key from encrypted store → safeStorage
  const legacy = store.get('itGlueApiKey')
  if (legacy) {
    try {
      setApiKey(legacy)
      store.delete('itGlueApiKey')
      logger.info('Migrated IT Glue API key to OS secure storage')
    } catch {}
    return legacy
  }
  return ''
}

function setApiKey(key) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const enc = safeStorage.encryptString(key || '')
      store.set('_itGlueApiKey_safe', enc.toString('base64'))
      store.delete('itGlueApiKey')
      return
    } catch (err) {
      logger.warn('safeStorage encrypt failed, falling back to store:', err.message)
    }
  }
  store.set('itGlueApiKey', key || '')
}

module.exports = { store, getApiKey, setApiKey }
