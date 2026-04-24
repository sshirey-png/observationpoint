import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import AIPanel from '../components/AIPanel'
import ImpersonationBanner from '../components/ImpersonationBanner'
import { api } from '../lib/api'

/**
 * CelebrationDrilldown — /app/network/celebration
 * Port of prototypes/celebration-drilldown-populated.html into React shell
 * with real data from /api/network. Empty-state honest.
 */

const HERO_BG = { background: 'linear-gradient(135deg, #002f60, #003b7a)' }

function shortSchool(name) {
  return (name || '').replace(' Charter School', '').replace(' Community School', '').replace(' Academy', '')
}

export default function CelebrationDrilldown() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('not_yet')
  const [schoolFilter, setSchoolFilter] = useState('all')
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function go() {
      setLoading(true)
      try {
        const d = await api.get(`/api/network?school_year=2026-2027`)
        if (!cancelled) setData(d)
      } catch (e) {
        if (!cancelled) setData(null)
      }
      if (!cancelled) setLoading(false)
    }
    go()
    return () => { cancelled = true }
  }, [])

  const cel = data?.celebration || {}
  const celCount = cel.cel_count || 0
  const staffCelebrated = cel.staff_celebrated || 0
  const staffTotal = cel.staff_total || 0
  const notYet = staffTotal - staffCelebrated
  const pct = cel.staff_celebrated_pct || 0

  const SCHOOLS = [
    'Langston Hughes Academy',
    'Phillis Wheatley Community School',
    'Arthur Ashe Charter School',
    'Samuel J Green Charter School',
  ]

  return (
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 80, fontFamily: 'Inter, sans-serif' }}>
      <ImpersonationBanner />

      {/* Top nav — consistent with rest of React app */}
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-[14px] flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app/network'))}
          aria-label="Back"
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border-0 cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </button>
        <Link to="/" className="flex-1 text-center no-underline">
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>Celebration Coverage · 2026-27</div>
        </Link>
        <div className="w-8" />
      </nav>

      {/* Hero */}
      <div style={{ ...HERO_BG, padding: '16px 16px 20px', color: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }}>
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="9" />
            {pct > 0 && (
              <circle cx="40" cy="40" r="34" fill="none" stroke="#e47727" strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 214} 214`}
                transform="rotate(-90 40 40)" />
            )}
            <text x="40" y="46" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff">{pct}%</text>
          </svg>
          <div>
            <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1, color: '#fff' }}>
              {staffCelebrated}<span style={{ color: '#e47727', fontSize: 22 }}>/{staffTotal}</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.8)', marginTop: 4 }}>
              staff celebrated · {notYet} not yet
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.15)', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{celCount}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 4 }}>Celebrations total</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {staffTotal ? (celCount / staffTotal).toFixed(1) : '0.0'}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 4 }}>Avg per staff</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {cel.by_month ? Object.values(cel.by_month).reduce((a, b) => a + b, 0) : 0}
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.65)', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 4 }}>This year</div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '10px 12px', position: 'sticky', top: 62, zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setTab('not_yet')}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 10,
                border: `1.5px solid ${tab === 'not_yet' ? '#fca5a5' : '#e5e7eb'}`,
                background: tab === 'not_yet' ? '#fee2e2' : '#fff',
                color: tab === 'not_yet' ? '#991b1b' : '#6b7280',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
              }}>
              <span style={{ display: 'block', fontSize: 18, fontWeight: 800, lineHeight: 1, marginBottom: 2 }}>{notYet}</span>
              Not Yet
            </button>
            <button onClick={() => setTab('celebrated')}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 10,
                border: `1.5px solid ${tab === 'celebrated' ? '#86efac' : '#e5e7eb'}`,
                background: tab === 'celebrated' ? '#dcfce7' : '#fff',
                color: tab === 'celebrated' ? '#166534' : '#6b7280',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
              }}>
              <span style={{ display: 'block', fontSize: 18, fontWeight: 800, lineHeight: 1, marginBottom: 2 }}>{staffCelebrated}</span>
              Celebrated
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {[['all', 'All schools'], ...SCHOOLS.map((s) => [s, shortSchool(s)])].map(([key, label]) => {
              const on = schoolFilter === key
              return (
                <button key={key} onClick={() => setSchoolFilter(key)}
                  style={{
                    padding: '6px 12px', borderRadius: 14,
                    border: `1px solid ${on ? '#002f60' : '#e5e7eb'}`,
                    background: on ? '#002f60' : '#fff',
                    color: on ? '#fff' : '#6b7280',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit',
                  }}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 12px 60px', maxWidth: 720, margin: '0 auto' }}>
        {loading && <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14, padding: 40 }}>Loading celebrations…</div>}

        {!loading && tab === 'not_yet' && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.08em', padding: '10px 4px 6px' }}>
              Not yet celebrated · {notYet} staff
            </div>
            {notYet === 0 ? (
              <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#002f60' }}>Everyone's been celebrated!</div>
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                  {notYet} staff haven't been celebrated yet this year.
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
                  Full list loads when celebration activity picks up. For now — go start recognizing.
                </div>
                <button
                  onClick={() => navigate('/app/celebrate')}
                  style={{ marginTop: 16, background: '#e47727', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Celebrate someone →
                </button>
              </div>
            )}
          </>
        )}

        {!loading && tab === 'celebrated' && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.08em', padding: '10px 4px 6px' }}>
              Celebrated this year · {staffCelebrated} staff
            </div>
            {staffCelebrated === 0 ? (
              <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🌱</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#002f60', marginBottom: 4 }}>No celebrations yet</div>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 16 }}>
                  Be the first. One specific, thoughtful celebration goes a long way.
                </div>
                <button
                  onClick={() => navigate('/app/celebrate')}
                  style={{ background: '#e47727', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Celebrate someone →
                </button>
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                List of {staffCelebrated} celebrated staff would render here.
              </div>
            )}
          </>
        )}
      </div>

      <BottomNav active="network" onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="network" />
    </div>
  )
}
