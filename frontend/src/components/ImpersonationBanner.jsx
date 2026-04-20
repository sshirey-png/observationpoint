import { useImpersonation } from '../lib/useImpersonation'

/**
 * ImpersonationBanner — orange strip at the top of every page when an
 * admin is "viewing as" another user. Tap Exit to return to self.
 * Session-backed; Exit calls /api/admin/stop-impersonating and reloads.
 */
export default function ImpersonationBanner() {
  const { impersonating, stop } = useImpersonation()
  if (!impersonating) return null
  return (
    <div className="sticky top-0 z-[60] bg-fls-orange text-white px-3 py-2 flex items-center gap-2.5 text-xs font-semibold shadow-md">
      <div className="text-base">👁</div>
      <div className="flex-1 truncate">
        Viewing as <b className="font-extrabold">{impersonating.name}</b>
        <span className="opacity-80 ml-1.5 font-normal">· read-only</span>
      </div>
      <button
        onClick={stop}
        className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-md font-bold border-0 text-white cursor-pointer font-[inherit] text-xs"
      >Exit</button>
    </div>
  )
}
