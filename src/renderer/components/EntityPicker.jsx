import React, { useState, useEffect, useRef } from 'react'

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// Avatar with initial letter
function Avatar({ name, size = 'sm' }) {
  const s = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-sm'
  return (
    <div className={`${s} rounded-full bg-navy/15 flex items-center justify-center flex-shrink-0`}>
      <span className="font-semibold text-navy leading-none">
        {(name || '?').charAt(0).toUpperCase()}
      </span>
    </div>
  )
}

/**
 * Search-as-you-type picker for Entra ID users or groups.
 *
 * Props:
 *   type       – 'users' | 'groups'
 *   selected   – Array<{ id, displayName, mail?, description? }>
 *   onChange   – (items) => void
 *   disabled   – boolean
 *   noSession  – boolean   suppress live search; show Object ID entry only
 */
export default function EntityPicker({ type = 'users', selected = [], onChange, disabled, noSession }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)
  const [error,   setError]   = useState(null)

  const debouncedQuery = useDebounce(query, 300)
  const inputRef   = useRef(null)
  const containerRef = useRef(null)

  const selectedIds = new Set(selected.map(s => s.id))

  // Search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.length < 2) {
      setResults([])
      return
    }
    if (noSession) {
      // No live session — Object ID entry only, no IPC call needed
      setResults([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const fn = type === 'users'
      ? window.api?.tenant?.searchUsers
      : window.api?.tenant?.searchGroups
    if (!fn) { setLoading(false); return }
    fn(debouncedQuery.trim())
      .then(res => {
        setResults(res?.items || [])
        if (res?.error) setError(res.error)
        setOpen(true)
      })
      .catch(e => { setError(e.message); setResults([]) })
      .finally(() => setLoading(false))
  }, [debouncedQuery, type, noSession])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addItem = (item) => {
    if (!selectedIds.has(item.id)) onChange([...selected, item])
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.focus()
  }

  const removeItem = (id) => onChange(selected.filter(s => s.id !== id))

  // Typing a raw Object ID and pressing Enter adds it directly
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      const id = query.trim()
      if (!selectedIds.has(id)) onChange([...selected, { id, displayName: id }])
      setQuery('')
      setResults([])
      setOpen(false)
    }
    if (e.key === 'Escape') setOpen(false)
    if (e.key === 'Backspace' && !query && selected.length) {
      removeItem(selected[selected.length - 1].id)
    }
  }

  const visibleResults = results.filter(r => !selectedIds.has(r.id))
  const placeholder = noSession
    ? 'Paste an Object ID and press Enter…'
    : type === 'users' ? 'Search by name or email…' : 'Search by group name…'
  const hint = noSession
    ? 'Connect a tenant to enable live search — or paste an Object ID and press Enter to add directly'
    : type === 'users'
      ? 'Search for users, or paste an Object ID and press Enter'
      : 'Search for groups, or paste an Object ID and press Enter'

  return (
    <div className="space-y-2" ref={containerRef}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(item => {
            const isRawId = item.displayName === item.id
            return (
              <span
                key={item.id}
                className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-full text-xs font-medium bg-navy/10 text-navy border border-navy/20"
              >
                <Avatar name={isRawId ? '#' : item.displayName} />
                <span className="max-w-[160px] truncate" title={item.id}>
                  {isRawId ? item.id.slice(0, 8) + '…' : item.displayName}
                </span>
                {item.mail && !isRawId && (
                  <span className="text-navy/50 truncate max-w-[100px] hidden sm:inline">{item.mail}</span>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-colors text-navy/50"
                    aria-label={`Remove ${item.displayName}`}
                  >
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" d="M2 2l6 6M8 2l-6 6" />
                    </svg>
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); if (e.target.value.length >= 2) setOpen(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => visibleResults.length > 0 && setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="block w-full rounded-md border border-gray-300 pl-3 pr-8 py-2 text-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-gray-50 disabled:text-gray-400"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="animate-spin w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
        {!loading && query.length > 0 && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        )}

        {/* Dropdown */}
        {open && (visibleResults.length > 0 || error) && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
            {error && (
              <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{error}</div>
            )}
            {visibleResults.map(item => (
              <button
                key={item.id}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => addItem(item)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <Avatar name={item.displayName} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.displayName}</p>
                  {item.mail && (
                    <p className="text-xs text-gray-400 truncate">{item.mail}</p>
                  )}
                  {item.description && !item.mail && (
                    <p className="text-xs text-gray-400 truncate">{item.description}</p>
                  )}
                </div>
                <svg className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            ))}
            {results.length > 0 && visibleResults.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400 text-center">All matching results already selected</p>
            )}
          </div>
        )}

        {open && !loading && query.length >= 2 && results.length === 0 && !error && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs text-gray-400">
            No results — press Enter to add <span className="font-mono bg-gray-100 px-1 rounded">{query}</span> as a raw Object ID
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">{hint}</p>
    </div>
  )
}
