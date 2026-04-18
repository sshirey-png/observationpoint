import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav'
import { api } from '../lib/api'
import { dimName } from '../lib/dimensions'

/**
 * Network Dashboard — clean school cards with progressive disclosure.
 *
 * Default view: 2 KPIs, 4 school cards. That's it.
 * One tap deeper: expand school card for detail, or open score comparison / trends.
 */

const DIMS = ['T1', 'T2', 'T3', 'T4', 'T5']
const SCORE_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }

function scoreColor(v) {
  return SCORE_COLORS[Math.max(1, Math.min(5, Math.round(v)))] || '#9ca3af'
}

function shortSchool(name) {
  return (name || '').replace(' Charter School', '').replace(' Community School', '').replace(' Academy', '')
}

// Human-readable touchpoint type names
const TYPE_LABELS = {
  observation_teacher: 'Observations',
  observation_fundamentals: 'Fundamentals',
  observation_prek: 'PreK Obs',
  pmap_teacher: 'PMAPs (Teacher)',
  pmap_leader: 'PMAPs (Leader)',
  pmap_prek: 'PMAPs (PreK)',
  pmap_support: 'PMAPs (Support)',
  pmap_network: 'PMAPs (Network)',
  self_reflection_teacher: 'Self-Reflections',
  self_reflection_leader: 'Self-Ref (Leader)',
  self_reflection_prek: 'Self-Ref (PreK)',
  self_reflection_support: 'Self-Ref (Support)',
  self_reflection_network: 'Self-Ref (Network)',
  quick_feedback: 'Quick Feedback',
  celebrate: 'Celebrations',
  meeting_quick_meeting: 'Meetings',
  'meeting_data_meeting_(relay)': 'Data Meetings',
  solicited_feedback: 'Solicited Feedback',
  write_up: 'Write-Ups',
  iap: 'IAPs',
}

export default function Network() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedSchool, setExpandedSchool] = useState(null)
  const [showComparison, setShowComparison] = useState(false)
  const [showTrends, setShowTrends] = useState(false)

  useEffect(() => {
    async function load() {
      const d = await api.get('/api/network')
      if (d) setData(d)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div><Nav title="Network Dashboard" /><div className="text-center text-gray-400 text-sm py-16">Loading...</div></div>
  if (!data) return <div><Nav title="Network Dashboard" /><div className="text-center text-gray-400 text-sm py-16">Failed to load</div></div>

  const { kpis, schools, network_avg, network_trends } = data
  const schoolNames = Object.keys(schools).sort()
  const totalTPs = schoolNames.reduce((sum, name) => sum + (schools[name].total_touchpoints || 0), 0)

  function toggleSchool(name) {
    setExpandedSchool(expandedSchool === name ? null : name)
  }

  return (
    <div className="pb-10">
      <Nav title="Network Dashboard" />

      <div className="px-4 pt-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-white rounded-[10px] p-3 text-center shadow-sm">
            <div className="text-2xl font-extrabold text-fls-navy">{totalTPs.toLocaleString()}</div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">TouchPoints</div>
          </div>
          <div className="bg-white rounded-[10px] p-3 text-center shadow-sm">
            <div className="text-2xl font-extrabold text-fls-navy">{kpis.total_teachers}</div>
            <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Active Teachers</div>
          </div>
        </div>

        {/* School Cards */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Schools</div>
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          {schoolNames.map(name => {
            const s = schools[name]
            const scores = s.avg_scores || {}
            const avgVals = Object.values(scores)
            const overallAvg = avgVals.length ? (avgVals.reduce((a, b) => a + b, 0) / avgVals.length).toFixed(1) : null
            const isExpanded = expandedSchool === name
            const types = s.touchpoints_by_type || {}

            return (
              <div key={name} className={`bg-white rounded-xl shadow-sm overflow-hidden ${isExpanded ? 'col-span-2' : ''}`}>
                <div className="p-4 cursor-pointer active:bg-gray-50" onClick={() => toggleSchool(name)}>
                  <div className="text-sm font-bold text-fls-navy">{shortSchool(name)}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{s.staff_count || 0} staff</div>
                  <div className="flex items-baseline gap-2 mt-2">
                    <div className="text-xl font-extrabold text-fls-navy">{s.total_touchpoints || 0}</div>
                    <div className="text-[10px] text-gray-400">touchpoints</div>
                    {overallAvg && (
                      <>
                        <div className="text-[10px] text-gray-300 mx-1">·</div>
                        <div className="text-sm font-bold" style={{ color: scoreColor(parseFloat(overallAvg)) }}>
                          {overallAvg} avg
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                    {/* Dimension scores */}
                    {Object.keys(scores).length > 0 && (
                      <div className="mb-3">
                        <div className="text-[10px] font-bold uppercase text-gray-400 mb-1.5">PMAP Scores</div>
                        <div className="flex gap-1">
                          {DIMS.map(d => {
                            const v = scores[d]
                            const color = v != null ? scoreColor(v) : '#d1d5db'
                            return (
                              <div key={d} className="flex-1 text-center py-1.5 rounded-md" style={{ background: v ? color + '10' : '#f5f7fa' }}>
                                <div className="text-[9px] font-semibold text-gray-400">{dimName(d)}</div>
                                <div className="text-sm font-extrabold" style={{ color: v ? color : '#d1d5db' }}>
                                  {v != null ? v.toFixed(1) : '—'}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Touchpoint types */}
                    <div className="text-[10px] font-bold uppercase text-gray-400 mb-1.5">Activity</div>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(types)
                        .sort(([, a], [, b]) => b.count - a.count)
                        .slice(0, 8)
                        .map(([ft, info]) => (
                          <span key={ft} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-600">
                            {TYPE_LABELS[ft] || ft}: {info.count}
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Link cards for deeper views */}
        <div className="space-y-2">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left"
          >
            <div>
              <div className="text-sm font-semibold">Score Comparison</div>
              <div className="text-[11px] text-gray-400">Side-by-side dimension scores</div>
            </div>
            <span className="text-gray-400 text-lg">{showComparison ? '▼' : '→'}</span>
          </button>

          {showComparison && (
            <div className="bg-white rounded-xl shadow-sm p-3.5 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className="text-left text-[10px] font-bold text-gray-400 uppercase px-2 py-1.5 border-b border-gray-200">School</th>
                    {DIMS.map(d => (
                      <th key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase px-1 py-1.5 border-b border-gray-200">{dimName(d)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {schoolNames.map(name => {
                    const scores = schools[name].avg_scores || {}
                    return (
                      <tr key={name}>
                        <td className="text-xs font-semibold text-gray-700 px-2 py-2 border-b border-gray-50">{shortSchool(name)}</td>
                        {DIMS.map(d => {
                          const v = scores[d]
                          const color = v != null ? scoreColor(v) : '#d1d5db'
                          return (
                            <td key={d} className="text-center px-1 py-2 border-b border-gray-50">
                              {v != null ? (
                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[13px] font-bold" style={{ background: color + '20', color }}>
                                  {v.toFixed(1)}
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  <tr className="border-t-2 border-gray-200">
                    <td className="text-xs font-extrabold text-fls-navy px-2 py-2">Network</td>
                    {DIMS.map(d => {
                      const v = network_avg?.[d]
                      const color = v != null ? scoreColor(v) : '#d1d5db'
                      return (
                        <td key={d} className="text-center px-1 py-2">
                          {v != null ? (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[13px] font-bold" style={{ background: color + '20', color }}>
                              {v.toFixed(1)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={() => setShowTrends(!showTrends)}
            className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center justify-between text-left"
          >
            <div>
              <div className="text-sm font-semibold">Year-over-Year Trends</div>
              <div className="text-[11px] text-gray-400">Network PMAP averages across years</div>
            </div>
            <span className="text-gray-400 text-lg">{showTrends ? '▼' : '→'}</span>
          </button>

          {showTrends && network_trends && (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="space-y-2">
                {DIMS.map(d => {
                  const years = Object.keys(network_trends).sort()
                  return (
                    <div key={d} className="flex items-center gap-2">
                      <div className="w-16 text-xs font-bold text-gray-700">{dimName(d)}</div>
                      <div className="flex-1 flex items-center gap-1">
                        {years.map(yr => {
                          const v = network_trends[yr]?.[d]
                          const color = v != null ? scoreColor(v) : '#d1d5db'
                          return (
                            <div key={yr} className="flex-1 text-center">
                              <div className="text-[9px] text-gray-400">{yr.slice(2, 4)}–{yr.slice(7, 9)}</div>
                              <div className="text-xs font-bold mt-0.5" style={{ color: v ? color : '#d1d5db' }}>
                                {v != null ? v.toFixed(1) : '—'}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Link to Insights */}
          <Link
            to="/app/insights"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between no-underline"
          >
            <div>
              <div className="text-sm font-semibold text-gray-900">Ask ObservationPoint</div>
              <div className="text-[11px] text-gray-400">"Which school improved most on Content?"</div>
            </div>
            <span className="text-gray-400 text-lg">→</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
