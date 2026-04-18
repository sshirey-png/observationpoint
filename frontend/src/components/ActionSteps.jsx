import { useState } from 'react'
import { ACTION_STEPS } from '../lib/action-steps'

/**
 * ActionSteps — Get Better Faster coaching action step selector.
 * User picks a rubric dimension, sees matching action steps,
 * taps one to select (shows coaching prompt + RTC cue).
 *
 * Props:
 *   selected — { dimension, action } or null
 *   onChange({ dimension, action, cat, prompt, rtc })
 *   customStep — string for custom action step
 *   onCustomChange(text)
 */

const DIMENSIONS = [
  { code: 'T1', label: 'T1 — On Task' },
  { code: 'T2', label: 'T2 — Community of Learners' },
  { code: 'T3', label: 'T3 — Essential Content' },
  { code: 'T4', label: 'T4 — Cognitive Engagement' },
  { code: 'T5', label: 'T5 — Demonstration of Learning' },
]

export default function ActionSteps({ selected, onChange, customStep, onCustomChange }) {
  const [dimension, setDimension] = useState(selected?.dimension || '')

  function selectDimension(code) {
    setDimension(code)
    onChange(null) // clear selection when changing dimension
  }

  const steps = dimension ? (ACTION_STEPS[dimension] || []) : []

  return (
    <div>
      {/* Dimension picker */}
      <div className="mb-3">
        <select
          value={dimension}
          onChange={(e) => selectDimension(e.target.value)}
          className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange bg-white appearance-none"
          style={{
            backgroundImage: "url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 fill=%27%239ca3af%27%3E%3Cpath d=%27M2 4l4 4 4-4%27/%3E%3C/svg%3E')",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 12px center',
          }}
        >
          <option value="">Select rubric dimension...</option>
          {DIMENSIONS.map(d => (
            <option key={d.code} value={d.code}>{d.label}</option>
          ))}
        </select>
      </div>

      {/* Action step cards */}
      <div className="space-y-2">
        {steps.map((step, i) => {
          const isSelected = selected?.action === step.action
          return (
            <div
              key={i}
              onClick={() => onChange(isSelected ? null : { dimension, ...step })}
              className={`p-3.5 border rounded-[10px] cursor-pointer transition-all active:scale-[.98] ${
                isSelected
                  ? 'border-fls-orange bg-orange-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="text-[10px] font-bold text-fls-orange uppercase tracking-wide">
                {step.cat}
              </div>
              <div className="text-[13px] font-semibold mt-0.5">
                {step.action}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                When: {step.when}
              </div>
              {isSelected && (
                <>
                  <div className="text-xs text-blue-600 italic mt-2 p-2 bg-blue-50 rounded-md leading-relaxed">
                    {step.prompt}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    RTC Cue: {step.rtc}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Custom action step */}
      <div className="mt-3">
        <div className="text-[13px] font-semibold mb-1.5">Custom Action Step (optional)</div>
        <textarea
          value={customStep || ''}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="Or write your own action step..."
          rows={2}
          className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm font-[Inter] outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
        />
      </div>
    </div>
  )
}
