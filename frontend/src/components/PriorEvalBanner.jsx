import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import TouchpointDetail from './TouchpointDetail'

/**
 * PriorEvalBanner — review-prior-context prompt above the form body.
 *
 * Renders two clickable cards once a subject is selected: their most recent
 * PMAP and their most recent Self-Reflection. Tap either → opens the live
 * TouchpointDetail modal so the user can read the prior eval before
 * completing the new form.
 *
 * Hidden when the subject has no published PMAP or SR yet.
 *
 * Usage on PMAP.jsx + SelfReflection.jsx — drop it after SubjectBlock and
 * inside the {teacher && (...)} branch.
 */
const FORM_LABELS = {
  pmap_teacher: 'PMAP — Teacher',
  pmap_leader: 'PMAP — Leader',
  pmap_prek: 'PMAP — PreK',
  pmap_support: 'PMAP — Support',
  pmap_network: 'PMAP — Network',
  self_reflection_teacher: 'Self-Reflection — Teacher',
  self_reflection_leader: 'Self-Reflection — Leader',
  self_reflection_prek: 'Self-Reflection — PreK',
  self_reflection_support: 'Self-Reflection — Support',
  self_reflection_network: 'Self-Reflection — Network',
}

function prettyDate(s) {
  if (!s) return ''
  try {
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return s }
}

export default function PriorEvalBanner({ teacherEmail, teacherName }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)  // touchpoint object passed to modal

  useEffect(() => {
    if (!teacherEmail) return
    let alive = true
    api.get(`/api/staff/${encodeURIComponent(teacherEmail)}/last-evaluation`)
       .then(d => { if (alive && !d?.authorized && d?.email) setData(d) })
       .catch(() => { /* silent — banner just won't render */ })
    return () => { alive = false }
  }, [teacherEmail])

  if (!data || (!data.pmap && !data.sr)) return null

  const Card = ({ kind, rec }) => {
    if (!rec) return (
      <div className="flex-1 border border-dashed border-gray-200 rounded-lg p-2.5 text-xs text-gray-400 italic min-w-[180px]">
        No previous {kind === 'pmap' ? 'PMAP' : 'Self-Reflection'} on file
      </div>
    )
    const label = FORM_LABELS[rec.form_type] || rec.form_type
    return (
      <button
        onClick={() => setOpen({
          id: rec.id,
          form_type: rec.form_type,
          school_year: rec.school_year,
          date: rec.date,
          teacher_email: teacherEmail,
          teacher_name: teacherName || '',
          observer_email: rec.observer_email,
          observer_name: rec.observer_name,
        })}
        className="flex-1 text-left border border-gray-200 rounded-lg p-2.5 hover:border-fls-navy hover:bg-blue-50 transition-colors cursor-pointer min-w-[180px] bg-white"
      >
        <div className="text-[11px] font-bold uppercase tracking-wider text-fls-navy">
          {kind === 'pmap' ? '📋 Last PMAP' : '✍️ Last Self-Reflection'}
        </div>
        <div className="text-sm font-semibold text-gray-800 mt-0.5">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{prettyDate(rec.date)} · {rec.school_year}</div>
        {rec.observer_name && (
          <div className="text-[11px] text-gray-400 mt-0.5">By {rec.observer_name}</div>
        )}
        <div className="text-[11px] font-bold text-fls-orange mt-1.5">Tap to review →</div>
      </button>
    )
  }

  return (
    <>
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-fls-navy mb-2">
          Review prior context
        </div>
        <div className="flex flex-wrap gap-2">
          <Card kind="pmap" rec={data.pmap} />
          <Card kind="sr" rec={data.sr} />
        </div>
      </div>
      {open && <TouchpointDetail touchpoint={open} onClose={() => setOpen(null)} />}
    </>
  )
}
