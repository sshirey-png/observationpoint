import { useState } from 'react'

/**
 * PreKRubricCard — CLASS PreK rubric dimension with 1-7 scoring.
 * Uses 3-color range (low/mid/high) from the CLASS protocol.
 *
 * Props:
 *   code — "PK1", "PK2", etc.
 *   name — "Positive Climate"
 *   domain — "Emotional Support" / "Classroom Organization" / "Instructional Support"
 *   descriptors — full low/mid/high descriptor text (optional, expandable)
 *   required — show "Required" badge
 *   value — current score (1-7 or null)
 *   onChange(score) — called when user taps a score
 */

const RANGE_COLOR = (n) => {
  if (n <= 2) return '#ef4444'       // low
  if (n <= 5) return '#eab308'       // mid
  return '#22c55e'                    // high
}

export default function PreKRubricCard({ code, name, domain, descriptors, required, value, onChange }) {
  const [showDesc, setShowDesc] = useState(false)
  const activeColor = value ? RANGE_COLOR(value) : '#e5e7eb'

  return (
    <div
      className="bg-white rounded-xl shadow-sm p-4 mb-2.5 border-l-4 transition-colors"
      style={{ borderLeftColor: activeColor }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-fls-navy bg-fls-navy/5 px-1.5 py-0.5 rounded">{code}</span>
          <span className="text-sm font-semibold">{name}</span>
        </div>
        {required && <span className="text-[10px] font-semibold text-red-600">Required</span>}
      </div>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
          const selected = value === n
          const color = RANGE_COLOR(n)
          return (
            <button
              key={n}
              onClick={() => onChange(value === n ? null : n)}
              className="flex-1 py-2.5 rounded-lg border-2 text-center transition-all active:scale-90"
              style={{
                borderColor: selected ? color : '#e5e7eb',
                background: selected ? color : '#fff',
              }}
            >
              <span className="block text-base font-bold" style={{ color: selected ? '#fff' : '#9ca3af' }}>{n}</span>
            </button>
          )
        })}
      </div>

      <div className="flex justify-between text-[9px] font-semibold uppercase tracking-wider mt-1 px-0.5">
        <span style={{ color: '#ef4444' }}>Low</span>
        <span style={{ color: '#eab308' }}>Mid</span>
        <span style={{ color: '#22c55e' }}>High</span>
      </div>

      {descriptors && (
        <>
          <button
            onClick={() => setShowDesc(!showDesc)}
            className="text-xs text-fls-orange mt-2 flex items-center gap-1"
          >
            {showDesc ? '▼ Hide descriptors' : '▶ View descriptors'}
          </button>
          {showDesc && (
            <div className="mt-2 p-2.5 bg-gray-50 rounded-lg text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
              {descriptors}
            </div>
          )}
        </>
      )}
    </div>
  )
}
