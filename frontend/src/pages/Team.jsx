import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import { api } from '../lib/api'

/**
 * Team — My Team page. Shows direct reports or all staff.
 * Each card shows touchpoint counts by type, last touchpoint date.
 * Tap card → staff profile.
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [staff, setStaff] = useState([])
  const [view, setView] = useState(searchParams.get('view') || 'direct')
  const [search, setSearch] = useState('')
  const [filterFn, setFilterFn] = useState('all')
  const [loading, setLoading] = useState(true)

  function changeView(v) {
    setView(v)
    setSearchParams({ view: v }, { replace: true })
  }

  async function load(v) {
    setLoading(true)
    const data = await api.get(`/api/my-team?view=${v}`)
    if (data) setStaff(data.staff || [])
    setLoading(false)
  }

  useEffect(() => { load(view) }, [view])

  // Compute stats
  const totalTPs = staff.reduce((sum, s) => sum + s.touchpoint_count, 0)
  const avg = staff.length ? (totalTPs / staff.length).toFixed(1) : '—'

  // Build job function filter options from data
  const fnSet = [...new Set(staff.map(s => s.job_function).filter(Boolean))].sort()

  // Filter
  const filtered = staff.filter(s => {
    if (search && !(`${s.name} ${s.job_title} ${s.school}`).toLowerCase().includes(search.toLowerCase())) return false
    if (filterFn !== 'all' && s.job_function !== filterFn) return false
    return true
  })

  return (
    <div className="pb-10">
      <Nav title="My Team" />

      <div className="px-4 pt-4">
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
          className="w-full px-3 py-2.5 pl-9 border border-gray-200 rounded-[10px] text-[13px] outline-none focus:border-fls-orange mb-3 bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2716%27%20fill=%27none%27%20stroke=%27%239ca3af%27%20stroke-width=%272%27%3E%3Ccircle%20cx=%277%27%20cy=%277%27%20r=%274.5%27/%3E%3Cpath%20d=%27m11%2011%203%203%27/%3E%3C/svg%3E')] bg-no-repeat bg-[10px_center]"
        />

        {/* Job function filters */}
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
    </div>
  )
}
