import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import LogTouchpointModal from '../components/LogTouchpointModal'
import TouchpointDetail from '../components/TouchpointDetail'
import ImpersonationBanner from '../components/ImpersonationBanner'
import GlobalSearch from '../components/GlobalSearch'
import { api } from '../lib/api'

// Short, human-readable form_type labels for chips on record cards
const FORM_LABEL = {
  observation_teacher: 'Observation',
  observation_prek: 'PreK Observation',
  observation_fundamentals: 'Fundamentals',
  pmap_teacher: 'PMAP',
  pmap_prek: 'PMAP: PreK',
  pmap_leader: 'PMAP: Leader',
  pmap_support: 'PMAP: Support',
  pmap_network: 'PMAP: Network',
  self_reflection_teacher: 'Self-Reflection',
  self_reflection_prek: 'SR: PreK',
  self_reflection_leader: 'SR: Leader',
  self_reflection_support: 'SR: Support',
  self_reflection_network: 'SR: Network',
  quick_feedback: 'Quick Feedback',
  celebrate: 'Celebrate',
  celebration: 'Celebrate',
  meeting: 'Meeting',
  meeting_data: 'Data Meeting',
  meeting_quick_meeting: 'Meeting',
  'meeting_data_meeting_(relay)': 'Data Meeting',
  solicited_feedback: 'Solicit Feedback',
  write_up: 'Write-Up',
  performance_improvement_plan: 'PIP',
  iap: 'PIP',
}

/**
 * StaffProfile — Trends lens with multi-category toggle.
 *
 * Pulls real data from /api/staff/<email>. Hydrates name/school/role from
 * the staff object, then groups touchpoints into 7 categories for the toggle:
 * Fundamentals · Observations · PMAP · Self-Reflection · Quick FB ·
 * Celebrate · Meetings.
 */

const DIM_SHORT = {
  T1: 'On Task', T2: 'CoL', T3: 'Content', T4: 'Cog Eng', T5: 'Demo',
  L1: 'Instr Lead', L2: 'Culture', L3: 'Personal', L4: 'Talent', L5: 'Strategy',
}
const TEACHER_DIMS = ['T1', 'T2', 'T3', 'T4', 'T5']

function scoreClass(s) {
  if (s == null) return ''
  const n = Math.round(s)
  return `score-${Math.max(1, Math.min(5, n))}`
}

function initials(name) {
  const p = (name || '').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '—'
}

function formatDate(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(day)}, ${y}`
}

function Empty({ msg }) {
  return <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm shadow-sm">{msg}</div>
}

// Draft heuristic: records before ObservationPoint launch are imported from Grow.
// Real build replaces this with a `source` column on the touchpoints table.
const LAUNCH_DATE = '2026-04-01'
function isLegacyRecord(tp) {
  return !!(tp.date && tp.date < LAUNCH_DATE)
}

/**
 * Dedup touchpoints that are effectively the same event. Two records with
 * the same date, form_type, observer_email, AND identical scores are a
 * duplicate (often from a reimported Grow export). Different observers
 * on the same date stay separate — that's the manager+managee pattern.
 */
function dedupTouchpoints(touchpoints) {
  const seen = new Map()
  for (const tp of touchpoints) {
    const scoreKey = Object.entries(tp.scores || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')
    const key = `${tp.date || ''}|${tp.form_type || ''}|${(tp.observer_email || '').toLowerCase()}|${scoreKey}`
    if (!seen.has(key)) {
      seen.set(key, tp)
    } else {
      // Keep the one with richer content (more notes/json)
      const existing = seen.get(key)
      const existingRichness = (existing.notes?.length || 0) + (existing.feedback_json ? 1000 : 0) + (existing.meeting_json ? 1000 : 0)
      const newRichness = (tp.notes?.length || 0) + (tp.feedback_json ? 1000 : 0) + (tp.meeting_json ? 1000 : 0)
      if (newRichness > existingRichness) seen.set(key, tp)
    }
  }
  return [...seen.values()]
}

/** True if notes is just the form label / archived import garbage we want to hide. */
function isJunkNote(notes, label, formType) {
  if (!notes) return true
  const n = notes.trim()
  if (!n) return true
  if (n === label || n === formType) return true
  if (n.startsWith('[ARCHIVE]')) return true
  // Common Grow form-name patterns with or without hyphen
  if (/^(Observation|PMAP|Self[- ]Reflection)(\/Feedback Form)?:\s/.test(n) && n.length < 60) return true
  if (/^Observation:\s*(Teacher|PreK|Fundamentals|Leader)$/i.test(n)) return true
  return false
}

function RecordCard({ tp, staffEmail, onClick, extra }) {
  const scores = tp.scores || {}
  const label = FORM_LABEL[tp.form_type] || tp.form_type
  const isSelf = staffEmail && tp.observer_email && tp.observer_email.toLowerCase() === staffEmail.toLowerCase()
  const legacy = isLegacyRecord(tp)
  // Does the record have anything beyond what the card shows?
  const hasExtra = !!(tp.feedback_json || tp.meeting_json || (tp.notes && tp.notes.length > 140))
  // Only tappable if tapping reveals more
  const Tag = hasExtra ? 'button' : 'div'
  return (
    <Tag
      onClick={hasExtra ? onClick : undefined}
      className={`block w-full text-left rounded-xl p-3.5 shadow-sm mb-2.5 border-0 font-[inherit] ${
        hasExtra ? 'cursor-pointer active:scale-[.99] transition-transform' : 'cursor-default'
      } ${legacy ? 'bg-gray-50' : 'bg-white'}`}
    >
      <div className="flex items-center justify-between gap-2.5 mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className="text-[13px] font-bold">{formatDate(tp.date)}</div>
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 shrink-0">
            {label}
          </span>
          {legacy && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-gray-200 text-gray-500 shrink-0"
              title="Imported from Grow — structure may be thinner than new records"
            >
              Imported
            </span>
          )}
          {isSelf ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 shrink-0">
              Self
            </span>
          ) : (tp.observer_name || tp.observer_email) ? (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 shrink-0 truncate max-w-[180px]"
              title={tp.observer_email}
            >
              by {tp.observer_name || tp.observer_email.split('@')[0]}
            </span>
          ) : null}
        </div>
      </div>
      {Object.keys(scores).length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap items-center">
          {Object.entries(scores).map(([code, s]) => (
            <span key={code} className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${scoreClass(s)}`}>
              {DIM_SHORT[code] || code} {s}
            </span>
          ))}
          {extra}
        </div>
      )}
      {Object.keys(scores).length === 0 && extra && (
        <div className="flex mt-2">{extra}</div>
      )}
      {tp.notes && !isJunkNote(tp.notes, label, tp.form_type) && (
        <div className="text-xs text-gray-600 mt-2 italic pl-2 border-l-2 border-gray-200 line-clamp-3">{tp.notes}</div>
      )}
      {hasExtra && (
        <div className="text-[10px] text-gray-400 mt-1.5 font-semibold">Tap for full record →</div>
      )}
    </Tag>
  )
}

/** Compute avg on-task % for a fundamentals record from its M1-M5 scores.
 * New records store M1-M5 as 0-100 percents (from the timer form). Imported
 * Grow records likely store 1-5 rubric scores. Skip those for trend purposes —
 * rescaling 1-5 to 0-100 would misrepresent the numbers. */
function fundOnTaskPct(tp) {
  const s = tp.scores || {}
  const mins = ['M1', 'M2', 'M3', 'M4', 'M5'].map(k => s[k]).filter(v => v != null)
  if (mins.length === 0) return null
  const max = Math.max(...mins)
  if (max <= 5) return null  // rubric-scale legacy data — not a percent
  return Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
}

/** SVG sparkline of fundamentals on-task % over time (chronological). */
function FundamentalsTrend({ fund }) {
  // Oldest → newest for left-to-right trend
  const sorted = [...fund].sort((a, b) => new Date(a.date) - new Date(b.date))
  const pts = sorted
    .map(tp => ({ date: tp.date, pct: fundOnTaskPct(tp) }))
    .filter(p => p.pct != null)

  if (pts.length < 2) return null  // need at least 2 points to draw a line

  const W = 600, H = 160, P = 16
  const xs = pts.map((_, i) => P + (i * (W - P * 2)) / (pts.length - 1))
  const ys = pts.map(p => P + ((100 - p.pct) * (H - P * 2)) / 100)
  const poly = xs.map((x, i) => `${x},${ys[i]}`).join(' ')

  const latest = pts[pts.length - 1]
  const first = pts[0]
  const delta = latest.pct - first.pct
  const avg = Math.round(pts.reduce((a, p) => a + p.pct, 0) / pts.length)

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 mt-3 mb-4">
      <div className="flex items-end justify-between mb-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Fundamentals · On-Task Trend</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-3xl font-extrabold text-fls-navy">{latest.pct}%</span>
            <span className="text-xs font-semibold text-gray-500">latest</span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-bold ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {delta >= 0 ? '+' : ''}{delta} pts
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">vs first · avg {avg}%</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[110px]" preserveAspectRatio="none">
        {/* horizontal gridlines at 25/50/75 */}
        {[25, 50, 75].map(v => {
          const y = P + ((100 - v) * (H - P * 2)) / 100
          return <line key={v} x1={P} x2={W - P} y1={y} y2={y} stroke="#f3f4f6" strokeWidth="1" />
        })}
        {/* trend line */}
        <polyline points={poly} fill="none" stroke="#e47727" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* dots */}
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r="3.5" fill="#e47727" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{formatDate(first.date)}</span>
        <span>{formatDate(latest.date)}</span>
      </div>
    </div>
  )
}

function FundamentalsView({ touchpoints, onOpenDetail, staffEmail }) {
  const fund = touchpoints.filter(t => t.form_type === 'observation_fundamentals')
  if (fund.length === 0) return <Empty msg="No Fundamentals observations yet." />

  return (
    <div>
      <FundamentalsTrend fund={fund} />
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        Fundamentals Visits · {fund.length}
      </div>
      {fund.map(tp => {
        const pct = fundOnTaskPct(tp)
        return (
          <RecordCard
            key={tp.id} tp={tp} staffEmail={staffEmail}
            onClick={() => onOpenDetail(tp)}
            extra={pct != null ? <span className="px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 text-[10px] font-bold">{pct}% on-task</span> : null}
          />
        )
      })}
    </div>
  )
}

function ObservationsView({ touchpoints, onOpenDetail, staffEmail }) {
  const obs = touchpoints.filter(t => t.form_type === 'observation_teacher' || t.form_type === 'observation_prek')
  if (obs.length === 0) return <Empty msg="No observations on record." />

  const latest = obs[0]?.scores || {}
  const dimCodes = Object.keys(latest).sort()

  return (
    <div>
      {dimCodes.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
            Most recent · {formatDate(obs[0].date)}
          </div>
          <div className={`grid gap-2 mb-4 ${dimCodes.length > 5 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-5'}`}>
            {dimCodes.map(code => (
              <div key={code} className="bg-white rounded-[10px] p-2 text-center shadow-sm">
                <div className="text-[9px] font-bold text-gray-400 uppercase">{DIM_SHORT[code] || code}</div>
                <div className={`inline-block text-lg font-extrabold mt-1 px-2 rounded ${scoreClass(latest[code])}`}>
                  {latest[code]}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        All Observations · {obs.length}
      </div>
      {obs.map(tp => (
        <RecordCard key={tp.id} tp={tp} staffEmail={staffEmail} onClick={() => onOpenDetail(tp)} />
      ))}
    </div>
  )
}

/** Small per-dimension trend card. Shows latest value as the hero number,
 * delta vs prior year as ↑/↓, and a tiny SVG sparkline of all available years. */
function PMAPDimSparkline({ code, name, points }) {
  // points: [{ date, year, value }] — one entry per individual PMAP record (not yearly averages).
  if (!points || points.length === 0) return null
  const latest = points[points.length - 1]
  const prior = points.length > 1 ? points[points.length - 2] : null
  const delta = prior != null ? +(latest.value - prior.value).toFixed(1) : null

  // SVG path
  const W = 120, H = 36, P = 4
  const xs = points.map((_, i) => points.length === 1 ? W / 2 : P + (i * (W - P * 2)) / (points.length - 1))
  const ys = points.map(p => P + ((5 - p.value) * (H - P * 2)) / 4)
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')

  const valueColor = latest.value >= 4 ? '#059669' : latest.value >= 3 ? '#e47727' : '#dc2626'
  const trendColor = delta == null ? '#9ca3af' : delta > 0 ? '#059669' : delta < 0 ? '#dc2626' : '#9ca3af'
  const trendArrow = delta == null ? '·' : delta > 0 ? '↑' : delta < 0 ? '↓' : '·'

  const fmt = (d) => {
    if (!d) return ''
    const dt = new Date(d)
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  }

  return (
    <div className="bg-white rounded-xl p-3 shadow-sm">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{name}</div>
        <div className="text-[10px] font-semibold whitespace-nowrap" style={{ color: trendColor }}>
          {trendArrow}{delta != null ? ` ${Math.abs(delta).toFixed(1)}` : ''}
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-2xl font-extrabold leading-none" style={{ color: valueColor }}>{latest.value.toFixed(1)}</div>
          <div className="text-[9px] text-gray-500 mt-0.5">most recent</div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-[120px] h-[36px]" preserveAspectRatio="none">
          <line x1={P} x2={W - P} y1={P + ((5 - 3) * (H - P * 2)) / 4} y2={P + ((5 - 3) * (H - P * 2)) / 4}
                stroke="#f3f4f6" strokeWidth="1" />
          {points.length > 1 && (
            <path d={path} fill="none" stroke={valueColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {points.map((p, i) => (
            <circle key={i} cx={xs[i]} cy={ys[i]} r="3" fill={valueColor}>
              <title>{`${p.value.toFixed(1)} · ${fmt(p.date)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="text-right text-[9px] text-gray-400 mt-1">
        {points.length} PMAP{points.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function PMAPView({ touchpoints, pmap_by_year, school_years, onOpenDetail, staffEmail }) {
  // Last 3 PMAPs regardless of year — show the most recent 3 individual PMAPs.
  const allPmaps = touchpoints
    .filter(t => t.form_type.startsWith('pmap_'))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))  // most recent first
  const pmaps = allPmaps.slice(0, 3).reverse() // take last 3, then reverse to chronological for the chart

  // Dimension codes from the actual PMAP records (leaders use L1-L5, teachers T1-T5, PreK PK1-PK10).
  const dimCodes = (() => {
    const seen = new Set()
    for (const p of pmaps) {
      for (const code of Object.keys(p.scores || {})) seen.add(code)
    }
    return [...seen].sort((a, b) => {
      const pa = a.replace(/\d+/, '')
      const pb = b.replace(/\d+/, '')
      if (pa !== pb) return pa.localeCompare(pb)
      return parseInt(a.replace(/\D+/, '')) - parseInt(b.replace(/\D+/, ''))
    })
  })()

  // Per-dimension series — one point per individual PMAP (not yearly averages).
  // Each point: { date, year, value } so the sparkline shows actual PMAPs (mid-year + end-year cycles).
  const dimSeries = dimCodes.map(code => {
    const points = pmaps
      .filter(p => p.scores?.[code] != null)
      .map(p => ({ date: p.date, year: p.school_year, value: p.scores[code] }))
    return { code, name: DIM_SHORT[code] || code, points }
  }).filter(d => d.points.length > 0)

  return (
    <div>
      {dimSeries.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
            PMAP trend · per dimension
          </div>
          <div className={`grid gap-2 mb-4 ${dimSeries.length > 5 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-5'}`}>
            {dimSeries.map(d => (
              <PMAPDimSparkline key={d.code} code={d.code} name={d.name} points={d.points} />
            ))}
          </div>
        </>
      )}

      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        Last {pmaps.length} PMAP{pmaps.length === 1 ? '' : 's'}
      </div>
      {pmaps.length === 0 ? (
        <Empty msg="No PMAPs on record." />
      ) : (
        [...pmaps].reverse().map(tp => (
          <RecordCard key={tp.id} tp={tp} staffEmail={staffEmail} onClick={() => onOpenDetail(tp)} />
        ))
      )}
    </div>
  )
}

function SimpleListView({ touchpoints, matcher, emptyMsg, onOpenDetail, staffEmail }) {
  const filtered = touchpoints.filter(matcher)
  if (filtered.length === 0) return <Empty msg={emptyMsg} />
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        {filtered.length} on record
      </div>
      {filtered.map(tp => (
        <RecordCard key={tp.id} tp={tp} staffEmail={staffEmail} onClick={() => onOpenDetail(tp)} />
      ))}
    </div>
  )
}

const CATEGORIES = [
  { key: 'recent',       label: 'Recent' },
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'observations', label: 'Observations' },
  { key: 'pmap',         label: 'PMAP' },
  { key: 'goals',        label: 'Goals & Action Steps' },
  { key: 'reflection',   label: 'Self-Reflection' },
  { key: 'feedback',     label: 'Quick FB' },
  { key: 'celebrate',    label: 'Celebrate' },
  { key: 'meetings',     label: 'Meetings' },
]

const TYPE_BADGE = {
  observation_teacher:    { label: 'Observation', bg: '#dbeafe', color: '#1d4ed8' },
  observation_prek:       { label: 'PreK Obs',    bg: '#fce7f3', color: '#be185d' },
  observation_fundamentals:{ label: 'Fundamentals',bg: '#fef3c7', color: '#b45309' },
  pmap_teacher:           { label: 'PMAP',        bg: '#dcfce7', color: '#15803d' },
  pmap_prek:              { label: 'PMAP',        bg: '#dcfce7', color: '#15803d' },
  pmap_leader:            { label: 'PMAP',        bg: '#dcfce7', color: '#15803d' },
  pmap_network:           { label: 'PMAP',        bg: '#dcfce7', color: '#15803d' },
  pmap_support:           { label: 'PMAP',        bg: '#dcfce7', color: '#15803d' },
  self_reflection_teacher:{ label: 'Self-Refl',   bg: '#ede9fe', color: '#6d28d9' },
  self_reflection_leader: { label: 'Self-Refl',   bg: '#ede9fe', color: '#6d28d9' },
  self_reflection_prek:   { label: 'Self-Refl',   bg: '#ede9fe', color: '#6d28d9' },
  self_reflection_network:{ label: 'Self-Refl',   bg: '#ede9fe', color: '#6d28d9' },
  self_reflection_support:{ label: 'Self-Refl',   bg: '#ede9fe', color: '#6d28d9' },
  quick_feedback:         { label: 'Quick FB',    bg: '#fef3c7', color: '#b45309' },
  celebrate:              { label: 'Celebrate',   bg: '#d1fae5', color: '#059669' },
  solicited_feedback:     { label: 'Solicit',     bg: '#dbeafe', color: '#2563eb' },
  meeting_quick_meeting:  { label: 'Meeting',     bg: '#f0fdf4', color: '#16a34a' },
  'meeting_data_meeting_(relay)': { label: 'Data Mtg', bg: '#f0fdf4', color: '#16a34a' },
}

/** Latest PMAP card: dimension chips + strength/growth snippet if present. */
function LatestPMAPCard({ touchpoints, onOpenDetail }) {
  // Exclude test records and any post-current-year drafts so a test PMAP doesn't
  // override real Grow PMAPs in the "Latest" display.
  const pmaps = touchpoints.filter(t =>
    t.form_type.startsWith('pmap_')
    && !t.is_test
    && t.school_year && t.school_year <= '2025-2026'
  )
  const latest = pmaps[0]
  if (!latest) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm mb-3 text-sm text-gray-400 text-center">
        No PMAP on record yet.
      </div>
    )
  }
  const scores = latest.scores || {}
  const codes = Object.keys(scores).sort()
  // Pull strength/growth from feedback JSON if structured
  let snippet = ''
  try {
    const fb = typeof latest.feedback === 'string' ? JSON.parse(latest.feedback) : latest.feedback
    if (fb && typeof fb === 'object') {
      snippet = fb.strength_areas || fb.growth_areas || fb.commit_strength || ''
    }
  } catch {}
  if (!snippet && typeof latest.feedback === 'string') snippet = latest.feedback.slice(0, 200)
  return (
    <button
      onClick={() => onOpenDetail(latest)}
      className="w-full text-left bg-white rounded-xl p-4 shadow-sm mb-3 border-l-4 border-green-500 cursor-pointer active:scale-[.99] transition-transform border-0 font-[inherit]"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Latest PMAP · {formatDate(latest.date)}
        </div>
        <div className="text-[10px] text-fls-orange font-semibold">Tap →</div>
      </div>
      {codes.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2">
          {codes.map(code => (
            <span key={code} className={`text-[11px] font-bold px-2 py-1 rounded-md ${scoreClass(scores[code])}`}>
              {DIM_SHORT[code] || code} {scores[code]}
            </span>
          ))}
        </div>
      )}
      {snippet && (
        <div className="text-xs text-gray-600 italic leading-relaxed line-clamp-3 whitespace-pre-wrap">
          {snippet}
        </div>
      )}
    </button>
  )
}

/** Snapshot view: hero KPIs + latest PMAP + recent current-year feed.
 * Option B layout Scott picked. Default landing for the profile.
 * Past-year deep dives live under the 'More views' category tabs and the Past years link. */
function SnapshotView({ touchpoints, onOpenDetail, staffEmail, currentSY, onShowPast, assignmentsSummary }) {
  // Current-year filter
  const thisYear = touchpoints.filter(t => t.school_year === currentSY)
  const sorted = [...thisYear].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  const [showAllCurrent, setShowAllCurrent] = useState(false)
  const visible = showAllCurrent ? sorted : sorted.slice(0, 3)

  // At-a-glance values
  const obsCount = thisYear.filter(t => t.form_type.startsWith('observation_')).length
  // Avg from the MOST RECENT observation's T1-T5 (not a rolling lifetime avg)
  const allObsSorted = [...touchpoints.filter(t => t.form_type.startsWith('observation_'))]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  const latestObs = allObsSorted[0]
  const latestObsDims = latestObs
    ? Object.values(latestObs.scores || {}).filter(v => typeof v === 'number' && v <= 5)
    : []
  const avgScore = latestObsDims.length > 0
    ? (latestObsDims.reduce((a, b) => a + b, 0) / latestObsDims.length).toFixed(1)
    : '—'
  // Days since last OBSERVATION specifically (not any touchpoint).
  const daysSinceLastObs = latestObs?.date ? Math.floor((new Date() - new Date(latestObs.date)) / (1000 * 60 * 60 * 24)) : null

  return (
    <div>
      {/* 3 KPI tiles — Obs YTD · Latest avg · Last Obs */}
      <div className="grid grid-cols-3 gap-2 mt-4 mb-4">
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{obsCount}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Obs this year</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{avgScore}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Latest obs avg</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">
            {daysSinceLastObs != null ? `${daysSinceLastObs}d` : '—'}
          </div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Last Obs</div>
        </div>
      </div>

      {/* Latest PMAP (any year — always useful context) */}
      <LatestPMAPCard touchpoints={touchpoints} onOpenDetail={onOpenDetail} />

      {/* Recent Touchpoints — expand once for top 3, expand again for all current year inline */}
      <details className="bg-white rounded-xl shadow-sm mt-3 mb-2 overflow-hidden">
        <summary className="cursor-pointer p-3 text-[11px] font-bold uppercase tracking-wider text-gray-700 select-none flex items-center justify-between">
          <span>Recent Touchpoints · {showAllCurrent ? sorted.length : Math.min(3, sorted.length)} of {sorted.length} this year</span>
          <span className="text-gray-400">›</span>
        </summary>
        <div className="px-3 pb-3">
          {sorted.length === 0 ? (
            <div className="text-[12px] text-gray-500 text-center py-2">No activity this year yet.</div>
          ) : (
            <>
              {visible.map(tp => {
          const badge = TYPE_BADGE[tp.form_type] || { label: tp.form_type, bg: '#f3f4f6', color: '#4b5563' }
          const isSelf = staffEmail && tp.observer_email && tp.observer_email.toLowerCase() === staffEmail.toLowerCase()
          const isReflection = tp.form_type.startsWith('self_reflection_')
          const hasExtra = !!(tp.feedback_json || tp.meeting_json || (tp.notes && tp.notes.length > 0 && !isJunkNote(tp.notes, badge.label, tp.form_type)))
          const Tag = hasExtra ? 'button' : 'div'
          return (
            <Tag
              key={tp.id}
              onClick={hasExtra ? () => onOpenDetail(tp) : undefined}
              className={`block w-full text-left rounded-xl p-3.5 shadow-sm mb-2 bg-white border-0 font-[inherit] ${hasExtra ? 'cursor-pointer active:scale-[.99] transition-transform' : 'cursor-default'}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md shrink-0"
                      style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{formatDate(tp.date)}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {isReflection && isSelf ? 'Self-submitted' :
                     isSelf ? 'Observer not recorded' :
                     tp.observer_name ? `by ${tp.observer_name}` :
                     tp.observer_email ? `by ${tp.observer_email.split('@')[0]}` : ''}
                  </div>
                </div>
                {tp.scores && Object.keys(tp.scores).length > 0 && (
                  <div className="text-[11px] font-bold text-fls-navy shrink-0">
                    {Math.round((Object.values(tp.scores).reduce((a, b) => a + b, 0) / Object.keys(tp.scores).length) * 10) / 10}
                  </div>
                )}
              </div>
            </Tag>
          )
        })}
            </>
          )}
        </div>
        {sorted.length > 3 && !showAllCurrent && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100">
            <button onClick={(e) => { e.stopPropagation(); setShowAllCurrent(true) }} className="w-full text-[11px] text-fls-orange font-bold py-1.5 bg-transparent border-0 cursor-pointer font-[inherit]">
              Show all {sorted.length} current year ↓
            </button>
          </div>
        )}
        {showAllCurrent && (
          <div className="px-3 pb-3 pt-1 border-t border-gray-100">
            <button onClick={(e) => { e.stopPropagation(); setShowAllCurrent(false) }} className="w-full text-[11px] text-gray-500 font-semibold py-1.5 bg-transparent border-0 cursor-pointer font-[inherit]">
              Collapse to recent 3 ↑
            </button>
          </div>
        )}
      </details>
      <button onClick={onShowPast} className="w-full mt-2 px-3 py-2.5 rounded-[10px] bg-white border border-gray-200 text-fls-navy text-[12px] font-bold cursor-pointer font-[inherit] flex items-center justify-center gap-1">
        📈 View last 3 PMAPs →
      </button>
    </div>
  )
}

function RecentView({ touchpoints, onOpenDetail, staffEmail }) {
  // Most recent first, mixed types, all published records
  const sorted = [...touchpoints].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  const first = sorted.slice(0, 25)

  // At-a-glance stats
  const total = touchpoints.length
  const thisYear = touchpoints.filter(t => t.school_year === '2025-2026').length
  const observersSet = new Set(touchpoints.map(t => t.observer_email).filter(Boolean))
  const latest = sorted[0]

  if (total === 0) return <Empty msg="No records yet." />

  return (
    <div>
      {/* At-a-glance */}
      <div className="grid grid-cols-3 gap-2 mt-4 mb-4">
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{total}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Total touchpoints</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{thisYear}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">This year</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{observersSet.size}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Unique observers</div>
        </div>
      </div>

      {latest && (
        <div className="text-[11px] text-gray-500 mb-2">
          Most recent · <span className="font-semibold text-gray-700">{formatDate(latest.date)}</span>
          {latest.observer_name && <> · by {latest.observer_name}</>}
        </div>
      )}

      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        Recent activity · showing {first.length} of {total}
      </div>

      {first.map(tp => {
        const badge = TYPE_BADGE[tp.form_type] || { label: tp.form_type, bg: '#f3f4f6', color: '#4b5563' }
        const isSelf = staffEmail && tp.observer_email && tp.observer_email.toLowerCase() === staffEmail.toLowerCase()
        const isReflection = tp.form_type.startsWith('self_reflection_')
        const hasExtra = !!(tp.feedback_json || tp.meeting_json || (tp.notes && tp.notes.length > 0 && !isJunkNote(tp.notes, badge.label, tp.form_type)))
        const Tag = hasExtra ? 'button' : 'div'
        return (
          <Tag
            key={tp.id}
            onClick={hasExtra ? () => onOpenDetail(tp) : undefined}
            className={`block w-full text-left rounded-xl p-3.5 shadow-sm mb-2 bg-white border-0 font-[inherit] ${
              hasExtra ? 'cursor-pointer active:scale-[.99] transition-transform' : 'cursor-default'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md shrink-0"
                style={{ background: badge.bg, color: badge.color }}
              >
                {badge.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold">{formatDate(tp.date)}</div>
                <div className="text-[11px] text-gray-500 truncate">
                  {isReflection && isSelf ? 'Self-submitted' :
                   // If observer == teacher on a non-reflection record, hide
                   // the attribution entirely (consistent: name or nothing).
                   isSelf ? '' :
                   tp.observer_name ? `by ${tp.observer_name}` :
                   tp.observer_email ? `by ${tp.observer_email.split('@')[0]}` :
                   ''}
                </div>
              </div>
              {tp.scores && Object.keys(tp.scores).length > 0 && (
                <div className="text-[11px] font-bold text-fls-navy shrink-0">
                  {Math.round((Object.values(tp.scores).reduce((a, b) => a + b, 0) / Object.keys(tp.scores).length) * 10) / 10}
                </div>
              )}
            </div>
            {hasExtra && (
              <div className="text-[10px] text-gray-400 mt-2 font-semibold">Tap for full record →</div>
            )}
          </Tag>
        )
      })}
    </div>
  )
}

function GoalsView({ email }) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let cancelled = false
    api.get(`/api/staff/${encodeURIComponent(email)}/assignments`)
      .then(r => { if (!cancelled) setItems(Array.isArray(r) ? r : []) })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [email])

  if (items == null) return <div className="text-center text-gray-400 text-sm py-10">Loading…</div>
  if (items.length === 0) return <Empty msg="No goals or action steps assigned." />

  // Bucket by type
  const goals = items.filter(x => x.type === 'goal')
  const steps = items.filter(x => x.type === 'actionStep')
  const todos = items.filter(x => x.type === 'toDo')

  // Completion stats
  const totalDone = items.filter(x => x.progress_pct === 100).length
  const totalInProg = items.filter(x => x.progress_pct > 0 && x.progress_pct < 100).length

  function Card({ a }) {
    const color = a.progress_pct === 100 ? '#059669' : a.progress_pct > 0 ? '#e47727' : '#9ca3af'
    return (
      <div className="bg-white rounded-xl p-3.5 shadow-sm mb-2.5 border-l-4" style={{ borderLeftColor: color }}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {a.type === 'goal' ? 'GOAL' : a.type === 'actionStep' ? 'ACTION STEP' : 'TO DO'}
            {a.school_year && <span className="text-gray-300"> · {a.school_year}</span>}
          </div>
          <div className="text-[11px] font-bold" style={{ color }}>
            {a.progress_pct === 100 ? '✓ Complete' : a.progress_pct > 0 ? `${a.progress_pct}% in progress` : 'Not started'}
          </div>
        </div>
        <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{a.body}</div>
        {a.creator_email && (
          <div className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">
            Assigned by {a.creator_email.split('@')[0]} · {formatDate(a.created_at)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mt-4 mb-4">
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-fls-navy">{items.length}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Total</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-green-600">{totalDone}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">Complete</div>
        </div>
        <div className="bg-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-2xl font-extrabold text-orange-600">{totalInProg}</div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mt-0.5">In Progress</div>
        </div>
      </div>

      {goals.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">Goals · {goals.length}</div>
          {goals.map(a => <Card key={a.id} a={a} />)}
        </>
      )}
      {steps.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">Action Steps · {steps.length}</div>
          {steps.map(a => <Card key={a.id} a={a} />)}
        </>
      )}
      {todos.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">To-Do · {todos.length}</div>
          {todos.map(a => <Card key={a.id} a={a} />)}
        </>
      )}
    </div>
  )
}

/**
 * YourTodos — the "Yours to do" card stack shown at the top of self's StaffProfile.
 * Reads /api/me/todos and renders one row per outstanding item (SR / Goals / Action Steps).
 * If everything is done, shows the all-caught-up empty state.
 */
function YourTodos({ todos }) {
  const sr = todos.self_reflection
  const goals = todos.goals
  const srPending = sr && !sr.completed
  const goalsPending = goals && !goals.all_approved
  const nothing = !srPending && !goalsPending

  const Row = ({ to, icon, title, sub }) => (
    <Link
      to={to}
      className="flex items-center gap-3 bg-white rounded-xl p-3.5 shadow-sm mb-2 border-l-4 border-orange-500 no-underline text-inherit active:scale-[.99] transition-transform"
    >
      <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center text-base font-extrabold shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-gray-900">{title}</div>
        <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
      </div>
      <div className="text-orange-500 text-base font-bold shrink-0">→</div>
    </Link>
  )

  return (
    <div className="mt-3 mb-4">
      <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mb-2">Yours to do</div>
      {srPending && (
        <Row to="/app/self-reflection" icon="📝" title="Complete your Self-Reflection" sub="Due this cycle" />
      )}
      {goalsPending && (
        <Row
          to="/app/goals"
          icon="🎯"
          title={goals.any_set === 0 ? 'Set your goals' : 'Submit your goals for approval'}
          sub={`${goals.approved_count || 0} of 4 approved`}
        />
      )}
      {nothing && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 text-center">
          <div className="text-[13px] font-bold text-green-800">All caught up ✨</div>
          <div className="text-[11px] text-green-700 mt-0.5">Nothing pending right now.</div>
        </div>
      )}
    </div>
  )
}

/**
 * ActionStepsSection — always visible on StaffProfile.
 * Self viewer: "Request Review" button per active step.
 * Supervisor/admin: "Mark Mastered" / "Edit" / "Delete" + "Assign new" CTA.
 */
function ActionStepsSection({ email, isSelf, navigate }) {
  const [searchParams] = useSearchParams()
  const urlSy = searchParams.get('sy')
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')

  const reload = () => {
    api.get(`/api/staff/${encodeURIComponent(email)}/assignments`)
      .then(rows => setItems(Array.isArray(rows)
        ? rows.filter(r => r.type === 'actionStep')
        : []))
      .catch(() => setItems([]))
  }
  useEffect(() => { reload() }, [email])

  if (items == null) return <div className="text-center text-gray-400 text-sm py-6">Loading action steps…</div>

  // Group by school_year. Focused year follows URL ?sy= so the page
  // inherits whatever year the user was viewing on Network. Falls back
  // to newest year that has data if URL has no sy or specifies a year
  // with no records for this teacher.
  const byYear = {}
  items.forEach(a => {
    const y = a.school_year || 'Unknown'
    if (!byYear[y]) byYear[y] = []
    byYear[y].push(a)
  })
  const years = Object.keys(byYear).sort().reverse()
  const focusedYear = (urlSy && byYear[urlSy]) ? urlSy : (years[0] || null)
  const currentItems = focusedYear ? byYear[focusedYear] : []
  const active = currentItems.filter(x => (x.progress_pct || 0) < 100 && (x.progress_pct == null || x.progress_pct >= 0))
  const mastered = currentItems.filter(x => x.progress_pct === 100)
  const notMastered = currentItems.filter(x => x.progress_pct != null && x.progress_pct < 0)

  async function markMastered(id) {
    setBusy(id)
    try {
      await api.post(`/api/me/action-steps/${id}/progress`, { progress_pct: 100 })
      reload()
    } catch (e) { alert('Could not mark mastered: ' + (e.message || e)) }
    setBusy(null)
  }
  async function deleteStep(id) {
    if (!confirm('Delete this action step? This cannot be undone.')) return
    setBusy(id)
    try {
      await api.del(`/api/action-steps/${id}`)
      reload()
    } catch (e) { alert('Could not delete: ' + (e.message || e)) }
    setBusy(null)
  }
  async function saveEdit(id) {
    if (!editText.trim()) return
    setBusy(id)
    try {
      await api.put(`/api/action-steps/${id}`, { body_text: editText.trim() })
      setEditingId(null); setEditText('')
      reload()
    } catch (e) { alert('Could not save: ' + (e.message || e)) }
    setBusy(null)
  }
  async function requestReview(id) {
    setBusy(id)
    try {
      await api.post(`/api/me/action-steps/${id}/request-review`, { note: '' })
      alert('Review request sent to your supervisor.')
    } catch (e) { alert('Could not send: ' + (e.message || e)) }
    setBusy(null)
  }

  function StepCard({ a, archived }) {
    const isEditing = editingId === a.id
    const stateChip = archived
      ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">Mastered ✓</span>
      : (a.progress_pct > 0
        ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-orange-50 text-orange-700">In Progress</span>
        : <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-yellow-50 text-yellow-800">Not Mastered</span>)
    const dt = a.created_at ? new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
    return (
      <div className={`bg-white rounded-xl p-3.5 shadow-sm mb-2 border-l-[3px] ${archived ? 'border-emerald-500 opacity-75' : 'border-orange-500'}`}>
        {isEditing ? (
          <div>
            <textarea value={editText} onChange={e => setEditText(e.target.value)} className="w-full text-[13px] p-2 border border-gray-300 rounded" rows={3} />
            <div className="flex gap-2 mt-2">
              <button disabled={busy === a.id} onClick={() => saveEdit(a.id)} className="px-3 py-1.5 rounded bg-fls-navy text-white text-xs font-bold border-0 cursor-pointer">Save</button>
              <button onClick={() => { setEditingId(null); setEditText('') }} className="px-3 py-1.5 rounded bg-white border border-gray-300 text-xs font-bold cursor-pointer">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[13px] font-semibold text-gray-900 leading-snug">{a.body}</div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {stateChip}
              {a.school_year && <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{a.school_year}</span>}
              {dt && <span className="text-[10px] text-gray-500">· assigned {dt}</span>}
              {a.creator_email && <span className="text-[10px] text-gray-500">· by {a.creator_email.split('@')[0]}</span>}
            </div>
            {!archived && (
              <div className="flex gap-1.5 mt-2.5">
                {isSelf ? (
                  <button disabled={busy === a.id} onClick={() => requestReview(a.id)} className="px-2.5 py-1 rounded bg-fls-navy text-white text-[10px] font-bold border-0 cursor-pointer">Request Review</button>
                ) : (
                  <>
                    <button disabled={busy === a.id} onClick={() => markMastered(a.id)} className="px-2.5 py-1 rounded bg-green-600 text-white text-[10px] font-bold border-0 cursor-pointer">Mark Mastered</button>
                    <button onClick={() => { setEditingId(a.id); setEditText(a.body || '') }} className="px-2.5 py-1 rounded bg-white border border-gray-300 text-[10px] font-bold cursor-pointer">Edit</button>
                    <button disabled={busy === a.id} onClick={() => deleteStep(a.id)} className="px-2.5 py-1 rounded bg-white border border-gray-300 text-red-600 text-[10px] font-bold cursor-pointer">Delete</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // Other years = everything except focusedYear, descending.
  const otherYears = years.filter(y => y !== focusedYear)

  return (
    <div className="mt-2 mb-4">
      <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mb-2 flex items-center justify-between">
        <span>{isSelf ? 'Your Action Steps' : 'Action Steps'}{focusedYear ? ` · ${focusedYear}` : ''}</span>
        <span className="text-[10px] font-normal text-gray-400 normal-case tracking-normal">
          {active.length} active · {mastered.length} mastered{notMastered.length > 0 ? ` · ${notMastered.length} not mastered` : ''}
        </span>
      </div>
      {currentItems.length === 0 && otherYears.length === 0 && (
        <div className="bg-gray-50 rounded-xl p-3.5 text-center text-[12px] text-gray-500">No action steps yet.</div>
      )}
      {currentItems.length === 0 && otherYears.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-3.5 text-center text-[12px] text-gray-500">No action steps for {focusedYear}.</div>
      )}
      {active.map(a => <StepCard key={a.id} a={a} archived={false} />)}
      {mastered.length > 0 && (
        <details className="bg-white rounded-xl shadow-sm mb-2 overflow-hidden">
          <summary className="cursor-pointer p-3 text-[11px] font-bold text-gray-600 select-none">Mastered ({mastered.length}) ›</summary>
          <div className="px-3 pb-3">
            {mastered.map(a => <StepCard key={a.id} a={a} archived={true} />)}
          </div>
        </details>
      )}
      {notMastered.length > 0 && (
        <details className="bg-white rounded-xl shadow-sm mb-2 overflow-hidden">
          <summary className="cursor-pointer p-3 text-[11px] font-bold text-gray-600 select-none">Not Mastered ({notMastered.length}) ›</summary>
          <div className="px-3 pb-3">
            {notMastered.map(a => <StepCard key={a.id} a={a} archived={false} />)}
          </div>
        </details>
      )}

      {/* Other school years — collapsed. Each year shows active+mastered together. */}
      {otherYears.map(y => {
        const yearItems = byYear[y]
        return (
          <details key={y} className="bg-gray-50 rounded-xl shadow-sm mb-2 overflow-hidden">
            <summary className="cursor-pointer p-3 text-[11px] font-bold text-gray-600 select-none flex items-center justify-between">
              <span>{y} ({yearItems.length})</span>
              <span className="text-[10px] text-gray-400">›</span>
            </summary>
            <div className="px-3 pb-3">
              {yearItems.map(a => <StepCard key={a.id} a={a} archived={a.progress_pct === 100} />)}
            </div>
          </details>
        )
      })}

      {!isSelf && (
        <button
          onClick={() => navigate(`/app/observe?teacher=${encodeURIComponent(email)}`)}
          className="w-full mt-1 px-3 py-2.5 rounded-[10px] bg-fls-navy text-white text-xs font-bold cursor-pointer border-0 font-[inherit]"
        >+ Assign new action step</button>
      )}
    </div>
  )
}

/**
 * DisciplineSection — collapsible. Always renders. Shows PIP / Write-Up / IAP records.
 * Backend-side RBAC determines whether records are returned for this viewer.
 */
function DisciplineSection({ touchpoints, onOpenDetail }) {
  const HR_TYPES = new Set(['performance_improvement_plan', 'iap', 'write_up'])
  // Current year only — don't hang HR records over people's heads forever.
  const records = touchpoints.filter(t => HR_TYPES.has(t.form_type) && t.school_year === '2025-2026').sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0))
  const labelFor = (ft) => ft === 'write_up' ? 'Write-Up' : ft === 'iap' ? 'PIP (legacy)' : 'PIP'

  return (
    <details className="bg-red-50 border border-red-200 rounded-xl mb-2 overflow-hidden">
      <summary className="cursor-pointer p-3 text-[12px] font-bold text-red-800 select-none flex items-center justify-between">
        <span>⚠️ Discipline · {records.length} record{records.length === 1 ? '' : 's'}</span>
        <span className="text-[10px] text-red-700">›</span>
      </summary>
      <div className="px-3 pb-3 pt-1">
        {records.length === 0 ? (
          <div className="text-[11px] text-red-700 text-center py-2">No PIPs, Write-Ups, or IAPs on record.</div>
        ) : (
          records.map(r => (
            <button
              key={r.id}
              onClick={() => onOpenDetail(r)}
              className="block w-full text-left bg-white border border-red-100 rounded-lg p-2.5 mb-2 last:mb-0 cursor-pointer font-[inherit] hover:bg-red-50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-bold text-red-900">{labelFor(r.form_type)}</div>
                  <div className="text-[10px] text-red-700 mt-0.5">{formatDate(r.date)}{r.observer_email ? ` · by ${r.observer_email.split('@')[0]}` : ''}</div>
                  {r.acknowledgment_at && <div className="text-[9px] text-emerald-700 mt-0.5">Acknowledged {new Date(r.acknowledgment_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}</div>}
                </div>
                <div className="text-red-700 text-sm font-bold">›</div>
              </div>
            </button>
          ))
        )}
      </div>
    </details>
  )
}

export default function StaffProfile() {
  const navigate = useNavigate()
  const { email: rawEmail } = useParams()
  const email = decodeURIComponent(rawEmail || '')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('snapshot')  // 'snapshot' | 'past' (PMAP YoY)
  const [assignSummary, setAssignSummary] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [todos, setTodos] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.get(`/api/staff/${encodeURIComponent(email)}/assignments`)
      .then(rows => {
        if (cancelled || !Array.isArray(rows)) return
        const done = rows.filter(r => r.progress_pct === 100).length
        setAssignSummary({ total: rows.length, done })
      }).catch(() => {})
    return () => { cancelled = true }
  }, [email])

  useEffect(() => {
    let cancelled = false
    api.get('/api/auth/status').then(r => {
      if (!cancelled) setCurrentUser(r?.user || null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const isSelf = !!(currentUser?.email && email && currentUser.email.toLowerCase() === email.toLowerCase())

  useEffect(() => {
    if (!isSelf) { setTodos(null); return }
    let cancelled = false
    api.get('/api/me/todos').then(r => {
      if (!cancelled) setTodos(r || {})
    }).catch(() => { if (!cancelled) setTodos({}) })
    return () => { cancelled = true }
  }, [isSelf])
  const [aiOpen, setAiOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function go() {
      setLoading(true)
      try {
        const d = await api.get(`/api/staff/${encodeURIComponent(email)}`)
        if (!cancelled) setData(d)
      } catch (e) {
        console.error('staff profile load failed', e)
        if (!cancelled) setData(null)
      }
      if (!cancelled) setLoading(false)
    }
    go()
    return () => { cancelled = true }
  }, [email])

  const staff = data?.staff || {}
  // Filter out drafts + dedup effectively-identical records (a pattern we see
  // with reimported Grow data — same date, same observer, same scores, new ID).
  const touchpoints = dedupTouchpoints(
    (data?.touchpoints || []).filter(t => t.status !== 'draft' && !t.is_test)
  )
  const currentSY = data?.current_school_year || '2025-2026'

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
          Observation<span className="text-fls-orange">Point</span>
        </Link>
        <div className="w-8" />
      </nav>

      <div className="bg-white px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-[14px] bg-fls-navy text-white flex items-center justify-center text-xl font-bold shrink-0">
            {initials(staff.name || email)}
          </div>
          <div className="min-w-0">
            <div className="text-xl font-extrabold tracking-tight truncate">{staff.name || email}</div>
            <div className="text-[13px] text-gray-500 mt-0.5 truncate">
              {[staff.job_title, staff.school, staff.job_function].filter(Boolean).join(' · ') || email}
            </div>
          </div>
        </div>
        <div className="mt-3.5 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setLogOpen(true)}
            className="px-3.5 py-2.5 rounded-[10px] bg-fls-navy text-white border-0 text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 shadow-md font-[inherit]"
          >
            <span style={{ color: '#fbbe82' }}>+</span> Log a touchpoint
          </button>
          <button
            onClick={() => setExportOpen(true)}
            className="px-3.5 py-2.5 rounded-[10px] bg-white text-fls-navy border-[1.5px] border-fls-navy text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 font-[inherit]"
            title="Download CSV of all touchpoints — for HR / accountability"
          >
            ↓ Export
          </button>
        </div>
      </div>

      {exportOpen && (
        <div
          onClick={() => setExportOpen(false)}
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
        >
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-sm">
            <div className="text-base font-extrabold mb-1">Export touchpoints</div>
            <div className="text-xs text-gray-500 mb-3">CSV download of {staff.name || email}'s published touchpoints. For HR records, supervisor accountability, or year-end review.</div>
            {(() => {
              const years = (data?.school_years || []).slice().sort().reverse()
              return (
                <>
                  <button
                    onClick={() => { window.location.href = `/api/staff/${encodeURIComponent(email)}/touchpoints/export.csv`; setExportOpen(false) }}
                    className="w-full px-3 py-3 rounded-[10px] bg-fls-navy text-white border-0 text-xs font-bold cursor-pointer mb-2 font-[inherit]"
                  >Download all years</button>
                  {years.map(y => (
                    <button
                      key={y}
                      onClick={() => { window.location.href = `/api/staff/${encodeURIComponent(email)}/touchpoints/export.csv?school_year=${encodeURIComponent(y)}`; setExportOpen(false) }}
                      className="w-full px-3 py-2.5 rounded-[10px] bg-gray-100 text-gray-800 border-0 text-xs font-semibold cursor-pointer mb-1.5 font-[inherit]"
                    >Download {y}</button>
                  ))}
                  <button
                    onClick={() => setExportOpen(false)}
                    className="w-full px-3 py-2 mt-2 text-xs text-gray-500 border-0 bg-transparent cursor-pointer font-[inherit]"
                  >Cancel</button>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {viewMode === 'past' && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-yellow-800">Last 3 PMAPs · trend</div>
          <button
            onClick={() => setViewMode('snapshot')}
            className="text-xs text-yellow-800 font-semibold bg-transparent border-0 cursor-pointer font-[inherit]"
          >← Back to snapshot</button>
        </div>
      )}


      <div className="px-4 pt-2 pb-6 max-w-[760px] mx-auto">
        {loading && <div className="text-center text-gray-400 text-sm py-10">Loading profile…</div>}
        {!loading && !data && <Empty msg="Could not load this staff profile. Check access or try again." />}
        {!loading && data && viewMode === 'snapshot' && isSelf && todos && (
          <YourTodos todos={todos} />
        )}
        {!loading && data && viewMode === 'snapshot' && (
          <ActionStepsSection email={email} isSelf={isSelf} navigate={navigate} />
        )}
        {!loading && data && viewMode === 'snapshot' && (
          <SnapshotView
            touchpoints={touchpoints}
            onOpenDetail={setDetail}
            staffEmail={email}
            currentSY={data.current_school_year || '2025-2026'}
            assignmentsSummary={assignSummary}
            onShowPast={() => setViewMode('past')}
          />
        )}
        {!loading && data && viewMode === 'snapshot' && (
          <DisciplineSection touchpoints={touchpoints} onOpenDetail={setDetail} />
        )}
        {!loading && data && viewMode === 'snapshot' && isSelf && (
          <Link
            to="/app/celebrate"
            className="block w-full text-center px-4 py-4 mt-6 rounded-2xl text-white text-sm font-bold no-underline shadow-md active:scale-[.98] transition-transform"
            style={{ background: 'linear-gradient(135deg,#e47727,#c2410c)' }}
          >
            🎉 Recognize a colleague
          </Link>
        )}
        {!loading && data && viewMode === 'past' && (
          <PMAPView touchpoints={touchpoints} pmap_by_year={data.pmap_by_year} school_years={data.school_years} onOpenDetail={setDetail} staffEmail={email} />
        )}
      </div>

      <BottomNav active="team" />
      <LogTouchpointModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        teacher={email}
        teacherName={staff.name}
      />
      {detail && <TouchpointDetail touchpoint={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
