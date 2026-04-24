import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import AIPanel from '../components/AIPanel'
import ImpersonationBanner from '../components/ImpersonationBanner'
import { api } from '../lib/api'

/**
 * School — per-school deep-dive. Port of prototypes/school-v3.html.
 * Uses /api/network?school_year=X and filters the schools_grid + fundamentals_mastery
 * to the school named in the URL.
 */

const HERO_BG = { background: 'linear-gradient(135deg, #002f60, #003b7a)', color: '#fff', borderRadius: 20, padding: 22, marginBottom: 14, boxShadow: '0 4px 14px rgba(0,47,96,.25)' }
const AST = { fontSize: '.55em', color: '#e47727', verticalAlign: 'super', marginLeft: 1, fontWeight: 700 }
const DIM_NAMES = { T1: 'On Task', T2: 'CoL', T3: 'Content', T4: 'Cog Eng', T5: 'Demo' }

function shortSchool(name) {
  return (name || '').replace(' Charter School', '').replace(' Community School', '').replace(' Academy', '')
}

function DimBar({ name, avg }) {
  const width = avg != null ? Math.min(100, (avg / 5) * 100) : 0
  const color = avg == null ? '#d1d5db' : avg >= 3.5 ? '#22c55e' : avg >= 3.0 ? '#eab308' : '#dc2626'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, marginBottom: 6 }}>
      <span style={{ width: 60, fontWeight: 700, color: '#6b7280', fontSize: 11 }}>{name}</span>
      <div style={{ flex: 1, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${width}%`, background: color, borderRadius: 4 }} />
      </div>
      <span style={{ width: 32, textAlign: 'right', fontWeight: 700, color: '#002f60' }}>{avg != null ? avg : '—'}</span>
    </div>
  )
}

function Donut({ pct, label, size = 130 }) {
  const r = (size / 2) - 7; const cx = size / 2; const c = 2 * Math.PI * r
  const dash = pct != null ? (pct / 100) * c : 0
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="14" />
      {pct != null && (
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="#e47727" strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`} transform={`rotate(-90 ${cx} ${cx})`} />
      )}
      <text x={cx} y={cx + 8} textAnchor="middle" fontSize="30" fontWeight="800" fill="#fff">{label}</text>
    </svg>
  )
}

export default function School() {
  const navigate = useNavigate()
  const { name: rawName } = useParams()
  const schoolName = decodeURIComponent(rawName || '')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState(1)
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function go() {
      setLoading(true)
      try {
        // Use current school year default for now (2026-27)
        const d = await api.get(`/api/network?school_year=2026-2027`)
        if (!cancelled) setData(d)
      } catch (e) {
        if (!cancelled) setData(null)
      }
      if (!cancelled) setLoading(false)
    }
    go()
    return () => { cancelled = true }
  }, [schoolName])

  // Find this school's row in schools_grid
  const schoolRow = (data?.schools_grid || []).find(
    (s) => s.school?.toLowerCase() === schoolName.toLowerCase()
  ) || { school: schoolName, teachers: 0, touchpoints: 0 }

  const fm = data?.fundamentals_mastery?.by_school?.[schoolName] || { mastered: 0, observed: 0 }
  const teachersCount = schoolRow.teachers || 0

  return (
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 80, fontFamily: 'Inter, sans-serif' }}>
      <ImpersonationBanner />
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-[14px] flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="Back"
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border-0 cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </button>
        <Link to="/" className="flex-1 text-center no-underline">
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>{shortSchool(schoolName)}</div>
        </Link>
        <div className="w-8" />
      </nav>

      {/* Cycle toggle */}
      <div style={{ background: '#fff', padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'center', gap: 6 }}>
        {[1, 2, 3, 4].map((n) => (
          <button key={n} onClick={() => setCycle(n)}
            style={{
              flex: 1, maxWidth: 120, padding: '8px 20px', borderRadius: 20,
              fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              border: `1.5px solid ${cycle === n ? '#002f60' : '#e5e7eb'}`,
              background: cycle === n ? '#002f60' : '#fff',
              color: cycle === n ? '#fff' : '#6b7280',
            }}
          >Cycle {n}</button>
        ))}
      </div>

      {/* Mock-data legend */}
      <div style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af', padding: '6px 12px', background: '#f5f7fa' }}>
        <span style={{ color: '#e47727', fontWeight: 700 }}>*</span> = mock data
      </div>

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {loading && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: 40 }}>Loading school…</div>}

        {!loading && data && (
          <>
            {/* Hero — Fundamentals scoped to this school */}
            <div style={HERO_BG}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'rgba(255,255,255,.7)', marginBottom: 8, textAlign: 'center' }}>
                % Mastering Fundamentals · Cycle 1
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 6 }}>
                <Donut pct={fm.observed > 0 ? Math.round(100 * fm.mastered / fm.observed) : 0} label={fm.observed > 0 ? `${Math.round(100 * fm.mastered / fm.observed)}%` : '0%'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1, color: '#fff' }}>
                    {fm.mastered}<span style={{ fontSize: 22, color: '#e47727' }}>/{teachersCount}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,.8)', marginTop: 6 }}>
                    teachers mastering · {shortSchool(schoolName)}
                  </div>
                </div>
              </div>
            </div>

            {/* Stat strip */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#002f60', lineHeight: 1 }}>{schoolRow.pmap_avg ?? '—'}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 6 }}>PMAP Avg</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>{shortSchool(schoolName)}</div>
              </div>
              <div style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#002f60', lineHeight: 1 }}>{schoolRow.touchpoints ?? 0}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 6 }}>Touchpoints</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>this cycle</div>
              </div>
              <div style={{ background: '#fff', borderRadius: 14, padding: '14px 12px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#002f60', lineHeight: 1 }}>{teachersCount}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 6 }}>Teachers</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>school-wide</div>
              </div>
            </div>

            {/* Placeholder for Needs Attention list — will fill when data available */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Needs Attention
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                Teachers not yet mastering Fundamentals will appear here once observations begin.
              </div>
            </div>

            {/* Transparency note */}
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 11, color: '#9a3412', lineHeight: 1.4 }}>
              <b style={{ color: '#e47727' }}>*</b> placeholder · fills when OP Fundamentals obs flow in for this school. Teacher count is <b>live from Postgres</b>.
            </div>
          </>
        )}

        {!loading && !data && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
            Could not load school data.
          </div>
        )}
      </div>

      <BottomNav active="network" onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="network" subject={shortSchool(schoolName)} />
    </div>
  )
}
