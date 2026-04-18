import { useNavigate } from 'react-router-dom'

/**
 * Nav — the navy bar at the top of every page.
 * One component, used everywhere. Change it here, updates all pages.
 */
export default function Nav({ title, showBack = true }) {
  const navigate = useNavigate()

  return (
    <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-3.5 flex items-center gap-3">
      {showBack && (
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"
        >
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </button>
      )}
      <div className="text-[15px] font-bold text-white flex-1">
        {title || <>Observation<span className="text-fls-orange">Point</span></>}
      </div>
    </nav>
  )
}
