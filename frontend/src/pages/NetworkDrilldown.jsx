import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ImpersonationBanner from '../components/ImpersonationBanner'
import { api } from '../lib/api'

/**
 * NetworkDrilldown — section drill-downs reached by tapping comparison
 * cells on Network.jsx.
 *
 *   /app/network/pmap[?school=X]            kind = pmap
 *   /app/network/sr[?school=X]              kind = sr
 *   /app/network/action-steps[?school=X]    kind = action_step
 *   /app/network/fundamentals[?school=X]    kind = fundamentals
 *
 * Layout: nav bar · scope header (Network or School name) · per-row list.
 * Tap a row → StaffProfile for the teacher (or TouchpointDetail for an
 * action step in a future iteration).
 */

const KIND_TITLES = {
  pmap: 'PMAP Completion',
  sr: 'Self-Reflection',
  action_step: 'Action Steps',
  fundamentals: 'Fundamentals',
}

function shortSchool(name) {
  return (name || '').replace(' Charter School', '').replace(' Community School', '').replace(' Academy', '')
}

function pctColor(pct) {
  if (pct == null) return '#9ca3af'
  if (pct >= 90) return '#15803d'
  if (pct >= 70) return '#ca8a04'
  return '#b91c1c'
}

function StateChip({ state }) {
  const map = {
    'Mastered':     { bg: '#ecfdf5', fg: '#15803d' },
    'In Progress':  { bg: '#fff7ed', fg: '#c2410c' },
    'Not Mastered': { bg: '#fee2e2', fg: '#b91c1c' },
  }
  const c = map[state] || { bg: '#f3f4f6', fg: '#6b7280' }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider"
          style={{ background: c.bg, color: c.fg }}>{state}</span>
  )
}

export default function NetworkDrilldown({ kindOverride }) {
  // Determine kind from route — App.jsx will pass kindOverride per route.
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const school = searchParams.get('school') || ''
  const kind = kindOverride

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    const params = new URLSearchParams({ kind })
    if (school) params.set('school', school)
    api.get(`/api/network/drilldown?${params.toString()}`)
       .then(d => { if (alive) { setData(d); setLoading(false) } })
       .catch(e => { if (alive) { setErr(String(e)); setLoading(false) } })
    return () => { alive = false }
  }, [kind, school])

  const title = KIND_TITLES[kind] || kind
  const scopeLabel = school || 'Network'
  const rows = data?.rows || []

  // Per-kind summary at top
  let summary = null
  if (rows.length > 0) {
    if (kind === 'pmap' || kind === 'sr') {
      const done = rows.filter(r => r.completed).length
      const pct = Math.round(100 * done / rows.length)
      summary = `${done} of ${rows.length} (${pct}%)`
    } else if (kind === 'action_step') {
      const m = rows.filter(r => r.state === 'Mastered').length
      const p = rows.filter(r => r.state === 'In Progress').length
      const n = rows.filter(r => r.state === 'Not Mastered').length
      summary = `${rows.length} total · ${m} Mastered · ${p} In Progress · ${n} Not Mastered`
    } else if (kind === 'fundamentals') {
      const lockedIn = rows.filter(r => r.locked_in).length
      const totalVisits = rows.reduce((sum, r) => sum + (r.visits || 0), 0)
      summary = `${rows.length} teachers · ${totalVisits} visits · ${lockedIn} locked-in (mastery)`
    }
  }

  return (
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 80, fontFamily: 'Inter, sans-serif' }}>
      <ImpersonationBanner />
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-[14px] flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app/network'))}
          aria-label="Back"
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border-0 cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </button>
        <Link to="/" className="flex-1 text-center no-underline">
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>{title} · {shortSchool(scopeLabel)}</div>
        </Link>
        <div className="w-8" />
      </nav>

      <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>

        {/* Scope header card */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#002f60', marginTop: 4 }}>{shortSchool(scopeLabel)}</div>
          {summary && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{summary}</div>}
        </div>

        {loading && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: 30 }}>Loading…</div>}
        {err && <div style={{ background: '#fee2e2', borderRadius: 10, padding: 14, color: '#b91c1c', fontSize: 13 }}>Could not load: {err}</div>}
        {!loading && !err && rows.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No records to show.</div>
        )}

        {/* Rows — kind-specific rendering */}
        {!loading && !err && rows.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflow: 'hidden' }}>
            {(kind === 'pmap' || kind === 'sr') && rows.map(r => (
              <button key={r.email}
                onClick={() => navigate(`/app/staff/${encodeURIComponent(r.email)}`)}
                style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{r.name || r.email}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{shortSchool(r.school)} · {r.job_title}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {r.completed
                    ? <>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.05em' }}>✓ Done</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{r.last_date}</div>
                      </>
                    : <div style={{ fontSize: 11, fontWeight: 800, color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '.05em' }}>Open</div>
                  }
                </div>
              </button>
            ))}

            {kind === 'action_step' && rows.map(r => (
              <button key={r.id}
                onClick={() => navigate(`/app/staff/${encodeURIComponent(r.teacher_email)}`)}
                style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{r.teacher_name || r.teacher_email}</div>
                  <StateChip state={r.state} />
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{shortSchool(r.school)} · created {r.created_at}{r.creator_name ? ` · by ${r.creator_name}` : ''}</div>
                {r.body_text && <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4, background: '#f9fafb', padding: '6px 8px', borderRadius: 6 }}>{r.body_text}</div>}
              </button>
            ))}

            {kind === 'fundamentals' && rows.map(r => (
              <button key={r.email}
                onClick={() => navigate(`/app/staff/${encodeURIComponent(r.email)}`)}
                style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
                    {r.name || r.email}
                    {r.locked_in && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 4, letterSpacing: '.05em', textTransform: 'uppercase' }}>✓ Locked-in</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{shortSchool(r.school)} · {r.job_title}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: pctColor(r.rb_avg) }}>{r.rb_avg != null ? `${r.rb_avg}%` : '—'}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{r.visits || 0} visits</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
