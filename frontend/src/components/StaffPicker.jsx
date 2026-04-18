import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'

/**
 * StaffPicker — search and select a staff member.
 * Used in every form. Hits /api/staff/search, returns matches.
 * Supports pre-selection via initialEmail prop (from URL ?teacher=).
 *
 * Props:
 *   onSelect(staff) — called when a staff member is picked
 *   selected — the currently selected staff member (or null)
 *   initialEmail — if set, auto-fetch and select this staff member on mount
 */
export default function StaffPicker({ onSelect, selected, initialEmail }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)
  const didInit = useRef(false)

  // Pre-select from initialEmail prop (e.g., from ?teacher= URL param)
  useEffect(() => {
    if (initialEmail && !selected && !didInit.current) {
      didInit.current = true
      api.get(`/api/staff/search?q=${encodeURIComponent(initialEmail)}`).then(data => {
        if (data && data.length > 0) {
          const match = data.find(s => s.email === initialEmail) || data[0]
          onSelect(match)
        }
      })
    }
  }, [initialEmail])

  function handleInput(q) {
    setQuery(q)
    clearTimeout(timer.current)
    if (q.length < 2) { setResults([]); return }

    // Debounce: wait 300ms after typing stops before searching
    timer.current = setTimeout(async () => {
      setLoading(true)
      const data = await api.get(`/api/staff/search?q=${encodeURIComponent(q)}`)
      if (data) setResults(data)
      setLoading(false)
    }, 300)
  }

  function pick(staff) {
    onSelect(staff)
    setQuery('')
    setResults([])
  }

  function clear() {
    onSelect(null)
  }

  // If a teacher is already selected, show their banner
  if (selected) {
    const initials = ((selected.first_name?.[0] || '') + (selected.last_name?.[0] || '')).toUpperCase()
    return (
      <div className="flex items-center gap-3 p-3.5 bg-white border-b border-gray-200">
        <div className="w-10 h-10 rounded-[10px] bg-fls-navy text-white flex items-center justify-center text-sm font-bold shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold truncate">
            {selected.first_name} {selected.last_name}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {[selected.school, selected.job_title].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          onClick={clear}
          className="text-xs text-gray-400 px-2 py-1 rounded hover:bg-gray-100"
        >
          Change
        </button>
      </div>
    )
  }

  // Search mode
  return (
    <div className="bg-white border-b border-gray-200 p-3.5">
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        placeholder="Search staff by name..."
        autoFocus
        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-fls-orange"
      />
      {loading && <div className="text-xs text-gray-400 mt-2 px-1">Searching...</div>}
      {results.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-100">
          {results.map((s) => (
            <button
              key={s.email}
              onClick={() => pick(s)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <div className="text-sm font-medium">{s.first_name} {s.last_name}</div>
              <div className="text-xs text-gray-400">
                {[s.school, s.job_title].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
