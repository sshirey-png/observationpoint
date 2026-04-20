import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import AIPanel from '../components/AIPanel'
import LogTouchpointModal from '../components/LogTouchpointModal'
import { api } from '../lib/api'

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

function RecordCard({ date, meta, scores, notes }) {
  return (
    <div className="bg-white rounded-xl p-3.5 shadow-sm mb-2.5">
      <div className="flex items-center justify-between gap-2.5 mb-1">
        <div className="text-[13px] font-bold">{formatDate(date)}</div>
        {meta && <div className="text-[11px] text-gray-400">{meta}</div>}
      </div>
      {scores && Object.keys(scores).length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {Object.entries(scores).map(([code, s]) => (
            <span key={code} className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${scoreClass(s)}`}>
              {DIM_SHORT[code] || code} {s}
            </span>
          ))}
        </div>
      )}
      {notes && <div className="text-xs text-gray-600 mt-2 italic pl-2 border-l-2 border-gray-200">{notes}</div>}
    </div>
  )
}

function FundamentalsView({ touchpoints }) {
  const fund = touchpoints.filter(t => t.form_type === 'observation_fundamentals')
  if (fund.length === 0) return <Empty msg="No Fundamentals observations yet." />

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        Fundamentals Visits · {fund.length}
      </div>
      {fund.map(tp => (
        <RecordCard
          key={tp.id}
          date={tp.date}
          meta={tp.observer_email}
          scores={tp.scores}
          notes={tp.notes}
        />
      ))}
    </div>
  )
}

function ObservationsView({ touchpoints }) {
  const obs = touchpoints.filter(t => t.form_type === 'observation_teacher' || t.form_type === 'observation_prek')
  if (obs.length === 0) return <Empty msg="No observations on record." />

  const latest = obs[0]?.scores || {}

  return (
    <div>
      {Object.keys(latest).length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
            Most recent · {formatDate(obs[0].date)}
          </div>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {TEACHER_DIMS.map(code => latest[code] != null && (
              <div key={code} className="bg-white rounded-[10px] p-2 text-center shadow-sm">
                <div className="text-[9px] font-bold text-gray-400 uppercase">{DIM_SHORT[code]}</div>
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
        <RecordCard
          key={tp.id}
          date={tp.date}
          meta={tp.observer_email}
          scores={tp.scores}
          notes={tp.notes}
        />
      ))}
    </div>
  )
}

function PMAPView({ touchpoints, pmap_by_year, school_years }) {
  const pmaps = touchpoints.filter(t => t.form_type.startsWith('pmap_'))
  const years = (school_years || []).slice().sort()

  return (
    <div>
      {years.length > 0 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
            Year over year
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
                      const v = pmap_by_year?.[yr]?.[code]
                      return (
                        <td key={yr} className="py-1.5 px-1 text-center border-t border-gray-100">
                          {v != null ? (
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md text-xs font-bold ${scoreClass(v)}`}>{v}</span>
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
        PMAPs on record · {pmaps.length}
      </div>
      {pmaps.length === 0 ? (
        <Empty msg="No PMAPs on record." />
      ) : (
        pmaps.map(tp => (
          <RecordCard key={tp.id} date={tp.date} meta={tp.observer_email} scores={tp.scores} notes={tp.notes} />
        ))
      )}
    </div>
  )
}

function SimpleListView({ touchpoints, matcher, emptyMsg }) {
  const filtered = touchpoints.filter(matcher)
  if (filtered.length === 0) return <Empty msg={emptyMsg} />
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-4 mb-2">
        {filtered.length} on record
      </div>
      {filtered.map(tp => (
        <RecordCard key={tp.id} date={tp.date} meta={tp.observer_email} scores={tp.scores} notes={tp.notes} />
      ))}
    </div>
  )
}

const CATEGORIES = [
  { key: 'fundamentals', label: 'Fundamentals' },
  { key: 'observations', label: 'Observations' },
  { key: 'pmap',         label: 'PMAP' },
  { key: 'reflection',   label: 'Self-Reflection' },
  { key: 'feedback',     label: 'Quick FB' },
  { key: 'celebrate',    label: 'Celebrate' },
  { key: 'meetings',     label: 'Meetings' },
]

export default function StaffProfile() {
  const { email: rawEmail } = useParams()
  const email = decodeURIComponent(rawEmail || '')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('fundamentals')
  const [aiOpen, setAiOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

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
  const touchpoints = data?.touchpoints || []

  return (
    <div className="min-h-[100svh] bg-[#f5f7fa] pb-20">
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-4 flex items-center gap-3">
        <Link to="/" className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center no-underline">
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </Link>
        <div className="flex-1 text-center text-[16px] font-bold text-white">
          Observation<span className="text-fls-orange">Point</span>
        </div>
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
        <button
          onClick={() => setLogOpen(true)}
          className="mt-3.5 px-3.5 py-2.5 rounded-[10px] bg-fls-navy text-white border-0 text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 shadow-md font-[inherit]"
        >
          <span style={{ color: '#fbbe82' }}>+</span> Log a touchpoint
        </button>
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

      <div className="px-4 pt-2 pb-6 max-w-[760px] mx-auto">
        {loading && <div className="text-center text-gray-400 text-sm py-10">Loading profile…</div>}
        {!loading && !data && <Empty msg="Could not load this staff profile. Check access or try again." />}
        {!loading && data && (
          <>
            {category === 'fundamentals' && <FundamentalsView touchpoints={touchpoints} />}
            {category === 'observations' && <ObservationsView touchpoints={touchpoints} />}
            {category === 'pmap'         && <PMAPView touchpoints={touchpoints} pmap_by_year={data.pmap_by_year} school_years={data.school_years} />}
            {category === 'reflection'   && <SimpleListView touchpoints={touchpoints} matcher={t => t.form_type.startsWith('self_reflection_')} emptyMsg="No self-reflections on record." />}
            {category === 'feedback'     && <SimpleListView touchpoints={touchpoints} matcher={t => t.form_type === 'quick_feedback'} emptyMsg="No quick feedback on record." />}
            {category === 'celebrate'    && <SimpleListView touchpoints={touchpoints} matcher={t => t.form_type === 'celebrate' || t.form_type === 'celebration'} emptyMsg="No celebrations on record." />}
            {category === 'meetings'     && <SimpleListView touchpoints={touchpoints} matcher={t => t.form_type === 'meeting' || t.form_type === 'meeting_data'} emptyMsg="No meetings on record." />}
          </>
        )}
      </div>

      <BottomNav active="team" onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="profile" subject={staff.name || email} />
      <LogTouchpointModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        teacher={email}
        teacherName={staff.name}
      />
    </div>
  )
}
