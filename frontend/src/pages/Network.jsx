import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import AIPanel from '../components/AIPanel'
import ImpersonationBanner from '../components/ImpersonationBanner'
import GlobalSearch from '../components/GlobalSearch'
import { api } from '../lib/api'

/**
 * Network — Trends dashboard with multi-category toggle.
 * Real school-level aggregates from /api/network.
 *
 * Categories: Fundamentals · Observations · PMAP · Self-Reflection ·
 * Quick FB · Celebrate · Meetings. Same multi-category pattern as
 * StaffProfile, scaled to school-level data.
 */

const DIM_SHORT = {
  T1: 'On Task', T2: 'CoL', T3: 'Content', T4: 'Cog Eng', T5: 'Demo',
}
const DIM_FULL = {
  T1: 'On Task', T2: 'Community of Learners', T3: 'Essential Content',
  T4: 'Cognitive Engagement', T5: 'Demonstration of Learning',
}
const TEACHER_DIMS = ['T1', 'T2', 'T3', 'T4', 'T5']

function shortSchool(name) {
  return (name || '').replace(' Charter School', '').replace(' Community School', '').replace(' Academy', '')
}

function scoreClass(s) {
  if (s == null) return ''
  const n = Math.round(s)
  return `score-${Math.max(1, Math.min(5, n))}`
}

function Empty({ msg }) {
  return <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm shadow-sm">{msg}</div>
}

// --- Category views ---

function FundamentalsView({ data }) {
  // Honest data: imported Fundamentals records carry only RB (Relationship
  // Building, 0/100). M1-M5 minute on-task tracking starts when teachers
  // submit via the new Fundamentals timer form.
  const fund = data?.fundamentals || {}
  const fundBySchool = fund.by_school || {}
  const netRb = fund.network_rb_pct
  const priorRb = fund.network_rb_pct_prior
  const newFormCount = fund.new_form_m_count || 0
  const schools = data?.schools || {}
  const names = Object.keys(fundBySchool).sort((a, b) => (fundBySchool[b].rb_pct ?? -1) - (fundBySchool[a].rb_pct ?? -1))

  const total = data?.kpis?.fundamentals || 0
  const totalTeachers = data?.kpis?.fundamentals_teachers || 0
  // Gauge dial stroke-dasharray is circumference * (pct/100)
  const R = 56
  const CIRC = 2 * Math.PI * R
  const dashPct = netRb != null ? Math.max(0, Math.min(100, netRb)) : 0
  const dashOn = (dashPct / 100) * CIRC
  const gaugeColor = dashPct >= 80 ? '#059669' : dashPct >= 60 ? '#e47727' : '#dc2626'
  const yoyDelta = (netRb != null && priorRb != null) ? +(netRb - priorRb).toFixed(1) : null

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mt-4 mb-4">
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{total}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Visits YTD</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{totalTeachers}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Teachers visited</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{names.length}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Schools</div>
        </div>
      </div>

      {/* Network RB pass-rate gauge */}
      {netRb != null && (
        <div className="bg-white rounded-xl p-4 shadow-sm mb-4 flex items-center gap-4">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={R} stroke="#f3f4f6" strokeWidth="14" fill="none" />
            <circle
              cx="70" cy="70" r={R}
              stroke={gaugeColor} strokeWidth="14" fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dashOn} ${CIRC}`}
              transform="rotate(-90 70 70)"
            />
            <text x="70" y="74" textAnchor="middle" fill="#002f60" style={{ fontSize: 28, fontWeight: 800 }}>
              {Math.round(netRb)}%
            </text>
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Network On-Task Pass Rate</div>
            <div className="text-sm text-gray-700 mt-1">Visits where the teacher hit the on-task bar (scored 100), as a % of all visits this year.</div>
            {yoyDelta != null && (
              <div className={`text-xs font-semibold mt-1 ${yoyDelta > 0 ? 'text-green-600' : yoyDelta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {yoyDelta > 0 ? '↑' : yoyDelta < 0 ? '↓' : '·'} {Math.abs(yoyDelta)} pts vs prior year ({priorRb}%)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-school RB bars */}
      {names.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">
            On-Task Pass Rate by School · {data?.school_year}
          </div>
          {names.map(name => {
            const s = fundBySchool[name]
            const visits = s?.visits || 0
            const teachers = s?.teachers_visited || 0
            const pct = s?.rb_pct
            const width = pct != null ? Math.max(4, Math.min(100, pct)) : 0
            const barColor = pct == null ? '#d1d5db'
              : pct >= 80 ? '#059669' : pct >= 60 ? '#e47727' : '#dc2626'
            return (
              <div key={name} className="mb-3 last:mb-0">
                <div className="flex items-baseline justify-between mb-1">
                  <div className="text-[12px] font-bold text-gray-700 truncate">{shortSchool(name)}</div>
                  <div className="text-[11px] text-gray-500 shrink-0">
                    {pct != null ? <span className="font-extrabold text-fls-navy">{pct}%</span> : <span className="text-gray-400">—</span>}
                    <span className="text-gray-400"> · {visits} visits · {teachers} teachers</span>
                  </div>
                </div>
                <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: barColor }} />
                  {netRb != null && (
                    <div className="absolute top-0 bottom-0 w-[2px] bg-fls-navy"
                         style={{ left: `${netRb}%` }} title={`Network avg ${netRb}%`} />
                  )}
                </div>
              </div>
            )
          })}
          {netRb != null && (
            <div className="text-[10px] text-gray-400 mt-3 flex items-center gap-1.5">
              <span className="inline-block w-[2px] h-3 bg-fls-navy" />
              Network average ({netRb}%)
            </div>
          )}
        </div>
      )}

      {newFormCount > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3.5 mt-3 text-xs text-blue-900">
          <b>{newFormCount}</b> visit{newFormCount === 1 ? '' : 's'} this year captured with the new minute-by-minute on-task timer (more granular than pass/fail).
        </div>
      )}

      {names.length === 0 && netRb == null && (
        <Empty msg="No fundamentals visits logged this year." />
      )}
    </div>
  )
}

function ObservationsView({ data }) {
  const networkAvg = data?.network_avg || {}
  const trends = data?.network_trends || {}
  const years = Object.keys(trends).sort()
  const schools = data?.schools || {}

  return (
    <div>
      {Object.keys(networkAvg).length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
            Network avg · {data.school_year}
          </div>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {TEACHER_DIMS.map(code => networkAvg[code] != null && (
              <div key={code} className="bg-white rounded-[10px] p-2 text-center shadow-sm">
                <div className="text-[9px] font-bold text-gray-400 uppercase">{DIM_SHORT[code]}</div>
                <div className={`inline-block text-base font-extrabold mt-1 px-2 rounded ${scoreClass(networkAvg[code])}`}>
                  {networkAvg[code]}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {years.length > 1 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
            Year over year trend
          </div>
          <div className="bg-white rounded-xl p-3.5 shadow-sm mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400 pb-2 pr-2">Dimension</th>
                  {years.map(yr => (
                    <th key={yr} className="text-center text-[10px] font-bold uppercase tracking-wide text-gray-400 pb-2 px-1">{yr.slice(2)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEACHER_DIMS.map(code => (
                  <tr key={code}>
                    <td className="py-1.5 pr-2 text-[12px] font-bold text-gray-700 border-t border-gray-100">{DIM_SHORT[code]}</td>
                    {years.map(yr => {
                      const v = trends[yr]?.[code]
                      return (
                        <td key={yr} className="py-1.5 px-1 text-center border-t border-gray-100">
                          {v != null ? (
                            <span className={`inline-flex items-center justify-center w-10 h-8 rounded-md text-xs font-bold ${scoreClass(v)}`}>{v}</span>
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

      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        PMAP scores — schools × dimensions
      </div>
      {Object.keys(schools).length === 0 ? (
        <Empty msg="No school data yet." />
      ) : (
        <HeatmapGrid schools={schools} networkAvg={networkAvg} />
      )}
    </div>
  )
}

// Heatmap: rows = schools, columns = T1-T5, color-coded cells.
// Network average row at the bottom as the benchmark reference.
function HeatmapGrid({ schools, networkAvg }) {
  const names = Object.keys(schools).sort()
  const cellColor = (v) => {
    if (v == null) return { bg: '#f9fafb', text: '#d1d5db' }
    const n = Math.round(v)
    const palette = {
      1: { bg: '#fee2e2', text: '#b91c1c' },
      2: { bg: '#fed7aa', text: '#c2410c' },
      3: { bg: '#fef3c7', text: '#a16207' },
      4: { bg: '#d1fae5', text: '#047857' },
      5: { bg: '#bbf7d0', text: '#065f46' },
    }
    return palette[Math.max(1, Math.min(5, n))]
  }
  return (
    <div className="bg-white rounded-xl p-3 shadow-sm overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: '3px' }}>
        <thead>
          <tr>
            <th className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-400 pb-2 pr-2"></th>
            {TEACHER_DIMS.map(code => (
              <th key={code} className="text-center text-[10px] font-bold uppercase tracking-wide text-gray-500 pb-2" title={DIM_FULL[code]}>
                {DIM_SHORT[code]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map(name => {
            const avg = schools[name].avg_scores || {}
            return (
              <tr key={name}>
                <td className="pr-2 text-[12px] font-semibold text-gray-700 whitespace-nowrap">
                  {shortSchool(name)}
                </td>
                {TEACHER_DIMS.map(code => {
                  const v = avg[code]
                  const c = cellColor(v)
                  return (
                    <td key={code}
                        className="text-center text-[12px] font-bold rounded-md py-2"
                        style={{ background: c.bg, color: c.text, minWidth: '44px' }}>
                      {v != null ? v.toFixed(1) : '—'}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {Object.keys(networkAvg).length > 0 && (
            <tr>
              <td className="pr-2 pt-2 text-[11px] font-extrabold uppercase tracking-wider text-fls-navy whitespace-nowrap">
                Network Avg
              </td>
              {TEACHER_DIMS.map(code => {
                const v = networkAvg[code]
                const c = cellColor(v)
                return (
                  <td key={code}
                      className="text-center text-[12px] font-extrabold rounded-md py-2 border-2"
                      style={{ background: c.bg, color: c.text, borderColor: '#002f60', minWidth: '44px' }}>
                    {v != null ? v.toFixed(1) : '—'}
                  </td>
                )
              })}
            </tr>
          )}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-400 mt-2.5 flex items-center gap-2 flex-wrap">
        <span>Legend:</span>
        <span className="px-1.5 py-0.5 rounded-md" style={{ background: '#fee2e2', color: '#b91c1c' }}>1 NI</span>
        <span className="px-1.5 py-0.5 rounded-md" style={{ background: '#fed7aa', color: '#c2410c' }}>2 Em</span>
        <span className="px-1.5 py-0.5 rounded-md" style={{ background: '#fef3c7', color: '#a16207' }}>3 Dev</span>
        <span className="px-1.5 py-0.5 rounded-md" style={{ background: '#d1fae5', color: '#047857' }}>4 Prof</span>
        <span className="px-1.5 py-0.5 rounded-md" style={{ background: '#bbf7d0', color: '#065f46' }}>5 Exm</span>
      </div>
    </div>
  )
}

function PMAPView({ data }) {
  // Same data as observations, different framing — emphasis on year-over-year shifts
  return <ObservationsView data={data} />
}

function SchoolCountsView({ data, typeMatcher, label, emptyMsg }) {
  const schools = data?.schools || {}
  const rows = Object.keys(schools).map(name => {
    const types = schools[name].touchpoints_by_type || {}
    const count = Object.keys(types)
      .filter(typeMatcher)
      .reduce((sum, t) => sum + (types[t]?.count || 0), 0)
    return { name, count }
  })
  rows.sort((a, b) => b.count - a.count)
  const total = rows.reduce((s, r) => s + r.count, 0)

  return (
    <div>
      <div className="bg-white rounded-xl p-3.5 text-center shadow-sm mt-4 mb-4">
        <div className="text-3xl font-extrabold text-fls-navy">{total}</div>
        <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">{label} this year · network</div>
      </div>

      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">By school</div>
      {rows.length === 0 || total === 0 ? (
        <Empty msg={emptyMsg} />
      ) : (
        rows.map(r => (
          <div key={r.name} className="bg-white rounded-xl p-3.5 shadow-sm mb-2.5 flex items-center justify-between">
            <div className="text-[13px] font-bold">{shortSchool(r.name)}</div>
            <div className="text-right">
              <div className="text-lg font-extrabold text-fls-navy">{r.count}</div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

const CATEGORIES = [
  { key: 'overview',     label: 'Overview' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'observations', label: 'Observations' },
  { key: 'pmap',         label: 'PMAP' },
  { key: 'reflection',   label: 'Self-Reflection' },
  { key: 'feedback',     label: 'Quick FB' },
  { key: 'celebrate',    label: 'Celebrate' },
  { key: 'meetings',     label: 'Meetings' },
]

const SCHOOL_YEARS = ['2025-2026', '2024-2025', '2023-2024']

// Horizontal bar row — HR Dashboard pattern. Pure HTML/CSS, no Chart.js.
function HBar({ label, sub, value, max, color = '#002f60' }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <div className="w-[120px] text-[11px] text-gray-600 truncate text-right shrink-0" title={label}>
        {label}
      </div>
      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
        <div
          className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
          style={{ width: `${pct}%`, background: color }}
        >
          <span className="text-[10px] font-bold text-white whitespace-nowrap">{value}</span>
        </div>
      </div>
      {sub && <div className="w-[64px] text-[10px] text-gray-400 truncate shrink-0">{sub}</div>}
    </div>
  )
}

// Single KPI tile with YoY delta chip
function KpiTile({ label, value, prior, suffix = '' }) {
  const delta = (value || 0) - (prior || 0)
  const hasDelta = prior != null && prior > 0
  const pct = hasDelta ? Math.round((delta / prior) * 100) : 0
  const up = delta > 0
  return (
    <div className="bg-white rounded-xl p-3.5 shadow-sm">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <div className="text-2xl font-extrabold text-fls-navy">{(value || 0).toLocaleString()}{suffix}</div>
      </div>
      {hasDelta && (
        <div className={`text-[10px] font-semibold mt-1 ${up ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
          {up ? '↑' : delta < 0 ? '↓' : '·'} {Math.abs(pct)}% vs prior year
        </div>
      )}
    </div>
  )
}

function OverviewView({ data }) {
  const k = data?.kpis || {}
  const topObs = data?.top_observers || []
  const topMax = topObs[0]?.count || 0
  const schools = data?.schools || {}
  const schoolRows = Object.entries(schools).map(([name, s]) => ({
    name,
    total: s.total_touchpoints || 0,
    staff: s.staff_count || 0,
  })).sort((a, b) => b.total - a.total)
  const schoolMax = schoolRows[0]?.total || 0

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
        <KpiTile label="Observations" value={k.observations_total} prior={k.prior_observations_total} />
        <KpiTile label="Fundamentals" value={k.fundamentals_total} prior={k.prior_fundamentals_total} />
        <KpiTile label="PMAPs" value={k.pmap_total} prior={k.prior_pmap_total} />
        <KpiTile label="Celebrations" value={k.celebrate_total} prior={k.prior_celebrate_total} />
        <KpiTile label="Meetings" value={k.meeting_total} prior={k.prior_meeting_total} />
        <KpiTile label="Active teachers" value={k.total_teachers} />
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm mt-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Top Observers · This Year</div>
        {topObs.length === 0 ? (
          <Empty msg="No observer activity yet this year." />
        ) : (
          topObs.slice(0, 10).map(o => (
            <HBar key={o.email} label={o.name} sub={shortSchool(o.school)} value={o.count} max={topMax} color="#002f60" />
          ))
        )}
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Touchpoints by School · This Year</div>
        {schoolRows.length === 0 ? (
          <Empty msg="No activity logged this year." />
        ) : (
          schoolRows.map(r => (
            <HBar key={r.name} label={shortSchool(r.name)} sub={`${r.staff} staff`} value={r.total} max={schoolMax} color="#e47727" />
          ))
        )}
      </div>
    </div>
  )
}

export default function Network() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('overview')
  const [schoolYear, setSchoolYear] = useState(SCHOOL_YEARS[0])
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function go() {
      setLoading(true)
      try {
        const d = await api.get(`/api/network?school_year=${encodeURIComponent(schoolYear)}`)
        if (!cancelled) setData(d)
      } catch (e) {
        console.error('network load failed', e)
        if (!cancelled) setData(null)
      }
      if (!cancelled) setLoading(false)
    }
    go()
    return () => { cancelled = true }
  }, [schoolYear])

  return (
    <div className="min-h-[100svh] bg-[#f5f7fa] pb-20">
      <ImpersonationBanner />
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-4 flex items-center gap-3">
        <Link to="/" className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center no-underline">
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </Link>
        <div className="flex-1 text-center text-[16px] font-bold text-white">
          Network Dashboard
        </div>
        <div className="w-8" />
      </nav>

      <div className="bg-white px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 overflow-x-auto">
        <div className="text-[11px] text-gray-500 font-semibold whitespace-nowrap">School Year:</div>
        {SCHOOL_YEARS.map(y => (
          <button
            key={y}
            onClick={() => setSchoolYear(y)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors ${
              schoolYear === y ? 'bg-fls-navy text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      <div className="sticky top-[50px] z-40 bg-white border-b border-gray-200 px-3 py-2.5 flex gap-1.5 overflow-x-auto">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`px-3.5 py-1.5 rounded-[18px] text-xs font-bold whitespace-nowrap border-[1.5px] transition-colors ${
              category === cat.key
                ? 'bg-fls-navy text-white border-fls-navy'
                : 'bg-gray-50 text-gray-500 border-transparent'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-2 pb-6 max-w-[900px] mx-auto">
        {loading && <div className="text-center text-gray-400 text-sm py-10">Loading network…</div>}
        {!loading && !data && <Empty msg="Could not load network dashboard. Check access." />}
        {!loading && data && (
          <>
            {category === 'overview'     && <OverviewView data={data} />}
            {category === 'fundamentals' && <FundamentalsView data={data} />}
            {category === 'observations' && <ObservationsView data={data} />}
            {category === 'pmap'         && <PMAPView data={data} />}
            {category === 'reflection'   && <SchoolCountsView data={data} typeMatcher={t => t.startsWith('self_reflection_')} label="Self-reflections" emptyMsg="No self-reflections submitted this year." />}
            {category === 'feedback'     && <SchoolCountsView data={data} typeMatcher={t => t === 'quick_feedback'} label="Quick feedback notes" emptyMsg="No quick feedback logged this year." />}
            {category === 'celebrate'    && <SchoolCountsView data={data} typeMatcher={t => t === 'celebrate' || t === 'celebration'} label="Celebrations" emptyMsg="No celebrations logged this year." />}
            {category === 'meetings'     && <SchoolCountsView data={data} typeMatcher={t => t.startsWith('meeting')} label="Meetings" emptyMsg="No meetings logged this year." />}
          </>
        )}
      </div>

      <BottomNav active="network" onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="network" />
    </div>
  )
}
