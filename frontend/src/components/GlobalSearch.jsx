import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

/**
 * GlobalSearch — persistent header search input. Type a name, see
 * matching staff, tap a row to jump to their profile.
 *
 * Reuses /api/staff/search so it's scoped to what the user can access.
 * Keyboard: '/' or cmd/ctrl+k focuses the input.
 */
export default function GlobalSearch({ className = '' }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const boxRef = useRef(null)

  // Global keyboard shortcut: / or cmd/ctrl+k to focus
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable
      if (e.key === '/' && !typing) { e.preventDefault(); inputRef.current?.focus() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Search with debounce
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]); return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/api/staff/search?q=${encodeURIComponent(q.trim())}`)
        setResults(Array.isArray(r) ? r : [])
        setHighlight(0)
      } catch { setResults([]) }
      setLoading(false)
    }, 180)
    return () => clearTimeout(t)
  }, [q])

  // Click outside closes
  useEffect(() => {
    function onDown(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function pick(row) {
    if (!row?.email) return
    setOpen(false)
    setQ('')
    navigate(`/app/staff/${encodeURIComponent(row.email)}`)
  }

  function onKey(e) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); pick(results[highlight]) }
    if (e.key === 'Escape')    { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Jump to staff… (press /)"
        className="w-full h-9 rounded-[10px] bg-white/10 text-white placeholder-white/60 pl-9 pr-3 text-[13px] border-0 outline-none focus:bg-white/20"
      />
      <svg width="14" height="14" fill="none" stroke="white" strokeOpacity=".6" strokeWidth="2"
           className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
        <circle cx="6" cy="6" r="4.5" />
        <path d="m11 11-2.5-2.5" />
      </svg>

      {open && (results.length > 0 || loading) && (
        <div className="absolute top-[42px] left-0 right-0 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50 max-h-[360px] overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="text-[12px] text-gray-400 px-4 py-3">Searching…</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.email}
              onClick={() => pick(r)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 border-0 font-[inherit] cursor-pointer ${
                i === highlight ? 'bg-gray-50' : 'bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-fls-navy text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                {(((r.first_name || '')[0] || '') + ((r.last_name || '')[0] || '')).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-gray-900 truncate">
                  {[r.first_name, r.last_name].filter(Boolean).join(' ') || r.email}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {[r.job_title, r.school].filter(Boolean).join(' · ') || r.email}
                </div>
              </div>
            </button>
          ))}
          {!loading && results.length === 0 && q.trim().length >= 2 && (
            <div className="text-[12px] text-gray-400 px-4 py-3">No matches</div>
          )}
        </div>
      )}
    </div>
  )
}
