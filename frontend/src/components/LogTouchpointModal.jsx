import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * LogTouchpointModal — slide-up modal for logging a touchpoint about a teacher.
 * Teacher is pre-filled via ?teacher= query param on the target form.
 *
 * Six primary touchpoint tiles + collapsed Evaluations (auto-routes PMAP by
 * role) + collapsed Discipline. Per the rule: AI is NOT a touchpoint.
 */

function Tile({ to, icon, iconBg, label }) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-[10px] p-2.5 text-center no-underline text-inherit shadow-sm active:scale-[.96] active:border-fls-orange border border-transparent transition-all"
    >
      <div
        className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-[17px] mx-auto mb-1.5"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      <div className="text-[11px] font-semibold text-gray-700">{label}</div>
    </Link>
  )
}

function Section({ label, count, children, startOpen = false }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <details open={open} onToggle={e => setOpen(e.target.open)} className="mt-3">
      <summary className="list-none cursor-pointer flex items-center gap-2.5 py-2">
        <div
          className={`w-5 h-5 rounded-md text-[10px] font-extrabold flex items-center justify-center transition-transform ${
            open ? 'bg-orange-50 text-fls-orange rotate-90' : 'bg-gray-200 text-gray-500'
          }`}
        >›</div>
        <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 flex-1">{label}</div>
        <div className="text-[10px] text-gray-400 font-bold px-2 py-0.5 rounded-xl bg-gray-50">{count}</div>
      </summary>
      <div className="mt-2.5">{children}</div>
    </details>
  )
}

export default function LogTouchpointModal({ open, onClose, teacher, teacherName }) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const q = teacher ? `?teacher=${encodeURIComponent(teacher)}` : ''

  return (
    <>
      <div
        className="fixed inset-0 bg-black/45 z-[900]"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] max-h-[85vh] overflow-y-auto shadow-[0_-10px_32px_rgba(0,0,0,.22)] animate-slide-up">
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5" />

        <div className="px-4 pt-3.5 pb-3 flex items-center justify-between border-b border-gray-100">
          <div className="text-sm font-extrabold tracking-tight">
            Log a touchpoint {teacherName && <>· <span className="text-fls-orange">{teacherName}</span></>}
          </div>
          <button
            onClick={onClose}
            className="w-[30px] h-[30px] rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center text-lg border-0 cursor-pointer"
          >×</button>
        </div>

        <div className="px-4 pt-3.5 pb-8">
          <div className="text-[11px] font-bold uppercase tracking-[.06em] text-gray-400 mt-1 mb-2.5">Touchpoints</div>
          <div className="grid grid-cols-4 gap-2">
            <Tile to={`/app/observe${q}`} icon="👁" iconBg="#dbeafe" label="Observation" />
            <Tile to={`/app/fundamentals${q}`} icon="⏱" iconBg="#fef3c7" label="Fundamentals" />
            <Tile to={`/app/meeting${q}`} icon="💬" iconBg="#f0fdf4" label="Data Meeting" />
            <Tile to={`/app/feedback${q}`} icon="⚡" iconBg="#fef3c7" label="Quick FB" />
            <Tile to={`/app/celebrate${q}`} icon="🎉" iconBg="#dcfce7" label="Celebrate" />
            <Tile to={`/app/solicit${q}`} icon="🙌" iconBg="#dbeafe" label="Solicit FB" />
          </div>

          <Section label="Evaluations" count="auto · Teacher">
            <div className="grid grid-cols-4 gap-2">
              <Tile to={`/app/pmap${q}`} icon="✅" iconBg="#dcfce7" label="PMAP" />
            </div>
          </Section>

          <Section label="Discipline" count="2">
            <div className="grid grid-cols-4 gap-2">
              <Tile to={`/app/pmap${q}`} icon="⚠️" iconBg="#fee2e2" label="IAP" />
              <Tile to={`/app/pmap${q}`} icon="📝" iconBg="#fee2e2" label="Write-Up" />
            </div>
          </Section>
        </div>
      </div>
    </>
  )
}
