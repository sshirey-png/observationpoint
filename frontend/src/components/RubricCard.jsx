import { useState } from 'react'

/**
 * RubricCard — one rubric dimension with 1-5 scoring.
 * Reusable for T1-T5, L1-L5, or any scored dimension.
 *
 * Props:
 *   code — "T1", "L2", etc.
 *   name — "On Task"
 *   question — the rubric question text
 *   descriptors — full text for 1-5 levels (optional)
 *   required — show "Required" badge
 *   value — current score (1-5 or null)
 *   onChange(score) — called when user taps a score
 */

const SCORE_COLORS = {
  1: { bg: '#ef4444', label: 'NI' },
  2: { bg: '#f97316', label: 'Emrg' },
  3: { bg: '#eab308', label: 'Dev' },
  4: { bg: '#22c55e', label: 'Prof' },
  5: { bg: '#0ea5e9', label: 'Exm' },
}

export default function RubricCard({ code, name, question, descriptors, required, value, onChange }) {
  const [showDesc, setShowDesc] = useState(false)

  return (
    <div
      className="bg-white rounded-xl shadow-sm p-4 mb-2.5 border-l-4 transition-colors"
      style={{ borderLeftColor: value ? SCORE_COLORS[value].bg : '#e5e7eb' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-1.5">
        <span className="text-[11px] font-bold text-fls-navy bg-fls-navy/5 px-1.5 py-0.5 rounded">
          {code}
        </span>
        {required && (
          <span className="text-[10px] font-semibold text-red-600">Required</span>
        )}
      </div>

      {/* Question */}
      <div className="text-sm font-medium leading-relaxed mb-3">
        {name} — {question}
      </div>

      {/* Score buttons */}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n
          const color = SCORE_COLORS[n]
          return (
            <button
              key={n}
              onClick={() => onChange(value === n ? null : n)}
              className="flex-1 py-3 rounded-lg border-2 text-center transition-all active:scale-90"
              style={{
                borderColor: selected ? color.bg : '#e5e7eb',
                background: selected ? color.bg : '#fff',
              }}
            >
              <span
                className="block text-lg font-bold"
                style={{ color: selected ? '#fff' : '#9ca3af' }}
              >
                {n}
              </span>
              <span
                className="block text-[8px] font-semibold uppercase tracking-wide"
                style={{ color: selected ? '#fff' : '#9ca3af' }}
              >
                {color.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Expandable descriptors */}
      {descriptors && (
        <>
          <button
            onClick={() => setShowDesc(!showDesc)}
            className="text-xs text-fls-orange mt-2 flex items-center gap-1"
          >
            {showDesc ? '▼ Hide descriptors' : '▶ View rubric descriptors'}
          </button>
          {showDesc && (
            <div className="mt-2 p-2.5 bg-gray-50 rounded-lg text-xs text-gray-500 leading-relaxed">
              {descriptors}
            </div>
          )}
        </>
      )}
    </div>
  )
}
