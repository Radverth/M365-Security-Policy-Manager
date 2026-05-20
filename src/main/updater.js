const axios = require('axios')

const GITHUB_REPO = 'radverth/m365-security-policy-manager'

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

async function checkForUpdate(currentVersion) {
  try {
    const resp = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'User-Agent': 'M365-Security-Policy-Manager' },
        timeout: 10000,
      }
    )
    const tag = resp.data.tag_name || ''
    const latestVersion = tag.replace(/^v/, '')
    const hasUpdate = latestVersion && compareVersions(latestVersion, currentVersion) > 0
    return {
      hasUpdate: !!hasUpdate,
      latestVersion,
      currentVersion,
      releaseUrl: resp.data.html_url || '',
      releaseName: resp.data.name || tag,
      releaseNotes: (resp.data.body || '').slice(0, 500),
    }
  } catch {
    return { hasUpdate: false, latestVersion: null, currentVersion, error: true }
  }
}

module.exports = { checkForUpdate }
