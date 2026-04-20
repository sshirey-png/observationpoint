import { dimName } from '../lib/dimensions'

/**
 * TouchpointDetail — slide-up modal showing the full touchpoint record.
 * Renders:
 *   - Header: form label + date + school year
 *   - Score chips (rubric dimension → value)
 *   - Notes (plain)
 *   - Narrative (from feedback_json.narrative[] — the Grow textBoxes
 *     content pulled by /admin/enrich-narrative). Each narrative entry
 *     is shown as a quoted block.
 *   - Selected checkboxes (Yes/No/Proficient/etc.)
 *   - Meeting details (if any)
 *   - Observer
 *
 * The feedback_json payload shape from the enrichment endpoint:
 *   { grow_id, narrative: [{measurement, text}], checkboxes_selected: [{measurement, selected}], comments: [] }
 *
 * Also falls back to the older flat-object shape for any pre-enrichment
 * records so nothing regresses.
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

function parseJSONMaybe(v) {
  if (!v) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

function Section({ label, children }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">{label}</div>
      {children}
    </div>
  )
}

function NarrativeBlock({ text }) {
  if (!text) return null
  return (
    <div className="bg-gray-50 rounded-lg p-3 mb-2 relative pl-4">
      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-fls-orange" />
      <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{text}</div>
    </div>
  )
}

export default function TouchpointDetail({ touchpoint, onClose }) {
  if (!touchpoint) return null

  const tp = touchpoint
  const label = FORM_LABELS[tp.form_type] || tp.form_type
  const scores = tp.scores || {}
  const scoreCodes = Object.keys(scores).sort()

  const feedbackData = parseJSONMaybe(tp.feedback_json)
  const meetingData = parseJSONMaybe(tp.meeting_json)

  // New enrichment shape: { grow_id, narrative, checkboxes_selected, comments }
  const narrative = Array.isArray(feedbackData?.narrative) ? feedbackData.narrative : []
  const checkboxesSelected = Array.isArray(feedbackData?.checkboxes_selected) ? feedbackData.checkboxes_selected : []
  const comments = Array.isArray(feedbackData?.comments) ? feedbackData.comments : []
  const growId = feedbackData?.grow_id
  const isEnrichedShape = !!(growId || narrative.length || checkboxesSelected.length)

  // Legacy flat-object fallback — render any remaining keys we haven't covered
  const otherFeedbackKeys = feedbackData && !isEnrichedShape
    ? Object.entries(feedbackData).filter(([_, v]) => v != null && v !== 'null' && v !== '')
    : []

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[900]" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] shadow-[0_-10px_32px_rgba(0,0,0,.22)] max-h-[88vh] overflow-y-auto animate-slide-up">
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5" />
        <div className="px-4 pt-3 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
            <div>
              <div className="text-base font-extrabold">{label}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {prettyDate(tp.date)}
                {tp.school_year ? <> · {tp.school_year}</> : null}
                {tp.status && tp.status !== 'published' ? (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">{tp.status}</span>
                ) : null}
              </div>
            </div>
            <button onClick={onClose} className="w-[30px] h-[30px] rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center text-lg border-0 cursor-pointer">×</button>
          </div>

          {/* Scores */}
          {scoreCodes.length > 0 && (
            <Section label="Scores">
              <div className="flex flex-wrap gap-1.5">
                {scoreCodes.map(code => {
                  const raw = scores[code]
                  const s = Math.round(raw)
                  const color = SCORE_COLORS[Math.max(1, Math.min(5, s))] || '#9ca3af'
                  return (
                    <div key={code} className="px-2.5 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: color + '20', color }}>
                      {dimName(code)}: {raw}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Plain notes */}
          {tp.notes && (
            <Section label="Notes">
              <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
                {tp.notes}
              </div>
            </Section>
          )}

          {/* Plain-text feedback column (from enrichment) */}
          {tp.feedback && !narrative.length && (
            <Section label="Feedback (from Grow)">
              <NarrativeBlock text={tp.feedback} />
            </Section>
          )}

          {/* Enriched narrative — each textBox content as its own block */}
          {narrative.length > 0 && (
            <Section label={`Narrative · ${narrative.length} ${narrative.length === 1 ? 'entry' : 'entries'}`}>
              {narrative.map((n, i) => (
                <NarrativeBlock key={i} text={n.text} />
              ))}
            </Section>
          )}

          {/* Checkbox selections */}
          {checkboxesSelected.length > 0 && (
            <Section label="Selections">
              <div className="flex flex-wrap gap-1.5">
                {checkboxesSelected.map((c, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700">
                    {c.selected}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Comments */}
          {comments.length > 0 && (
            <Section label="Comments">
              {comments.map((c, i) => (
                <NarrativeBlock key={i} text={typeof c === 'string' ? c : JSON.stringify(c)} />
              ))}
            </Section>
          )}

          {/* Legacy flat-object fallback */}
          {otherFeedbackKeys.length > 0 && (
            <Section label="Feedback">
              <div className="space-y-2">
                {otherFeedbackKeys.map(([key, val]) => {
                  const pretty = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  return (
                    <div key={key} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{pretty}</div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Meeting data */}
          {meetingData && (
            <Section label="Meeting Details">
              <div className="space-y-2">
                {Object.entries(meetingData).map(([key, val]) => {
                  if (!val || val === 'null') return null
                  const pretty = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  return (
                    <div key={key} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">{pretty}</div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Observer + provenance */}
          <div className="text-xs text-gray-400 mt-4 space-y-0.5">
            {tp.observer_email && <div>Observer: {tp.observer_email}</div>}
            {growId && <div className="font-mono text-[10px]">Grow ID: {growId}</div>}
          </div>
        </div>
      </div>
    </>
  )
}
