import { dimName } from '../lib/dimensions'

/**
 * TouchpointDetail — slide-up modal showing full touchpoint record.
 * Appears over the profile page when a touchpoint is tapped.
 *
 * Props:
 *   touchpoint — the touchpoint data object
 *   onClose — called when modal should close
 */

const FORM_LABELS = {
  observation_teacher: 'Classroom Observation',
  observation_prek: 'PreK Observation',
  observation_fundamentals: 'Fundamentals',
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
  quick_feedback: 'Quick Feedback',
  meeting_quick_meeting: 'Coaching Meeting',
  'meeting_data_meeting_(relay)': 'Data Meeting (Relay)',
  write_up: 'Employee Write-Up',
  iap: 'Improvement Action Plan',
  celebrate: 'Celebrate',
  solicited_feedback: 'Solicited Feedback',
}

const SCORE_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }

function prettyDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function TouchpointDetail({ touchpoint, onClose }) {
  if (!touchpoint) return null

  const tp = touchpoint
  const label = FORM_LABELS[tp.form_type] || tp.form_type
  const scores = tp.scores || {}
  const scoreCodes = Object.keys(scores).sort()
  const hasScores = scoreCodes.length > 0

  // Try to parse feedback JSON if it's a string
  let feedbackData = null
  if (tp.feedback_json) {
    feedbackData = typeof tp.feedback_json === 'string' ? JSON.parse(tp.feedback_json) : tp.feedback_json
  }

  let meetingData = null
  if (tp.meeting_json) {
    meetingData = typeof tp.meeting_json === 'string' ? JSON.parse(tp.meeting_json) : tp.meeting_json
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-4 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-base font-bold">{label}</div>
              <div className="text-xs text-gray-400">{prettyDate(tp.date)} · {tp.school_year}</div>
            </div>
            <button onClick={onClose} className="text-gray-400 text-xl px-2">×</button>
          </div>

          {/* Scores */}
          {hasScores && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Scores</div>
              <div className="flex flex-wrap gap-1.5">
                {scoreCodes.map(code => {
                  const s = Math.round(scores[code])
                  const color = SCORE_COLORS[Math.max(1, Math.min(5, s))] || '#9ca3af'
                  return (
                    <div key={code} className="px-2.5 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: color + '20', color }}>
                      {dimName(code)}: {s}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          {tp.notes && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Notes</div>
              <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3">
                {tp.notes}
              </div>
            </div>
          )}

          {/* Feedback data */}
          {feedbackData && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Feedback</div>
              <div className="space-y-2">
                {Object.entries(feedbackData).map(([key, val]) => {
                  if (!val || val === 'null') return null
                  const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  return (
                    <div key={key} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{label}</div>
                      <div className="text-sm text-gray-700">
                        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Meeting data */}
          {meetingData && (
            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Meeting Details</div>
              <div className="space-y-2">
                {Object.entries(meetingData).map(([key, val]) => {
                  if (!val || val === 'null') return null
                  const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  return (
                    <div key={key} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{label}</div>
                      <div className="text-sm text-gray-700">{String(val)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Observer */}
          {tp.observer_email && (
            <div className="text-xs text-gray-400 mt-4">
              Observer: {tp.observer_email}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
