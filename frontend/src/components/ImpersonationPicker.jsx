import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { useImpersonation } from '../lib/useImpersonation'

/**
 * ImpersonationPicker — slide-up modal for admins to pick a user to view-as.
 * Uses /api/staff/search; debounced 300ms. Demo mode: stores choice in
 * localStorage via useImpersonation, no backend wired.
 */
export default function ImpersonationPicker({ open, onClose }) {
  const { set } = useImpersonation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function handleInput(q) {
    setQuery(q)
    clearTimeout(timer.current)
    if (q.length < 2) { setResults([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.get(`/api/staff/search?q=${encodeURIComponent(q)}`)
        setResults(data || [])
      } catch (e) {
        setResults([])
      }
      setLoading(false)
    }, 300)
  }

  function pick(s) {
    set({
      email: s.email,
      name: `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.email,
      school: s.school,
      job_title: s.job_title,
    })
    setQuery('')
    setResults([])
    onClose()
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[900]" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] max-h-[85vh] flex flex-col shadow-[0_-10px_32px_rgba(0,0,0,.22)] animate-slide-up">
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5" />
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="text-base font-extrabold">
              Admin · <span className="text-fls-orange">View as another user</span>
            </div>
            <button onClick={onClose} className="w-[30px] h-[30px] rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center text-lg border-0 cursor-pointer">×</button>
          </div>
          <div className="text-xs text-gray-500 mt-1.5">
            Demo mode — you'll see a banner at the top of every page. Backend not yet wired, so actual data won't change.
          </div>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          <input
            type="text"
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder="Search staff by name…"
            autoFocus
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm outline-none focus:border-fls-orange"
          />
          {loading && <div className="text-xs text-gray-400 mt-2">Searching…</div>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="text-xs text-gray-400 mt-4 text-center">No matches.</div>
          )}
          {results.length > 0 && (
            <div className="mt-3 space-y-1">
              {results.map(s => (
                <button
                  key={s.email}
                  onClick={() => pick(s)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 rounded-lg border border-gray-100 bg-white cursor-pointer font-[inherit]"
                >
                  <div className="text-sm font-semibold">{s.first_name} {s.last_name}</div>
                  <div className="text-xs text-gray-400">{[s.school, s.job_title].filter(Boolean).join(' · ') || s.email}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
