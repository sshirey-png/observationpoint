import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import ImpersonationBanner from '../components/ImpersonationBanner'
import { api } from '../lib/api'

/**
 * NetworkDrilldown — section drill-downs reached by tapping comparison
 * cells on Network.jsx.
 *
 *   /app/network/evaluations[?school=X]    kind = evaluations  (PMAP + SR combined)
 *   /app/network/action-steps[?school=X]   kind = action_step
 *   /app/network/fundamentals[?school=X]   kind = fundamentals
 *
 * Layout: nav bar · scope card · filter bar · per-row list. Tap a row →
 * StaffProfile for the teacher.
 */

const KIND_TITLES = {
  evaluations: 'Evaluations',
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

// "2 days ago" / "1 week ago" / "3 weeks ago" — leader-friendly, no exact date.
function relTime(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return '1 week ago'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 60) return '1 month ago'
  return `${Math.floor(days / 30)} months ago`
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

// Dual-pill PMAP+SR badge for evaluations rows.
function EvalPill({ label, done, dateStr }) {
  const bg = done ? '#ecfdf5' : '#fee2e2'
  const border = done ? '#bbf7d0' : '#fecaca'
  const fg = done ? '#15803d' : '#b91c1c'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  minWidth: 54, padding: '5px 8px', borderRadius: 7, background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 8, fontWeight: 800, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', lineHeight: 1 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 800, color: fg, marginTop: 3, lineHeight: 1 }}>{done ? '✓' : 'Open'}</div>
    </div>
  )
}

export default function NetworkDrilldown({ kindOverride }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const school = searchParams.get('school') || ''
  const kind = kindOverride

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  // Filter state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')   // kind-specific
  const [roleFilter, setRoleFilter] = useState('all')

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
  const allRows = data?.rows || []

  // Build role dropdown options from data (job_function values present in rows).
  const roleOptions = useMemo(() => {
    const set = new Set()
    for (const r of allRows) {
      const jf = r.job_function || (kind === 'action_step' ? '' : '') || ''
      if (jf) set.add(jf)
    }
    return ['all', ...Array.from(set).sort()]
  }, [allRows, kind])

  // Status segments per kind
  const statusSegments = useMemo(() => {
    if (kind === 'evaluations') {
      return [
        { key: 'all', label: 'All' },
        { key: 'both_done', label: 'Both Done' },
        { key: 'one_open', label: '1 Open' },
        { key: 'both_open', label: 'Both Open' },
      ]
    }
    if (kind === 'action_step') {
      return [
        { key: 'all', label: 'All' },
        { key: 'mastered', label: 'Mastered' },
        { key: 'in_progress', label: 'Progress' },
        { key: 'not_mastered', label: 'Not' },
      ]
    }
    if (kind === 'fundamentals') {
      return [
        { key: 'all', label: 'All' },
        { key: 'locked', label: 'Locked-in' },
        { key: 'not_locked', label: 'Not yet' },
      ]
    }
    return []
  }, [kind])

  // Filtered rows (client-side; lists are typically <500 rows).
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allRows.filter(r => {
      // Search across name + email + role + school + body_text
      if (q) {
        const hay = [r.name, r.email, r.teacher_name, r.teacher_email, r.job_title, r.job_function, r.school, r.body_text]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      // Role filter (skip for action_step; those use teacher record's job_title only)
      if (roleFilter !== 'all') {
        const jf = r.job_function || ''
        if (jf !== roleFilter) return false
      }
      // Status filter
      if (statusFilter !== 'all') {
        if (kind === 'evaluations') {
          const done = (r.pmap_completed ? 1 : 0) + (r.sr_completed ? 1 : 0)
          if (statusFilter === 'both_done' && done !== 2) return false
          if (statusFilter === 'one_open' && done !== 1) return false
          if (statusFilter === 'both_open' && done !== 0) return false
        } else if (kind === 'action_step') {
          if (statusFilter === 'mastered' && r.state !== 'Mastered') return false
          if (statusFilter === 'in_progress' && r.state !== 'In Progress') return false
          if (statusFilter === 'not_mastered' && r.state !== 'Not Mastered') return false
        } else if (kind === 'fundamentals') {
          if (statusFilter === 'locked' && !r.locked_in) return false
          if (statusFilter === 'not_locked' && r.locked_in) return false
        }
      }
      return true
    })
  }, [allRows, search, statusFilter, roleFilter, kind])

  // Per-kind summary based on the FULL set, not filtered.
  let summary = null
  if (allRows.length > 0) {
    if (kind === 'evaluations') {
      const pmapDone = allRows.filter(r => r.pmap_completed).length
      const srDone = allRows.filter(r => r.sr_completed).length
      const pmapPct = Math.round(100 * pmapDone / allRows.length)
      const srPct = Math.round(100 * srDone / allRows.length)
      summary = (
        <>SR <b style={{ color: '#002f60' }}>{srPct}%</b> ({srDone}/{allRows.length}) ·
           PMAP <b style={{ color: '#002f60' }}>{pmapPct}%</b> ({pmapDone}/{allRows.length})</>
      )
    } else if (kind === 'action_step') {
      const m = allRows.filter(r => r.state === 'Mastered').length
      const p = allRows.filter(r => r.state === 'In Progress').length
      const n = allRows.filter(r => r.state === 'Not Mastered').length
      summary = `${allRows.length} total · ${m} Mastered · ${p} In Progress · ${n} Not Mastered`
    } else if (kind === 'fundamentals') {
      const lockedIn = allRows.filter(r => r.locked_in).length
      const totalVisits = allRows.reduce((sum, r) => sum + (r.visits || 0), 0)
      summary = `${allRows.length} teachers · ${totalVisits} visits · ${lockedIn} locked-in (mastery)`
    }
  }

  // Status segment counts (computed against full set so the segment shows
  // the underlying tally rather than the filtered count).
  const segCount = (segKey) => {
    if (segKey === 'all') return allRows.length
    if (kind === 'evaluations') {
      if (segKey === 'both_done') return allRows.filter(r => r.pmap_completed && r.sr_completed).length
      if (segKey === 'one_open') return allRows.filter(r => (r.pmap_completed ? 1 : 0) + (r.sr_completed ? 1 : 0) === 1).length
      if (segKey === 'both_open') return allRows.filter(r => !r.pmap_completed && !r.sr_completed).length
    }
    if (kind === 'action_step') {
      if (segKey === 'mastered') return allRows.filter(r => r.state === 'Mastered').length
      if (segKey === 'in_progress') return allRows.filter(r => r.state === 'In Progress').length
      if (segKey === 'not_mastered') return allRows.filter(r => r.state === 'Not Mastered').length
    }
    if (kind === 'fundamentals') {
      if (segKey === 'locked') return allRows.filter(r => r.locked_in).length
      if (segKey === 'not_locked') return allRows.filter(r => !r.locked_in).length
    }
    return 0
  }

  const STYLES = {
    page: { minHeight: '100svh', background: '#f5f7fa', paddingBottom: 80, fontFamily: 'Inter, sans-serif' },
    card: { background: '#fff', borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' },
    rowItem: { padding: '12px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid #f3f4f6',
               cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left',
               display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  }

  return (
    <div style={STYLES.page}>
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

        {/* Scope header */}
        <div style={{ ...STYLES.card, padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#002f60', marginTop: 4 }}>{shortSchool(scopeLabel)}</div>
          {summary && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{summary}</div>}
        </div>

        {/* Filter bar — only when there are rows */}
        {!loading && !err && allRows.length > 0 && (
          <div style={{ ...STYLES.card, padding: 10, marginBottom: 10 }}>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 12 }}>🔍</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={kind === 'action_step' ? 'Search teacher, step text…' : 'Search teacher, role…'}
                style={{ width: '100%', padding: '8px 10px 8px 30px', border: '1px solid #e5e7eb', borderRadius: 9,
                         fontSize: 12, background: '#f9fafb', fontFamily: 'inherit', outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 3, gap: 2, marginBottom: 8 }}>
              {statusSegments.map(seg => {
                const on = statusFilter === seg.key
                return (
                  <button key={seg.key} onClick={() => setStatusFilter(seg.key)}
                    style={{ flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                             background: on ? '#fff' : 'transparent', color: on ? '#002f60' : '#6b7280',
                             border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.04em',
                             boxShadow: on ? '0 1px 2px rgba(0,0,0,.08)' : 'none', fontFamily: 'inherit' }}>
                    {seg.label} · {segCount(seg.key)}
                  </button>
                )
              })}
            </div>
            {roleOptions.length > 1 && (
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 8,
                         fontSize: 11, fontWeight: 600, background: '#f9fafb', color: '#374151',
                         fontFamily: 'inherit', cursor: 'pointer' }}
              >
                {roleOptions.map(r => <option key={r} value={r}>{r === 'all' ? 'All Roles' : r}</option>)}
              </select>
            )}
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, textAlign: 'right' }}>
              Showing <b style={{ color: '#002f60' }}>{rows.length} of {allRows.length}</b>
            </div>
          </div>
        )}

        {loading && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: 30 }}>Loading…</div>}
        {err && <div style={{ background: '#fee2e2', borderRadius: 10, padding: 14, color: '#b91c1c', fontSize: 13 }}>Could not load: {err}</div>}
        {!loading && !err && allRows.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 30, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No records to show.</div>
        )}
        {!loading && !err && allRows.length > 0 && rows.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No matches for the current filters.</div>
        )}

        {/* Rows */}
        {!loading && !err && rows.length > 0 && (
          <div style={{ ...STYLES.card, overflow: 'hidden' }}>
            {kind === 'evaluations' && rows.map(r => (
              <button key={r.email}
                onClick={() => navigate(`/app/staff/${encodeURIComponent(r.email)}`)}
                style={STYLES.rowItem}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{r.name || r.email}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{shortSchool(r.school)} · {r.job_title}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <EvalPill label="SR" done={r.sr_completed} dateStr={r.sr_date} />
                  <EvalPill label="PMAP" done={r.pmap_completed} dateStr={r.pmap_date} />
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
                style={STYLES.rowItem}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
                    {r.name || r.email}
                    {r.locked_in && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 4, letterSpacing: '.05em', textTransform: 'uppercase' }}>✓ Locked-in</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{shortSchool(r.school)} · {r.job_title} · {r.visits || 0} visits</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: pctColor(r.rb_avg) }}>{r.rb_avg != null ? `${r.rb_avg}%` : '—'}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{r.last_visit ? relTime(r.last_visit) : 'No visits yet'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
