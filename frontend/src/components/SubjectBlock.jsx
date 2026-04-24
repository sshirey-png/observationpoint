import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'

/**
 * SubjectBlock — single "who is this about" block for every form.
 * Empty: search input (debounced /api/staff/search).
 * Selected: navy hero with avatar, name, school + optional role meta/badge, Change link.
 *
 * Props:
 *   selected        — currently selected staff (or null)
 *   onSelect(staff) — called when picked (or null on Change)
 *   initialEmail    — pre-select via ?teacher= URL param
 *   roleLabel       — optional small badge inside hero (e.g. "PMAP · PreK")
 *   subMeta         — optional extra line after school (e.g. job_title)
 *   pickerLabel     — label over empty-state search. Default "Who is this about?"
 */
export default function SubjectBlock({
  selected,
  onSelect,
  initialEmail,
  roleLabel = '',
  subMeta = '',
  pickerLabel = 'Who is this about?',
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)
  const didInit = useRef(false)

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

  if (selected) {
    const initials = ((selected.first_name?.[0] || '') + (selected.last_name?.[0] || '')).toUpperCase()
    const metaParts = [selected.school, subMeta || selected.job_title].filter(Boolean)
    return (
      <div style={{
        position: 'relative',
        background: 'linear-gradient(135deg, #002f60, #003b7a)',
        borderRadius: 14, padding: 14, marginBottom: 12, color: '#fff',
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 3px 10px rgba(0,47,96,.2)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', background: '#e47727',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17, fontWeight: 800, flexShrink: 0,
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2, color: '#fff' }}>
            {selected.first_name} {selected.last_name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', marginTop: 3 }}>
            {metaParts.join(' · ') || '—'}
            {roleLabel && (
              <span style={{
                display: 'inline-block', background: 'rgba(255,255,255,.15)',
                padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, marginLeft: 6,
              }}>{roleLabel}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => onSelect(null)}
          style={{
            position: 'absolute', top: 10, right: 12,
            fontSize: 11, color: 'rgba(255,255,255,.85)',
            background: 'rgba(255,255,255,.1)',
            padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
            border: '1px solid rgba(255,255,255,.2)', fontWeight: 600,
            fontFamily: 'inherit',
          }}
        >Change</button>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        placeholder="Search staff by name..."
        autoFocus
        style={{
          width: '100%', padding: '12px 14px',
          border: '1.5px solid #e5e7eb', borderRadius: 10,
          fontSize: 14, fontFamily: 'inherit', color: '#111827', outline: 'none',
          boxSizing: 'border-box', background: '#fff',
        }}
      />
      {loading && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, paddingLeft: 4 }}>Searching…</div>
      )}
      {results.length > 0 && (
        <div style={{
          marginTop: 8, maxHeight: 240, overflowY: 'auto',
          borderRadius: 10, border: '1px solid #f3f4f6',
        }}>
          {results.map((s) => (
            <button
              key={s.email}
              onClick={() => pick(s)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                background: '#fff', border: 'none', borderBottom: '1px solid #f3f4f6',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                {s.first_name} {s.last_name}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {[s.school, s.job_title].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
