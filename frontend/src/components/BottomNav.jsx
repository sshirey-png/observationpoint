import { Link } from 'react-router-dom'

/**
 * BottomNav — persistent 4-button global navigation.
 * Same four buttons on every non-home page: Team · Touchpoint · Network · Ask.
 * Ask doesn't navigate — it triggers the inline AI panel via onAskClick.
 *
 * Usage:
 *   <BottomNav active="team" onAskClick={() => setAiOpen(true)} />
 *
 * Every page that shows this nav should add bottom padding (pb-20 or more)
 * so content isn't hidden behind the nav.
 */
export default function BottomNav({ active, onAskClick, aiOpen = false }) {
  const items = [
    { key: 'team',       to: '/app/team',       icon: '\u{1F465}', label: 'Team' },
    { key: 'touchpoint', to: '/app/touchpoint', icon: '+',         label: 'Touchpoint' },
    { key: 'network',    to: '/app/network',    icon: '\u{1F4CA}', label: 'Network' },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex px-2 pt-2 pb-2.5 gap-0.5 shadow-[0_-2px_10px_rgba(0,0,0,.05)]">
      {items.map(it => (
        <Link
          key={it.key}
          to={it.to}
          className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl no-underline ${
            active === it.key ? 'text-fls-navy' : 'text-gray-400'
          }`}
        >
          <div className="w-6 h-6 flex items-center justify-center text-base font-extrabold">{it.icon}</div>
          <div className="text-[10px] font-bold tracking-tight">{it.label}</div>
        </Link>
      ))}
      <button
        onClick={onAskClick}
        className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl font-[inherit] border-0 bg-transparent cursor-pointer ${
          aiOpen ? 'text-fls-orange' : 'text-gray-400'
        }`}
      >
        <div className={`w-6 h-6 flex items-center justify-center text-base font-extrabold ${
          aiOpen ? 'text-fls-orange' : 'text-[#fbbe82]'
        }`}>✦</div>
        <div className="text-[10px] font-bold tracking-tight">Ask</div>
      </button>
    </nav>
  )
}
