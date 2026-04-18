import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import Nav from '../components/Nav'
import TouchpointDetail from '../components/TouchpointDetail'
import { api } from '../lib/api'
import { dimName } from '../lib/dimensions'

/**
 * StaffProfile — full touchpoint history for one person.
 * Shows scored AND unscored touchpoints in a timeline.
 * Year-over-year score grid only appears for staff with scored PMAPs.
 */

const SCORE_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }

const FORM_LABELS = {
  observation_teacher: { label: 'Observation', color: 'bg-blue-100 text-blue-600' },
  observation_prek: { label: 'PreK Obs', color: 'bg-pink-100 text-pink-600' },
  observation_fundamentals: { label: 'Fundamentals', color: 'bg-cyan-100 text-cyan-600' },
  pmap_teacher: { label: 'PMAP', color: 'bg-green-100 text-green-600' },
  pmap_leader: { label: 'PMAP', color: 'bg-green-100 text-green-600' },
  pmap_prek: { label: 'PMAP', color: 'bg-green-100 text-green-600' },
  pmap_support: { label: 'PMAP', color: 'bg-green-100 text-green-600' },
  pmap_network: { label: 'PMAP', color: 'bg-green-100 text-green-600' },
  self_reflection_teacher: { label: 'Self-Ref', color: 'bg-purple-100 text-purple-600' },
  self_reflection_leader: { label: 'Self-Ref', color: 'bg-purple-100 text-purple-600' },
  self_reflection_prek: { label: 'Self-Ref', color: 'bg-purple-100 text-purple-600' },
  self_reflection_support: { label: 'Self-Ref', color: 'bg-purple-100 text-purple-600' },
  self_reflection_network: { label: 'Self-Ref', color: 'bg-purple-100 text-purple-600' },
  quick_feedback: { label: 'Feedback', color: 'bg-amber-100 text-amber-600' },
  meeting_quick_meeting: { label: 'Meeting', color: 'bg-green-100 text-green-700' },
  'meeting_data_meeting_(relay)': { label: 'Data Mtg', color: 'bg-green-100 text-green-700' },
  write_up: { label: 'Write-Up', color: 'bg-red-100 text-red-600' },
  iap: { label: 'IAP', color: 'bg-red-100 text-red-600' },
  celebrate: { label: 'Celebrate', color: 'bg-green-100 text-green-600' },
  solicited_feedback: { label: 'Solicit FB', color: 'bg-blue-100 text-blue-600' },
}

function prettyDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ScorePill({ code, score }) {
  const rounded = Math.round(score)
  const color = SCORE_COLORS[Math.max(1, Math.min(5, rounded))]
  return (
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: color + '20', color }}>
      {dimName(code)}: {rounded}
    </span>
  )
}

export default function StaffProfile() {
  const { email } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selectedTP, setSelectedTP] = useState(null)

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

  const { staff, touchpoints, touchpoint_count, pmap_by_year, school_years } = data
  const initials = ((staff.name || '').split(/\s+/).map(w => w[0]).join('')).toUpperCase().slice(0, 2)
  const pmapYrs = Object.keys(pmap_by_year || {}).sort()
  const hasScores = pmapYrs.length > 0

  // Detect dimension set
  let dims = ['T1', 'T2', 'T3', 'T4', 'T5']
  if (hasScores) {
    const firstYr = pmap_by_year[pmapYrs[0]]
    const codes = Object.keys(firstYr)
    if (codes.some(c => c.startsWith('L'))) dims = ['L1', 'L2', 'L3', 'L4', 'L5']
    if (codes.some(c => c.startsWith('PK'))) dims = codes.sort()
  }

  // Filter touchpoints
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'pmap', label: 'PMAPs' },
    { key: 'observation', label: 'Observations' },
    { key: 'self_reflection', label: 'Self-Ref' },
    { key: 'meeting', label: 'Meetings' },
    { key: 'feedback', label: 'Feedback' },
  ]

  const filtered = touchpoints.filter(tp => {
    if (filter === 'all') return true
    if (filter === 'pmap') return tp.form_type.startsWith('pmap_')
    if (filter === 'observation') return tp.form_type.startsWith('observation_')
    if (filter === 'self_reflection') return tp.form_type.startsWith('self_reflection_')
    if (filter === 'meeting') return tp.form_type.startsWith('meeting_')
    if (filter === 'feedback') return tp.form_type === 'quick_feedback' || tp.form_type === 'solicited_feedback' || tp.form_type === 'celebrate'
    return true
  })

  // Group by school year
  let currentYear = null

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
        <div className="flex flex-wrap gap-1.5 mt-3.5">
          {(() => {
            const t = `?teacher=${encodeURIComponent(email)}`
            const jf = staff.job_function
            const isTeacher = jf === 'Teacher'
            const buttons = []
            if (isTeacher) {
              buttons.push({ to: `/app/observe${t}`, label: 'Observe' })
              buttons.push({ to: `/app/fundamentals${t}`, label: 'Fundamentals' })
            }
            buttons.push({ to: `/app/feedback${t}`, label: 'Feedback' })
            buttons.push({ to: `/app/celebrate${t}`, label: 'Celebrate' })
            buttons.push({ to: `/app/meeting${t}`, label: 'Meeting' })
            buttons.push({ to: `/app/solicit${t}`, label: 'Solicit' })
            buttons.push({ to: `/app/pmap${t}`, label: 'PMAP' })
            return buttons.map(b => (
              <Link key={b.label} to={b.to}
                className="px-3 py-2 rounded-[10px] border border-gray-200 text-center text-[11px] font-semibold text-gray-600 no-underline">
                {b.label}
              </Link>
            ))
          })()}
        </div>
      </div>

      {/* Stats — touchpoint count, and PMAP avg only if scored */}
      <div className={`grid ${hasScores ? 'grid-cols-2' : 'grid-cols-1'} gap-2 px-4 py-3`}>
        <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
          <div className="text-[22px] font-extrabold text-blue-600">{touchpoint_count}</div>
          <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">TouchPoints</div>
        </div>
        {hasScores && (
          <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
            <div className="text-[22px] font-extrabold text-green-600">
              {(() => {
                const latest = pmap_by_year[pmapYrs[pmapYrs.length - 1]]
                const vals = Object.values(latest)
                return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
              })()}
            </div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Last PMAP Avg</div>
          </div>
        )}
      </div>

      <div className="px-4">
        {/* Year-over-year grid (only if scored) */}
        {hasScores && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mt-2 mb-2">
              Year-Over-Year PMAP Scores
            </div>
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
                                  style={{ background: color + '20', color }}>
                                  {Math.round(s)}
                                </span>
                                {delta != null && Math.abs(delta) >= 0.5 && (
                                  <span className={`text-[10px] font-bold ml-0.5 ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {delta > 0 ? '▲' : '▼'}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-300 text-[11px]">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Timeline */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mt-2 mb-2">
          TouchPoint Timeline
        </div>

        {/* Filters */}
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
                filter === f.key ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white border-gray-200 text-gray-500'
              }`}
            >{f.label}</button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8 bg-white rounded-xl">No touchpoints match this filter</div>
        )}

        <div className="space-y-2">
          {filtered.map((tp, i) => {
            const meta = FORM_LABELS[tp.form_type] || { label: tp.form_type, color: 'bg-gray-100 text-gray-600' }
            const scores = tp.scores || {}
            const scoreCodes = Object.keys(scores).sort()
            const yearChanged = tp.school_year !== currentYear
            currentYear = tp.school_year

            return (
              <div key={tp.id}>
                {yearChanged && (
                  <div className="flex items-center gap-2.5 my-3 text-[11px] font-bold text-gray-400 uppercase tracking-wide">
                    <div className="flex-1 h-px bg-gray-200" />
                    {tp.school_year}
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                )}
                <div className="bg-white rounded-[10px] p-3 shadow-sm cursor-pointer active:scale-[.98] transition-transform" onClick={() => setSelectedTP(tp)}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-gray-400">{prettyDate(tp.date)}</span>
                  </div>
                  {tp.notes && (
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2">{tp.notes}</div>
                  )}
                  {scoreCodes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {scoreCodes.map(code => (
                        <ScorePill key={code} code={code} score={scores[code]} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Touchpoint detail modal */}
      {selectedTP && (
        <TouchpointDetail touchpoint={selectedTP} onClose={() => setSelectedTP(null)} />
      )}
    </div>
  )
}
