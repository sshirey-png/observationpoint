import { Link } from 'react-router-dom'
import Nav from '../components/Nav'

/**
 * Home — the landing page. Quick access to observe, see team, insights.
 * Mobile-first: big tap targets, minimal text.
 */
export default function Home() {
  return (
    <div>
      <Nav showBack={false} />
      <div className="p-4 space-y-3">

        {/* Primary action: observe */}
        <Link
          to="/app/observe"
          className="block bg-fls-orange text-white rounded-xl p-5 no-underline"
        >
          <div className="text-lg font-bold">Quick Observe</div>
          <div className="text-sm opacity-80 mt-1">Start a classroom observation</div>
        </Link>

        {/* Team + Network row */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/app/team"
            className="block bg-fls-navy text-white rounded-xl p-4 no-underline"
          >
            <div className="text-base font-bold">My Team</div>
            <div className="text-xs opacity-60 mt-1">Direct reports</div>
          </Link>
          <Link
            to="/app/network"
            className="block bg-white border border-gray-200 rounded-xl p-4 no-underline text-gray-900"
          >
            <div className="text-base font-bold">Network</div>
            <div className="text-xs text-gray-400 mt-1">School data</div>
          </Link>
        </div>

        {/* TouchPoint types */}
        <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mt-6 mb-2">
          TouchPoints
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { to: '/app/observe', label: 'Observation', emoji: '👁' },
            { to: '/app/observe', label: 'Fundamentals', emoji: '⏱' },
            { to: '/app/observe', label: 'Quick Feedback', emoji: '💬' },
            { to: '/app/observe', label: 'Celebrate', emoji: '🎉' },
            { to: '/app/observe', label: 'Meeting', emoji: '🤝' },
            { to: '/app/observe', label: 'PMAP', emoji: '📋' },
          ].map(item => (
            <Link
              key={item.label}
              to={item.to}
              className="bg-white border border-gray-200 rounded-xl p-3 text-center no-underline"
            >
              <div className="text-2xl">{item.emoji}</div>
              <div className="text-[11px] font-semibold text-gray-700 mt-1">{item.label}</div>
            </Link>
          ))}
        </div>

        {/* AI Insights teaser */}
        <Link
          to="/app/insights"
          className="block bg-gray-50 border border-gray-200 rounded-xl p-4 mt-4 no-underline"
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
