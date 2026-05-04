import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

/**
 * BottomNav — global navigation.
 * Supervisors/admins: Home · Team · Touchpoint · Network · Self.
 * Non-supervisors: Home · Touchpoint · Network (Team + Self hidden).
 */
export default function BottomNav({ active }) {
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.get('/api/auth/status').then(r => setUser(r?.user || null)).catch(() => {})
  }, [])

  const isSupervisorOrAdmin = !!(user && (user.is_admin || user.is_supervisor))

  const items = isSupervisorOrAdmin
    ? [
        { key: 'home',       to: '/',               icon: '🏠', label: 'Home' },
        { key: 'team',       to: '/app/team',       icon: '👥', label: 'Team' },
        { key: 'touchpoint', to: '/app/touchpoint', icon: '+',  label: 'Touchpoint' },
        { key: 'network',    to: '/app/network',    icon: '📊', label: 'Network' },
        { key: 'self',       to: '/app/me',         icon: '👤', label: 'Self' },
      ]
    : [
        { key: 'home',       to: '/',               icon: '🏠', label: 'Home' },
        { key: 'touchpoint', to: '/app/touchpoint', icon: '+',  label: 'Touchpoint' },
        { key: 'network',    to: '/app/network',    icon: '📊', label: 'Network' },
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
    </nav>
  )
}
