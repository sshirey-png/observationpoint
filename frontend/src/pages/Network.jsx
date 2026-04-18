import { useState, useEffect } from 'react'
import Nav from '../components/Nav'
import { api } from '../lib/api'
import { dimName } from '../lib/dimensions'

/**
 * Network — school comparison dashboard.
 * Aggregate data only: score averages, touchpoint counts, trends.
 * No individual teacher data.
 */

const DIMS = ['T1', 'T2', 'T3', 'T4', 'T5']
const DIM_NAMES = { T1: 'On Task', T2: 'Community', T3: 'Content', T4: 'Cog Engage', T5: 'Demo Learn' }
const SCORE_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }

function scoreColor(v) {
  return SCORE_COLORS[Math.max(1, Math.min(5, Math.round(v)))] || '#9ca3af'
}

function shortSchool(name) {
  return (name || '').replace(' Charter School', '').replace(' Community School', '').replace(' Academy', '')
}

export default function Network() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

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

  const { kpis, schools, network_avg, network_trends, distribution } = data
  const schoolNames = Object.keys(schools).sort()

  return (
    <div className="pb-10">
      <Nav title="Network Dashboard" />

      <div className="px-4 pt-4">
        {/* KPIs — total touchpoints across all types */}
        {(() => {
          const totalTPs = schoolNames.reduce((sum, name) => sum + (schools[name].total_touchpoints || 0), 0)
          return (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
                <div className="text-[22px] font-extrabold text-fls-navy">{totalTPs}</div>
                <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Total TouchPoints</div>
                <div className="text-[10px] text-gray-400">All types, all schools</div>
              </div>
              <div className="bg-white rounded-[10px] p-2.5 text-center shadow-sm">
                <div className="text-[22px] font-extrabold text-fls-navy">{kpis.total_teachers}</div>
                <div className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Active Teachers</div>
              </div>
            </div>
          )
        })()}

        {/* School Comparison Heatmap */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">
          School Comparison — PMAP Scores
        </div>
        <div className="bg-white rounded-xl shadow-sm p-3.5 mb-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-400 uppercase px-2 py-1.5 border-b border-gray-200">School</th>
                {DIMS.map(d => (
                  <th key={d} className="text-center text-[10px] font-bold text-gray-400 uppercase px-1 py-1.5 border-b border-gray-200">
                    {dimName(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schoolNames.map(name => {
                const s = schools[name]
                const scores = s.avg_scores || {}
                return (
                  <tr key={name}>
                    <td className="text-xs font-semibold text-gray-700 px-2 py-2 border-b border-gray-50">{shortSchool(name)}</td>
                    {DIMS.map(d => {
                      const v = scores[d]
                      const color = v != null ? scoreColor(v) : '#d1d5db'
                      return (
                        <td key={d} className="text-center px-1 py-2 border-b border-gray-50">
                          {v != null ? (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[13px] font-bold"
                              style={{ background: color + '20', color }}>
                              {v.toFixed(1)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {/* Network row */}
              <tr className="border-t-2 border-gray-200">
                <td className="text-xs font-extrabold text-fls-navy px-2 py-2">Network</td>
                {DIMS.map(d => {
                  const v = network_avg?.[d]
                  const color = v != null ? scoreColor(v) : '#d1d5db'
                  return (
                    <td key={d} className="text-center px-1 py-2">
                      {v != null ? (
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[13px] font-bold"
                          style={{ background: color + '20', color }}>
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

        {/* School Cards */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">School Detail</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {schoolNames.map(name => {
            const s = schools[name]
            const scores = s.avg_scores || {}
            const types = s.touchpoints_by_type || {}
            return (
              <div key={name} className="bg-white rounded-xl shadow-sm p-4">
                <div className="text-sm font-bold text-fls-navy mb-0.5">{shortSchool(name)}</div>
                <div className="text-[11px] text-gray-400 mb-3">
                  {s.staff_count || 0} staff · {s.total_touchpoints || 0} touchpoints
                </div>
                <div className="flex gap-1 mb-2">
                  {DIMS.map(d => {
                    const v = scores[d]
                    const color = v != null ? scoreColor(v) : '#d1d5db'
                    return (
                      <div key={d} className="flex-1 text-center py-1.5 rounded-md" style={{ background: v ? color + '10' : '#f5f7fa' }}>
                        <div className="text-[10px] font-semibold text-gray-400">{dimName(d)}</div>
                        <div className="text-base font-extrabold mt-0.5" style={{ color: v ? color : '#d1d5db' }}>
                          {v != null ? v.toFixed(1) : '—'}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Touchpoint type breakdown */}
                <div className="flex flex-wrap gap-1">
                  {Object.entries(types).slice(0, 6).map(([ft, info]) => {
                    const shortType = ft.replace('observation_', 'obs_').replace('self_reflection_', 'sr_').replace('meeting_', 'mtg_')
                    return (
                      <span key={ft} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        {shortType}: {info.count}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Trends */}
        {network_trends && Object.keys(network_trends).length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Network Trend</div>
            <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
              <div className="text-sm font-bold mb-3">PMAP Averages by Year</div>
              <div className="space-y-2">
                {DIMS.map(d => {
                  const years = Object.keys(network_trends).sort()
                  return (
                    <div key={d} className="flex items-center gap-2">
                      <div className="w-6 text-xs font-bold text-gray-700">{dimName(d)}</div>
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
          </>
        )}

        {/* Distribution */}
        {distribution && Object.keys(distribution).length > 0 && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Score Distribution</div>
            <div className="bg-white rounded-xl shadow-sm p-4">
              {DIMS.map(d => {
                const dd = distribution[d] || {}
                const total = Object.values(dd).reduce((a, b) => a + b, 0)
                if (!total) return null
                return (
                  <div key={d} className="flex items-center gap-2 py-1.5">
                    <div className="w-6 text-xs font-bold text-gray-700">{dimName(d)}</div>
                    <div className="flex-1 flex gap-0.5 h-6 items-end">
                      {[1, 2, 3, 4, 5].map(s => {
                        const count = dd[String(s)] || 0
                        const pct = total ? (count / total * 100) : 0
                        if (!count) return null
                        return (
                          <div
                            key={s}
                            className="rounded-sm flex items-center justify-center text-[9px] font-bold text-white"
                            style={{ flex: pct, background: SCORE_COLORS[s], minWidth: count ? 16 : 0 }}
                          >
                            {count}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
