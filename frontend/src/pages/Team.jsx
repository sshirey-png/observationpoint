import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import AIPanel from '../components/AIPanel'
import ImpersonationBanner from '../components/ImpersonationBanner'
import GlobalSearch from '../components/GlobalSearch'
import { api } from '../lib/api'

/**
 * Team — My Team page. Real data from /api/my-team.
 *
 * Layout:
 *   - Nav (logo + back arrow to home)
 *   - Worth a look today — 3 AI-surfaced findings at top
 *   - Stats strip (staff / touchpoints / avg)
 *   - View toggle + search + job-function filters
 *   - Staff list (tap → /app/staff/:email)
 *   - Bottom nav (Team active)
 *   - Inline AI panel
 */

function initials(name) {
  const p = (name || '').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '—'
}

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24))
}

export default function Team() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [staff, setStaff] = useState([])
  const [view, setView] = useState(searchParams.get('view') || 'direct')
  const [search, setSearch] = useState('')
  const [filterFn, setFilterFn] = useState('all')
  const [loading, setLoading] = useState(true)
  const [aiOpen, setAiOpen] = useState(false)

  function changeView(v) {
    setView(v)
    setSearchParams({ view: v }, { replace: true })
  }

  async function load(v) {
    setLoading(true)
    try {
      const data = await api.get(`/api/my-team?view=${v}`)
      if (data) setStaff(data.staff || [])
    } catch (e) {
      console.error('Failed to load team', e)
      setStaff([])
    }
    setLoading(false)
  }

  useEffect(() => { load(view) }, [view])

  // Stats
  const totalTPs = staff.reduce((sum, s) => sum + (s.touchpoint_count || 0), 0)
  const avg = staff.length ? (totalTPs / staff.length).toFixed(1) : '—'

  // "Worth a look today" — derived from staff data
  const walItems = (() => {
    const items = []
    // biggest touchpoint count (rough proxy for "active teacher")
    const top = [...staff].sort((a, b) => (b.touchpoint_count || 0) - (a.touchpoint_count || 0))[0]
    if (top && top.touchpoint_count > 0) {
      items.push({
        icon: '↑', iconBg: '#059669',
        text: <><b>{top.name}:</b> {top.touchpoint_count} touchpoints this year — most on your team</>,
        to: `/app/staff/${encodeURIComponent(top.email)}`,
      })
    }
    // longest-quiet teacher
    const quiet = [...staff]
      .filter(s => s.last_touchpoint_date)
      .map(s => ({ ...s, _days: daysSince(s.last_touchpoint_date) }))
      .sort((a, b) => b._days - a._days)[0]
    if (quiet && quiet._days >= 21) {
      items.push({
        icon: '!', iconBg: '#e47727',
        text: <><b>{quiet.name}</b> — no touchpoint in {quiet._days} days</>,
        to: `/app/staff/${encodeURIComponent(quiet.email)}`,
      })
    }
    // teachers with no touchpoints
    const untouched = staff.filter(s => !s.last_touchpoint_date).length
    if (untouched > 0) {
      items.push({
        icon: '⏱', iconBg: '#dc2626',
        text: <><b>{untouched} teachers</b> have no touchpoints on record yet</>,
        to: null,
      })
    }
    return items.slice(0, 3)
  })()

  // Job function filter options from data
  const fnSet = [...new Set(staff.map(s => s.job_function).filter(Boolean))].sort()

  // Filter
  const filtered = staff.filter(s => {
    if (search && !(`${s.name} ${s.job_title} ${s.school}`).toLowerCase().includes(search.toLowerCase())) return false
    if (filterFn !== 'all' && s.job_function !== filterFn) return false
    return true
  })

  return (
    <div className="min-h-[100svh] bg-[#f5f7fa] pb-20">
      <ImpersonationBanner />
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="Back"
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border-0 cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </button>
        <Link to="/" className="flex-1 text-center text-[16px] font-bold text-white no-underline">
          My Team
        </Link>
        <div className="w-8" />
      </nav>

      <div className="px-4 pt-4 max-w-[600px] mx-auto">
        {/* Worth a look today */}
        {walItems.length > 0 && (
          <div
            className="rounded-[14px] p-3.5 mb-3.5 text-white shadow-[0_4px_14px_rgba(0,47,96,.15)]"
            style={{ background: 'linear-gradient(135deg,#002f60,#1e40af)' }}
          >
            <div className="text-[10px] font-extrabold tracking-widest uppercase mb-2" style={{ color: '#fbbe82' }}>
              ✦ Worth a look today
            </div>
            {walItems.map((item, i) => {
              const inner = (
                <>
                  <div
                    className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center shrink-0 text-xs font-extrabold"
                    style={{ background: 'rgba(255,255,255,.12)', color: item.iconBg === '#059669' ? '#86efac' : item.iconBg === '#e47727' ? '#fbbe82' : '#fca5a5' }}
                  >{item.icon}</div>
                  <div className="flex-1 text-xs leading-snug" style={{ color: 'rgba(255,255,255,.9)' }}>
                    {item.text}
                  </div>
                  <div className="text-white/40 text-sm">›</div>
                </>
              )
              const cls = 'flex items-center gap-2.5 py-2 border-b border-white/10 last:border-0 no-underline'
              return item.to
                ? <Link key={i} to={item.to} className={cls}>{inner}</Link>
                : <div key={i} className={cls}>{inner}</div>
            })}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
            <div className="text-[22px] font-extrabold text-fls-navy">{staff.length}</div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Staff</div>
          </div>
          <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
            <div className="text-[22px] font-extrabold text-fls-navy">{totalTPs}</div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">TouchPoints</div>
          </div>
          <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
            <div className="text-[22px] font-extrabold text-fls-navy">{avg}</div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Avg / Person</div>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-1.5 mb-3">
          <button
            onClick={() => changeView('direct')}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-all ${
              view === 'direct' ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >My Direct Reports</button>
          <button
            onClick={() => changeView('all')}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-all ${
              view === 'all' ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >All Staff</button>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search staff..."
          className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-[13px] outline-none focus:border-fls-orange mb-3 bg-white"
        />

        {/* Job function filters */}
        {fnSet.length > 1 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
            <button
              onClick={() => setFilterFn('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap ${
                filterFn === 'all' ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white border-gray-200'
              }`}
            >All</button>
            {fnSet.map(fn => (
              <button
                key={fn}
                onClick={() => setFilterFn(fn)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap ${
                  filterFn === fn ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white border-gray-200'
                }`}
              >{fn}</button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center text-gray-400 text-sm py-10">Loading team...</div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-10 bg-white rounded-xl">
            {staff.length === 0 ? 'No direct reports found' : 'No matches'}
          </div>
        )}

        {/* Staff cards */}
        <div className="space-y-2">
          {filtered.map(s => {
            const days = daysSince(s.last_touchpoint_date)
            const types = []
            if (s.observation_count) types.push(`${s.observation_count} Obs`)
            if (s.pmap_count) types.push(`${s.pmap_count} PMAP`)
            if (s.sr_count) types.push(`${s.sr_count} SR`)
            if (s.feedback_count) types.push(`${s.feedback_count} Feedback`)
            if (s.meeting_count) types.push(`${s.meeting_count} Meeting`)

            return (
              <Link
                key={s.email}
                to={`/app/staff/${encodeURIComponent(s.email)}`}
                className="block bg-white rounded-xl shadow-sm p-3 no-underline text-inherit active:scale-[.98] transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-[10px] bg-fls-navy text-white flex items-center justify-center text-sm font-bold shrink-0">
                    {initials(s.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{s.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">{s.job_title} · {s.school}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-extrabold text-fls-navy">{s.touchpoint_count}</div>
                    <div className="text-[9px] text-gray-400 uppercase">touchpoints</div>
                  </div>
                </div>

                {types.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {types.map(t => (
                      <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-[11px] text-gray-400 mt-1.5">
                  {days !== null ? `Last touchpoint ${days} day${days === 1 ? '' : 's'} ago` : 'No touchpoints yet'}
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <BottomNav active="team" onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="team" subject={`${staff.length} teachers`} />
    </div>
  )
}
