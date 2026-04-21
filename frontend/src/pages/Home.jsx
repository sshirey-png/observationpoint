import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import AIPanel from '../components/AIPanel'
import ImpersonationBanner from '../components/ImpersonationBanner'
import ImpersonationPicker from '../components/ImpersonationPicker'
import GlobalSearch from '../components/GlobalSearch'
import { useImpersonation } from '../lib/useImpersonation'
import { api } from '../lib/api'

/**
 * Home — minimal 4-button landing.
 * Team · Touchpoint · Network · Ask. Nothing else on this screen.
 * Ask opens the inline AI panel (same panel used across every page).
 */

function BigButton({ to, onClick, icon, title, sub, gradient, iconBg, iconColor }) {
  const inner = (
    <>
      <div
        className="w-12 h-12 rounded-[14px] flex items-center justify-center text-2xl font-extrabold"
        style={{ background: iconBg, color: iconColor || '#fff' }}
      >
        {icon}
      </div>
      <div className="mt-auto">
        <div className="text-[18px] font-extrabold tracking-tight text-white">{title}</div>
        <div className="text-[11px] text-white/75 font-medium">{sub}</div>
      </div>
    </>
  )

  const className =
    'rounded-[20px] p-5 no-underline shadow-[0_4px_16px_rgba(0,47,96,.12)] active:scale-[.97] transition-all flex flex-col justify-between min-h-[150px] relative overflow-hidden'

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={className + ' border-0 text-left w-full cursor-pointer font-[inherit]'}
        style={{ background: gradient }}
      >
        {inner}
      </button>
    )
  }
  return (
    <Link to={to} className={className} style={{ background: gradient }}>
      {inner}
    </Link>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Home() {
  const [aiOpen, setAiOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [teamCount, setTeamCount] = useState(null)
  const { isAdmin } = useImpersonation()

  useEffect(() => {
    api.get('/api/auth/status').then(r => {
      const u = r?.user
      if (u?.name) setFirstName(u.name.split(' ')[0])
      else if (u?.email) setFirstName(u.email.split('@')[0].split('.')[0].replace(/^\w/, c => c.toUpperCase()))
    }).catch(() => {})
    api.get('/api/my-team?view=direct').then(r => {
      const count = Array.isArray(r) ? r.length : (r?.staff?.length || 0)
      setTeamCount(count)
    }).catch(() => {})
  }, [])

  return (
    <div className="min-h-[100svh] bg-[#f5f7fa]">
      <ImpersonationBanner />
      <nav className="bg-fls-navy px-4 py-4 text-center">
        <div className="text-lg font-extrabold text-white">
          Observation<span className="text-fls-orange">Point</span>
        </div>
        <div className="text-xs text-white/60 mt-0.5">FirstLine Schools</div>
      </nav>

      <div className="px-4 pt-6 pb-8 max-w-[540px] mx-auto flex flex-col" style={{ minHeight: 'calc(100svh - 70px)' }}>
        <div className="text-[26px] font-extrabold tracking-tight mb-1">
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </div>
        <div className="text-sm text-gray-500 mb-7">What would you like to do?</div>

        <div className="grid grid-cols-2 gap-3 flex-1 content-stretch">
          <BigButton
            to="/app/team"
            icon="👥"
            title="My Team"
            sub={teamCount == null ? 'Your direct reports' : `${teamCount} ${teamCount === 1 ? 'person' : 'people'} you supervise`}
            gradient="linear-gradient(135deg,#002f60 0%,#1e40af 100%)"
            iconBg="rgba(255,255,255,.15)"
          />
          <BigButton
            to="/app/touchpoint"
            icon="+"
            title="Touchpoint"
            sub="Observe · Feedback · Meeting · more"
            gradient="linear-gradient(135deg,#e47727 0%,#c2410c 100%)"
            iconBg="rgba(255,255,255,.15)"
          />
          <BigButton
            to="/app/network"
            icon="📊"
            title="Network"
            sub="Across FirstLine"
            gradient="linear-gradient(135deg,#059669 0%,#10b981 100%)"
            iconBg="rgba(255,255,255,.15)"
          />
          <BigButton
            onClick={() => setAiOpen(true)}
            icon="✦"
            title="Ask"
            sub="AI insights · scoped to you"
            gradient="linear-gradient(135deg,#1e293b 0%,#334155 100%)"
            iconBg="rgba(251,190,130,.22)"
            iconColor="#fbbe82"
          />
        </div>

        <div className="text-center text-[11px] text-gray-400 font-semibold mt-5">
          ObservationPoint · designed with FirstLine Schools
        </div>
        <div className="text-center text-[11px] mt-2 flex gap-4 justify-center">
          {isAdmin && (
            <>
              <button
                onClick={() => setAdminOpen(true)}
                className="text-gray-400 hover:text-fls-orange bg-transparent border-0 cursor-pointer font-[inherit] p-0 text-[11px]"
              >Admin · View as user</button>
              <span className="text-gray-300">·</span>
            </>
          )}
          <a href="/logout" className="text-gray-400 hover:text-fls-orange no-underline">Sign out</a>
        </div>
      </div>

      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} context="home" />
      <ImpersonationPicker open={adminOpen} onClose={() => setAdminOpen(false)} />
    </div>
  )
}
