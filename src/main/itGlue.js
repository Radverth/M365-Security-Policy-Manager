const axios = require('axios')
const { store, getApiKey } = require('./store')
const logger = require('./logger')

class ItGlueClient {
  constructor() {
    this._client = null
  }

  getClient() {
    const apiKey = getApiKey()
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
    const apiKey = getApiKey()
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
      logger.error('IT Glue getOrganizations error:', err.response?.status, err.message)
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

  // Human-readable message for an IT Glue API error
  static describeError(err) {
    const status = err.response?.status
    if (status === 401) return 'Invalid API key — check your IT Glue settings'
    if (status === 403) return 'API key does not have permission to write documents in this organisation'
    if (status === 404) return 'Endpoint not found — your IT Glue plan or API key may not support the Documents API'
    if (status === 413) return 'Backup is too large for IT Glue to accept as an attachment'
    if (status === 422) {
      const detail = err.response?.data?.errors?.[0]?.detail || err.response?.data?.errors?.[0]?.title
      return `IT Glue rejected the request${detail ? `: ${detail}` : ''}`
    }
    return err.response?.data?.errors?.[0]?.title ||
           err.response?.data?.message ||
           err.message
  }

  // Creates an (empty) document in the organisation's Documents section.
  // POST /organizations/:org_id/relationships/documents
  async createDocument(orgId, name) {
    const client = this.getClient()
    const resp = await client.post(
      `/organizations/${encodeURIComponent(orgId)}/relationships/documents`,
      { data: { type: 'documents', attributes: { name } } },
    )
    const doc = Array.isArray(resp.data?.data) ? resp.data.data[0] : resp.data?.data
    if (!doc?.id) throw new Error('IT Glue did not return a document ID')
    return { id: doc.id, name: doc.attributes?.name || name }
  }

  // Attaches a file (base64-encoded) to an existing document.
  // POST /documents/:document_id/relationships/attachments
  async attachFileToDocument(documentId, fileName, contentBase64) {
    const client = this.getClient()
    await client.post(
      `/documents/${encodeURIComponent(documentId)}/relationships/attachments`,
      { data: { type: 'attachments', attributes: { attachment: { content: contentBase64, file_name: fileName } } } },
      // Attachment payloads can be several MB of base64 — allow a generous window
      { timeout: 180000, maxBodyLength: Infinity, maxContentLength: Infinity },
    )
    return true
  }

  // Creates a document in the org's Documents section and attaches the given
  // file to it. Cleans up nothing on failure — a document without its
  // attachment is surfaced in the error message so the user can retry or
  // delete it manually.
  async uploadBackup({ orgId, documentName, fileName, contentBase64 }) {
    if (!getApiKey()) return { success: false, error: 'IT Glue API key not configured — set it in Settings' }
    if (!orgId) return { success: false, error: 'No IT Glue organisation selected' }

    let doc
    try {
      doc = await this.createDocument(orgId, documentName)
    } catch (err) {
      const msg = ItGlueClient.describeError(err)
      logger.error('IT Glue createDocument error:', err.response?.status, err.message)
      return { success: false, error: `Could not create document: ${msg}` }
    }

    try {
      await this.attachFileToDocument(doc.id, fileName, contentBase64)
    } catch (err) {
      const msg = ItGlueClient.describeError(err)
      logger.error('IT Glue attachFileToDocument error:', err.response?.status, err.message)
      return {
        success: false,
        error: `Document "${doc.name}" was created but the zip upload failed: ${msg}. Delete the empty document in IT Glue before retrying.`,
      }
    }

    logger.info(`IT Glue backup uploaded: org=${orgId} document=${doc.id} file=${fileName}`)
    return { success: true, documentId: doc.id, documentName: doc.name }
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
      logger.error('IT Glue getPasswords error:', err.response?.status, err.message)
      return []
    }
  }
}

const client = new ItGlueClient()
module.exports = client
