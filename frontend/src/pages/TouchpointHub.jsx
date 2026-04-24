import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import AIPanel from '../components/AIPanel'
import ImpersonationBanner from '../components/ImpersonationBanner'
import GlobalSearch from '../components/GlobalSearch'
import { api } from '../lib/api'

const FORM_LABELS = {
  observation_teacher: { label: 'Observation', color: '#2563eb', bg: '#dbeafe', route: '/app/observe' },
  observation_prek: { label: 'PreK Obs', color: '#db2777', bg: '#fce7f3', route: '/app/observe' },
  observation_fundamentals: { label: 'Fundamentals', color: '#b45309', bg: '#fef3c7', route: '/app/fundamentals' },
  quick_feedback: { label: 'Quick FB', color: '#b45309', bg: '#fef3c7', route: '/app/feedback' },
  celebrate: { label: 'Celebrate', color: '#059669', bg: '#dcfce7', route: '/app/celebrate' },
  'meeting_data_meeting_(relay)': { label: 'Data Mtg', color: '#16a34a', bg: '#f0fdf4', route: '/app/meeting' },
  meeting_quick_meeting: { label: 'Meeting', color: '#16a34a', bg: '#f0fdf4', route: '/app/meeting' },
  pmap_teacher: { label: 'PMAP', color: '#059669', bg: '#dcfce7', route: '/app/pmap' },
  pmap_leader: { label: 'PMAP', color: '#059669', bg: '#dcfce7', route: '/app/pmap' },
  pmap_prek: { label: 'PMAP', color: '#059669', bg: '#dcfce7', route: '/app/pmap' },
  pmap_network: { label: 'PMAP', color: '#059669', bg: '#dcfce7', route: '/app/pmap' },
  pmap_support: { label: 'PMAP', color: '#059669', bg: '#dcfce7', route: '/app/pmap' },
  self_reflection_teacher: { label: 'Self-Refl', color: '#7c3aed', bg: '#ede9fe', route: '/app/self-reflection' },
  self_reflection_leader: { label: 'Self-Refl', color: '#7c3aed', bg: '#ede9fe', route: '/app/self-reflection' },
  solicited_feedback: { label: 'Solicited', color: '#2563eb', bg: '#dbeafe', route: '/app/solicit' },
  performance_improvement_plan: { label: 'PIP', color: '#dc2626', bg: '#fee2e2', route: '/app/pip' },
  iap: { label: 'PIP', color: '#dc2626', bg: '#fee2e2', route: '/app/pip' },
  write_up: { label: 'Write-Up', color: '#dc2626', bg: '#fee2e2', route: '/app/write-up' },
}

function initials(name) {
  if (!name) return '??'
  const p = name.split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] || '') + (p[p.length - 1]?.[0] || '')).toUpperCase() || name.slice(0, 2).toUpperCase()
}

function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * TouchpointHub — the logging hub at /app/touchpoint.
 * 7 TouchPoint cards visible + collapsed Evaluations / Self-Reflections /
 * Discipline sections. Mirrors prototypes/touchpoint.html.
 */

function Card({ to, icon, iconBg, title, sub }) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-xl shadow-sm p-4 no-underline text-inherit border-2 border-transparent active:scale-[.97] active:border-fls-orange transition-all"
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 text-lg"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="text-[13px] font-semibold leading-tight">{title}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
    </Link>
  )
}

function Section({ label, count, children, open: initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 py-2 mt-3 bg-transparent border-0 cursor-pointer font-[inherit]"
      >
        <div
          className={`w-5 h-5 rounded-md text-[10px] font-extrabold flex items-center justify-center transition-all ${
            open ? 'bg-orange-50 text-fls-orange rotate-90' : 'bg-gray-200 text-gray-500'
          }`}
        >›</div>
        <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 flex-1 text-left">{label}</div>
        <div className="text-[10px] text-gray-400 font-bold px-2 py-0.5 rounded-xl bg-gray-50">{count}</div>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function RecentItem({ to, initials, name, meta, badge, badgeBg, badgeColor }) {
  return (
    <Link to={to} className="flex items-center gap-3 bg-white rounded-xl px-3.5 py-3 shadow-sm mb-2 no-underline text-inherit">
      <div className="w-9 h-9 rounded-lg bg-fls-navy text-white flex items-center justify-center text-[13px] font-bold shrink-0">{initials}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold">{name}</div>
        <div className="text-[11px] text-gray-400">{meta}</div>
      </div>
      <div className="text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0" style={{ background: badgeBg, color: badgeColor }}>{badge}</div>
    </Link>
  )
}

export default function TouchpointHub() {
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)
  const [recent, setRecent] = useState([])
  const [canFileHrDoc, setCanFileHrDoc] = useState(false)

  useEffect(() => {
    api.get('/api/my-recent-touchpoints?limit=5')
      .then(r => setRecent(Array.isArray(r) ? r : []))
      .catch(() => setRecent([]))
    api.get('/api/auth/status')
      .then(r => setCanFileHrDoc(!!r?.user?.can_file_hr_doc))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-[100svh] bg-[#f5f7fa] pb-20">
      <ImpersonationBanner />
      {/* Top nav — back arrow (prev page), tap logo for home */}
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

      <div className="px-4 pb-4 max-w-[600px] mx-auto">
        <div className="text-[22px] font-extrabold tracking-tight mt-4 mb-1">Log a Touchpoint</div>
        <div className="text-sm text-gray-500 mb-5">Pick a form · you'll select the teacher on the next screen</div>

        {/* TouchPoints — 7 cards */}
        <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mt-5 mb-2.5">TouchPoints</div>
        <div className="grid grid-cols-2 gap-2.5">
          <Card to="/app/observe" icon="👁" iconBg="#dbeafe" title="Observation" sub="Classroom visit · auto PreK" />
          <Card to="/app/fundamentals" icon="⏱" iconBg="#fef3c7" title="Fundamentals" sub="5-min On Task %" />
          <Card to="/app/meeting" icon="💬" iconBg="#f0fdf4" title="Data Meeting" sub="Relay DDI" />
          <Card to="/app/feedback" icon="⚡" iconBg="#fef3c7" title="Quick Feedback" sub="Informal note" />
          <Card to="/app/celebrate" icon="🎉" iconBg="#dcfce7" title="Celebrate / Praise" sub="Recognize a win" />
          <Card to="/app/solicit" icon="🙌" iconBg="#dbeafe" title="Solicited Feedback" sub="Ask for input" />
        </div>

        {/* Evaluations — role-aware auto-select */}
        <Section label="Evaluations" count="auto · 5 variants">
          <div className="grid grid-cols-2 gap-2.5">
            <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Teacher" sub="On / CoL / Content / Cog Eng / Demo + Goals" />
            <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: PreK" sub="3 CLASS Cycles" />
            <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Leader" sub="L1-L5 Competencies" />
            <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Support" sub="Non-Instructional" />
            <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Network" sub="Network Staff" />
          </div>
        </Section>

        <Section label="Self-Reflections" count="auto · 5 variants">
          <div className="grid grid-cols-2 gap-2.5">
            <Card to="/app/self-reflection" icon="💜" iconBg="#ede9fe" title="SR: Teacher" sub="Teacher self-score" />
            <Card to="/app/self-reflection" icon="💜" iconBg="#ede9fe" title="SR: PreK" sub="CLASS self-score" />
            <Card to="/app/self-reflection" icon="💜" iconBg="#ede9fe" title="SR: Leader" sub="L1-L5 self-score" />
            <Card to="/app/self-reflection" icon="💜" iconBg="#ede9fe" title="SR: Network" sub="Leadership + Commitments" />
            <Card to="/app/self-reflection" icon="💜" iconBg="#ede9fe" title="SR: Support" sub="Commitments + Career" />
          </div>
        </Section>

        {canFileHrDoc && (
          <Section label="Discipline" count="2">
            <div className="grid grid-cols-2 gap-2.5">
              <Card to="/app/pip" icon="⚠️" iconBg="#fee2e2" title="PIP" sub="Performance Improvement Plan · formerly IAP" />
              <Card to="/app/write-up" icon="📝" iconBg="#fee2e2" title="Write-Up" sub="Employee Discipline" />
            </div>
          </Section>
        )}

        {/* Recent TouchPoints removed per Scott — keep TouchpointHub focused on the form picker. */}
      </div>

      <BottomNav active="touchpoint" onAskClick={() => setAiOpen(true)} aiOpen={aiOpen} />
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="touchpoint" />
    </div>
  )
}
