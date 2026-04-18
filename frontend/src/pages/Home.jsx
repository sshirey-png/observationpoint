import { Link } from 'react-router-dom'

/**
 * Home — faithful port of prototypes/index.html.
 * Same layout, same sections, same card design.
 */

function Card({ to, icon, iconBg, title, sub, style, className }) {
  return (
    <Link
      to={to}
      className={`block bg-white rounded-xl shadow-sm p-4 no-underline text-inherit border-2 border-transparent active:scale-[.97] active:border-fls-orange transition-all ${className || ''}`}
      style={style}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 text-lg" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="text-[13px] font-semibold leading-tight">{title}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
    </Link>
  )
}

function WideCard({ to, icon, iconBg, title, sub, bg, borderColor }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl p-4 no-underline text-white border-2 active:scale-[.97] transition-all"
      style={{ background: bg, borderColor }}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xl shrink-0" style={{ background: iconBg }}>
        {icon}
      </div>
      <div>
        <div className="text-[15px] font-bold">{title}</div>
        <div className="text-xs opacity-60">{sub}</div>
      </div>
    </Link>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mt-5 mb-2.5">
      {children}
    </div>
  )
}

export default function Home() {
  return (
    <div>
      {/* Nav — centered, with subtitle */}
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-4 text-center">
        <div className="text-lg font-extrabold text-white">
          Observation<span className="text-fls-orange">Point</span>
        </div>
        <div className="text-xs text-white/60 mt-0.5">FirstLine Schools</div>
      </nav>

      <div className="px-4 pb-10 max-w-[600px] mx-auto">
        {/* Greeting */}
        <div className="text-[22px] font-extrabold tracking-tight mt-4 mb-1">Good morning</div>
        <div className="text-sm text-gray-500 mb-5">What would you like to do?</div>

        {/* My Team + Network */}
        <WideCard to="/app/team" icon="👥" iconBg="rgba(255,255,255,.15)"
          title="My Team" sub="View your team" bg="#002f60" borderColor="#002f60" />
        <div className="h-2.5" />
        <WideCard to="/app/network" icon="📊" iconBg="rgba(255,255,255,.15)"
          title="Network Dashboard" sub="School comparison & trends" bg="#e47727" borderColor="#e47727" />

        {/* TouchPoints */}
        <SectionLabel>TouchPoints</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <Card to="/app/observe" icon="👁" iconBg="#dbeafe" title="Observation" sub="Classroom visit" />
          <Card to="/app/observe" icon="🏫" iconBg="#fce7f3" title="PreK Observation" sub="CLASS PK1-PK10" />
          <Card to="/app/fundamentals" icon="⏱" iconBg="#fef3c7" title="Fundamentals" sub="5-min On Task %" />
          <Card to="/app/meeting" icon="💬" iconBg="#f0fdf4" title="Data Meeting" sub="Relay DDI" />
          <Card to="/app/feedback" icon="⚡" iconBg="#fef3c7" title="Quick Feedback" sub="Informal note" />
          <Card to="/app/celebrate" icon="🎉" iconBg="#dcfce7" title="Celebrate / Praise" sub="Recognize a win" />
          <Card to="/app/solicit" icon="🙌" iconBg="#dbeafe" title="Solicited Feedback" sub="Ask for input" />
        </div>

        {/* Evaluations */}
        <SectionLabel>Evaluations</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Teacher" sub="T1-T5 + Goals" />
          <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: PreK" sub="3 CLASS Cycles" />
          <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Leader" sub="L1-L5 Competencies" />
          <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Support" sub="Non-Instructional" />
          <Card to="/app/pmap" icon="✅" iconBg="#dcfce7" title="PMAP: Network" sub="Network Staff" />
        </div>

        {/* Self-Reflections */}
        <SectionLabel>Self-Reflections (Teacher View)</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <Card to="/app/pmap" icon="💜" iconBg="#ede9fe" title="SR: Teacher" sub="T1-T5 Self-Score" />
          <Card to="/app/pmap" icon="💜" iconBg="#ede9fe" title="SR: PreK" sub="CLASS Self-Score" />
          <Card to="/app/pmap" icon="💜" iconBg="#ede9fe" title="SR: Leader" sub="L1-L5 Self-Score" />
          <Card to="/app/pmap" icon="💜" iconBg="#ede9fe" title="SR: Network" sub="Leadership + Commitments" />
          <Card to="/app/pmap" icon="💜" iconBg="#ede9fe" title="SR: Support" sub="Commitments + Career" />
        </div>

        {/* Discipline */}
        <SectionLabel>Discipline</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <Card to="/app/pmap" icon="⚠️" iconBg="#fee2e2" title="IAP" sub="Improvement Plan" />
          <Card to="/app/pmap" icon="📝" iconBg="#fee2e2" title="Write-Up" sub="Employee Discipline" />
        </div>

        {/* AI Insights */}
        <SectionLabel>Insights</SectionLabel>
        <Link
          to="/app/insights"
          className="block bg-gray-50 border border-gray-200 rounded-xl p-4 no-underline"
        >
          <div className="text-sm font-bold text-gray-900">Ask ObservationPoint</div>
          <div className="text-xs text-gray-400 mt-1">
            "Which teachers improved most on T4 this year?"
          </div>
        </Link>
      </div>
    </div>
  )
}
