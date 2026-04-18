import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Nav from '../components/Nav'
import TouchpointDetail from '../components/TouchpointDetail'
import { api } from '../lib/api'
import { dimName } from '../lib/dimensions'

/**
 * StaffProfile — clean card layout with progressive disclosure.
 *
 * Default view: header, 2-3 actions + overflow, 2 stats, 3 recent touchpoints.
 * One tap deeper: "All History" expands timeline, "Score Trends" expands grid.
 * Same layout for all staff types — no conditional "No PMAP" messages.
 */

const SCORE_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }

const FORM_LABELS = {
  observation_teacher: 'Observation',
  observation_prek: 'PreK Obs',
  observation_fundamentals: 'Fundamentals',
  pmap_teacher: 'PMAP', pmap_leader: 'PMAP', pmap_prek: 'PMAP',
  pmap_support: 'PMAP', pmap_network: 'PMAP',
  self_reflection_teacher: 'Self-Ref', self_reflection_leader: 'Self-Ref',
  self_reflection_prek: 'Self-Ref', self_reflection_support: 'Self-Ref',
  self_reflection_network: 'Self-Ref',
  quick_feedback: 'Feedback', celebrate: 'Celebrate',
  meeting_quick_meeting: 'Meeting', 'meeting_data_meeting_(relay)': 'Data Mtg',
  solicited_feedback: 'Solicit FB', write_up: 'Write-Up', iap: 'IAP',
}

const FORM_COLORS = {
  observation_teacher: 'bg-blue-100 text-blue-600',
  observation_prek: 'bg-pink-100 text-pink-600',
  observation_fundamentals: 'bg-cyan-100 text-cyan-600',
  pmap_teacher: 'bg-green-100 text-green-600', pmap_leader: 'bg-green-100 text-green-600',
  pmap_prek: 'bg-green-100 text-green-600', pmap_support: 'bg-green-100 text-green-600',
  pmap_network: 'bg-green-100 text-green-600',
  self_reflection_teacher: 'bg-purple-100 text-purple-600',
  self_reflection_leader: 'bg-purple-100 text-purple-600',
  self_reflection_prek: 'bg-purple-100 text-purple-600',
  self_reflection_support: 'bg-purple-100 text-purple-600',
  self_reflection_network: 'bg-purple-100 text-purple-600',
  quick_feedback: 'bg-amber-100 text-amber-600',
  celebrate: 'bg-green-100 text-green-600',
  meeting_quick_meeting: 'bg-emerald-100 text-emerald-700',
  'meeting_data_meeting_(relay)': 'bg-emerald-100 text-emerald-700',
  solicited_feedback: 'bg-blue-100 text-blue-600',
  write_up: 'bg-red-100 text-red-600', iap: 'bg-red-100 text-red-600',
}

function prettyDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function StaffProfile() {
  const { email } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedTP, setSelectedTP] = useState(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [showScores, setShowScores] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [historyFilter, setHistoryFilter] = useState('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const d = await api.get(`/api/staff/${encodeURIComponent(email)}`)
      if (d) setData(d)
      setLoading(false)
    }
    load()
  }, [email])

  if (loading) return <div><Nav /><div className="text-center text-gray-400 text-sm py-16">Loading...</div></div>
  if (!data) return <div><Nav /><div className="text-center text-gray-400 text-sm py-16">Not found</div></div>

  const { staff, touchpoints, touchpoint_count, pmap_by_year } = data
  const initials = ((staff.name || '').split(/\s+/).map(w => w[0]).join('')).toUpperCase().slice(0, 2)
  const pmapYrs = Object.keys(pmap_by_year || {}).sort()
  const hasScores = pmapYrs.length > 0
  const isTeacher = staff.job_function === 'Teacher'
  const t = `?teacher=${encodeURIComponent(email)}`

  // Detect dimension set
  let dims = ['T1', 'T2', 'T3', 'T4', 'T5']
  if (hasScores) {
    const codes = Object.keys(pmap_by_year[pmapYrs[0]])
    if (codes.some(c => c.startsWith('L'))) dims = ['L1', 'L2', 'L3', 'L4', 'L5']
    if (codes.some(c => c.startsWith('PK'))) dims = codes.sort()
  }

  // PMAP average
  const pmapAvg = hasScores ? (() => {
    const latest = pmap_by_year[pmapYrs[pmapYrs.length - 1]]
    const vals = Object.values(latest)
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null
  })() : null

  // Recent touchpoints (last 5)
  const recent = touchpoints.slice(0, 5)

  // Primary actions (2-3 most common)
  const primaryActions = isTeacher
    ? [{ to: `/app/observe${t}`, label: 'Observe' }, { to: `/app/feedback${t}`, label: 'Feedback' }]
    : [{ to: `/app/feedback${t}`, label: 'Feedback' }, { to: `/app/celebrate${t}`, label: 'Celebrate' }]

  // All actions (shown in overflow)
  const allActions = [
    ...(isTeacher ? [{ to: `/app/observe${t}`, label: 'Observe' }, { to: `/app/fundamentals${t}`, label: 'Fundamentals' }] : []),
    { to: `/app/feedback${t}`, label: 'Feedback' },
    { to: `/app/celebrate${t}`, label: 'Celebrate' },
    { to: `/app/meeting${t}`, label: 'Meeting' },
    { to: `/app/solicit${t}`, label: 'Solicit Feedback' },
    { to: `/app/pmap${t}`, label: 'PMAP' },
  ]

  // Filtered history
  const filteredHistory = touchpoints.filter(tp => {
    if (historyFilter === 'all') return true
    if (historyFilter === 'pmap') return tp.form_type.startsWith('pmap_')
    if (historyFilter === 'observation') return tp.form_type.startsWith('observation_')
    if (historyFilter === 'self_reflection') return tp.form_type.startsWith('self_reflection_')
    if (historyFilter === 'meeting') return tp.form_type.startsWith('meeting_')
    if (historyFilter === 'feedback') return tp.form_type === 'quick_feedback' || tp.form_type === 'solicited_feedback' || tp.form_type === 'celebrate'
    return true
  })

  function TouchpointCard({ tp }) {
    const label = FORM_LABELS[tp.form_type] || tp.form_type
    const color = FORM_COLORS[tp.form_type] || 'bg-gray-100 text-gray-600'
    const scores = tp.scores || {}
    const scoreCodes = Object.keys(scores).sort()
    return (
      <div
        className="bg-white rounded-xl shadow-sm p-3.5 cursor-pointer active:scale-[.98] transition-transform"
        onClick={() => setSelectedTP(tp)}
      >
        <div className="flex items-center justify-between">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>{label}</span>
          <span className="text-[11px] text-gray-400">{prettyDate(tp.date)}</span>
        </div>
        {tp.notes && <div className="text-xs text-gray-600 mt-1.5 line-clamp-1">{tp.notes}</div>}
        {scoreCodes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {scoreCodes.slice(0, 5).map(code => {
              const s = Math.round(scores[code])
              const c = SCORE_COLORS[Math.max(1, Math.min(5, s))]
              return <span key={code} className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: c + '20', color: c }}>{dimName(code)}: {s}</span>
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pb-10">
      <Nav />

      {/* Header */}
      <div className="bg-white px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-[14px] bg-fls-navy text-white flex items-center justify-center text-xl font-bold shrink-0">
            {initials}
          </div>
          <div>
            <div className="text-xl font-extrabold tracking-tight">{staff.name}</div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              {[staff.school, staff.job_title].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        {/* Actions: 2 primary + overflow */}
        <div className="flex gap-1.5 mt-3.5">
          {primaryActions.map(a => (
            <Link key={a.label} to={a.to}
              className="flex-1 py-2.5 rounded-[10px] border border-gray-200 text-center text-xs font-semibold text-gray-600 no-underline">
              {a.label}
            </Link>
          ))}
          <button
            onClick={() => setShowMoreActions(!showMoreActions)}
            className="w-10 py-2.5 rounded-[10px] border border-gray-200 text-center text-sm text-gray-400"
          >+</button>
        </div>

        {/* Overflow actions */}
        {showMoreActions && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {allActions.map(a => (
              <Link key={a.label} to={a.to}
                className="px-3 py-2 rounded-lg bg-gray-50 text-[11px] font-semibold text-gray-600 no-underline">
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-3">
        {/* Stats */}
        <div className={`grid ${pmapAvg ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mb-4`}>
          <div className="bg-white rounded-[10px] p-3 text-center shadow-sm">
            <div className="text-2xl font-extrabold text-fls-navy">{touchpoint_count}</div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">TouchPoints</div>
          </div>
          {pmapAvg && (
            <div className="bg-white rounded-[10px] p-3 text-center shadow-sm">
              <div className="text-2xl font-extrabold text-green-600">{pmapAvg}</div>
              <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Last PMAP Avg</div>
            </div>
          )}
        </div>

        {/* Recent touchpoints */}
        {recent.length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Recent</div>
            <div className="space-y-2 mb-4">
              {recent.map(tp => <TouchpointCard key={tp.id} tp={tp} />)}
            </div>
          </>
        )}

        {recent.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-6 bg-white rounded-xl shadow-sm mb-4">
            No touchpoints yet
          </div>
        )}

        {/* Expandable: All History */}
        {touchpoints.length > 5 && (
          <button
            onClick={() => setShowAllHistory(!showAllHistory)}
            className="w-full bg-white rounded-xl shadow-sm p-4 mb-2 flex items-center justify-between text-left"
          >
            <div>
              <div className="text-sm font-semibold">All History</div>
              <div className="text-[11px] text-gray-400">{touchpoint_count} touchpoints across {data.school_years?.length || 0} years</div>
            </div>
            <span className="text-gray-400 text-lg">{showAllHistory ? '▼' : '→'}</span>
          </button>
        )}

        {showAllHistory && (
          <div className="mb-4">
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'pmap', label: 'PMAPs' },
                { key: 'observation', label: 'Observations' },
                { key: 'self_reflection', label: 'Self-Ref' },
                { key: 'meeting', label: 'Meetings' },
                { key: 'feedback', label: 'Feedback' },
              ].map(f => (
                <button key={f.key} onClick={() => setHistoryFilter(f.key)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
                    historyFilter === f.key ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white border-gray-200 text-gray-500'
                  }`}>{f.label}</button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredHistory.map(tp => <TouchpointCard key={tp.id} tp={tp} />)}
              {filteredHistory.length === 0 && <div className="text-center text-gray-400 text-sm py-4">No matches</div>}
            </div>
          </div>
        )}

        {/* Expandable: Score Trends (only for scored staff) */}
        {hasScores && (
          <>
            <button
              onClick={() => setShowScores(!showScores)}
              className="w-full bg-white rounded-xl shadow-sm p-4 mb-2 flex items-center justify-between text-left"
            >
              <div>
                <div className="text-sm font-semibold">Score Trends</div>
                <div className="text-[11px] text-gray-400">Year-over-year PMAP scores</div>
              </div>
              <span className="text-gray-400 text-lg">{showScores ? '▼' : '→'}</span>
            </button>

            {showScores && (
              <div className="bg-white rounded-xl shadow-sm p-3.5 mb-4 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className="text-left text-[10px] font-bold text-gray-400 uppercase px-2 py-1.5 border-b border-gray-200"></th>
                      {pmapYrs.map(yr => (
                        <th key={yr} className="text-center text-[10px] font-bold text-gray-400 uppercase px-1 py-1.5 border-b border-gray-200">
                          {yr.slice(2, 4)}–{yr.slice(7, 9)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dims.map(code => (
                      <tr key={code}>
                        <td className="text-xs font-bold text-gray-700 px-2 py-2 border-b border-gray-50">{dimName(code)}</td>
                        {pmapYrs.map((yr, i) => {
                          const s = pmap_by_year[yr]?.[code]
                          const prev = i > 0 ? pmap_by_year[pmapYrs[i - 1]]?.[code] : null
                          const delta = s != null && prev != null ? s - prev : null
                          const color = s != null ? SCORE_COLORS[Math.max(1, Math.min(5, Math.round(s)))] : '#d1d5db'
                          return (
                            <td key={yr} className="text-center px-1 py-2 border-b border-gray-50">
                              {s != null ? (
                                <>
                                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[13px] font-bold"
                                    style={{ background: color + '20', color }}>{Math.round(s)}</span>
                                  {delta != null && Math.abs(delta) >= 0.5 && (
                                    <span className={`text-[10px] font-bold ml-0.5 ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {delta > 0 ? '▲' : '▼'}
                                    </span>
                                  )}
                                </>
                              ) : <span className="text-gray-300 text-[11px]">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Touchpoint detail modal */}
      {selectedTP && (
        <TouchpointDetail touchpoint={selectedTP} onClose={() => setSelectedTP(null)} />
      )}
    </div>
  )
}
