const axios = require('axios')
const store = require('./store')

class ItGlueClient {
  constructor() {
    this._client = null
  }

  getClient() {
    const apiKey = store.get('itGlueApiKey')
    const baseURL = (store.get('itGlueBaseUrl') || 'https://api.eu.itglue.com').replace(/\/$/, '')
    this._client = axios.create({
      baseURL,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/vnd.api+json',
      },
      timeout: 30000,
    })
    return this._client
  }

  async testConnection(apiKey) {
    const baseURL = (store.get('itGlueBaseUrl') || 'https://api.eu.itglue.com').replace(/\/$/, '')
    try {
      const resp = await axios.get(`${baseURL}/organizations?page[size]=1`, {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/vnd.api+json' },
        timeout: 10000,
      })
      const count = resp.data?.meta?.total_count ?? 0
      return { success: true, orgCount: count, message: `Connected — ${count} organisations found` }
    } catch (err) {
      const status = err.response?.status
      const msg = status === 401 ? 'Invalid API key' :
                  status === 403 ? 'API key does not have permission' :
                  status === 404 ? 'Endpoint not found — check your base URL' :
                  err.response?.data?.errors?.[0]?.title ||
                  err.response?.data?.message ||
                  err.message
      return { success: false, orgCount: 0, message: msg }
    }
  }

  async getOrganizations() {
    const apiKey = store.get('itGlueApiKey')
    if (!apiKey) return []

    const client = this.getClient()
    let allOrgs = []
    let page = 1
    const pageSize = 100

    try {
      while (true) {
        const resp = await client.get(`/organizations?page[size]=${pageSize}&page[number]=${page}&filter[psa_integration_type]=manage`)
        const data = resp.data?.data || []
        // Fall back to unfiltered if the filtered call returns empty
        if (page === 1 && data.length === 0) {
          const resp2 = await client.get(`/organizations?page[size]=${pageSize}&page[number]=1`)
          const data2 = resp2.data?.data || []
          allOrgs = data2.map(o => ({
            id: o.id,
            name: o.attributes?.name || '',
            shortName: o.attributes?.short_name || '',
          }))
          break
        }
        allOrgs = allOrgs.concat(data.map(o => ({
          id: o.id,
          name: o.attributes?.name || '',
          shortName: o.attributes?.short_name || '',
        })))
        const meta = resp.data?.meta
        if (!meta || page * pageSize >= (meta.total_count || 0)) break
        page++
      }
    } catch (err) {
      console.error('IT Glue getOrganizations error:', err.response?.status, err.message)
      // Try a simple unfiltered fallback
      try {
        const resp = await client.get(`/organizations?page[size]=100&page[number]=1`)
        return (resp.data?.data || []).map(o => ({
          id: o.id,
          name: o.attributes?.name || '',
          shortName: o.attributes?.short_name || '',
        }))
      } catch {
        return []
      }
    }

    return allOrgs
  }

  async getPasswords(orgId) {
    if (!orgId) return []
    try {
      const client = this.getClient()
      const resp = await client.get(`/passwords?filter[organization_id]=${orgId}&page[size]=100`)
      return (resp.data?.data || []).map(p => ({
        id: p.id,
        name: p.attributes?.name || '',
        username: p.attributes?.username || '',
        resourceType: p.attributes?.resource_type || '',
        password: p.attributes?.password || '',
      }))
    } catch (err) {
      console.error('IT Glue getPasswords error:', err.response?.status, err.message)
      return []
    }
  }
}

const client = new ItGlueClient()
module.exports = client
