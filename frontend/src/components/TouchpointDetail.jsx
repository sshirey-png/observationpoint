import { dimName } from '../lib/dimensions'

/**
 * TouchpointDetail — slide-up modal showing the full touchpoint record.
 * Layout adapts to form_type so an Observation reads like an Observation
 * (See It / Do It + Action Step), a PMAP reads like a PMAP (9 sections),
 * etc. — not a generic AI-summary list.
 *
 * Records imported from Grow keep their narrative-block shape because
 * Grow's textBoxes don't map to our form sections.
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

// --- Form layouts ---
// Each form_type maps to an ordered list of groups. Each group is {title, fields:[{key,label,kind?}]}.
// 'kind' values:  text (default) | track (off/on) | yesno | list (array → chips) | bool
const FORM_LAYOUTS = {
  observation_teacher: [
    {
      title: 'See It',
      fields: [
        { key: 'see_it_success', label: 'Success' },
        { key: 'see_it_growth', label: 'Area for Growth' },
      ],
    },
    {
      title: 'Do It',
      fields: [
        { key: 'do_it_practice', label: 'Practice Plan' },
      ],
    },
    {
      title: 'Action Step',
      fields: [
        { key: 'action_step', label: null, kind: 'action_step' },
      ],
    },
  ],
  observation_fundamentals: [
    { title: 'Class', fields: [{ key: 'class_size', label: 'Class Size' }] },
  ],
  quick_feedback: [
    {
      title: 'Feedback',
      fields: [
        { key: 'note', label: null },
        { key: 'tags', label: 'Tags', kind: 'list' },
        { key: 'shared', label: 'Shared with Teacher', kind: 'bool' },
      ],
    },
  ],
  celebrate: [
    {
      title: 'Celebration',
      fields: [
        { key: 'recognition', label: null },
        { key: 'personal_note', label: 'Personal Note' },
        { key: 'commitments', label: 'FLS Commitments Modeled', kind: 'list' },
        { key: 'tags', label: 'Tags', kind: 'list' },
        { key: 'share_level', label: 'Share Level' },
      ],
    },
  ],
  solicited_feedback: [
    {
      title: 'Feedback Requested',
      fields: [
        { key: 'question', label: 'Question' },
        { key: 'context', label: 'Context' },
        { key: 'sustainability', label: 'Sustainability' },
        { key: 'flight_risk', label: 'Flight Risk' },
      ],
    },
  ],
  'meeting_data_meeting_(relay)': [
    {
      title: 'Lesson',
      fields: [
        { key: 'standard', label: 'Standard' },
        { key: 'initial_mastery', label: 'Initial Mastery' },
        { key: 'know_show_summary', label: 'Know / Show Summary' },
      ],
    },
    {
      title: 'See It',
      fields: [
        { key: 'see_it_success', label: 'Success' },
        { key: 'see_it_growth', label: 'Growth' },
      ],
    },
    {
      title: 'Reteach',
      fields: [
        { key: 'reteach_plan', label: 'Plan' },
        { key: 'reteach_prep', label: 'Prep' },
        { key: 'reteach_date', label: 'Date' },
        { key: 'reteach_mastery', label: 'Post Mastery' },
        { key: 'reteach_reflection', label: 'Reflection' },
      ],
    },
  ],
}

// PMAP forms share a layout across all role variants.
const PMAP_LAYOUT = [
  {
    title: 'Meeting Checklist',
    fields: [{ key: 'job_desc_reviewed', label: 'Job Description Reviewed', kind: 'yesno' }],
  },
  {
    title: 'WIG + Annual Goals',
    fields: [
      { key: 'goals_notes', label: 'Goals Notes' },
      { key: 'wig_track', label: 'Wildly Important Goal', kind: 'track' },
      { key: 'ag1_track', label: 'Annual Goal 1', kind: 'track' },
      { key: 'ag2_track', label: 'Annual Goal 2', kind: 'track' },
      { key: 'ag3_track', label: 'Annual Goal 3', kind: 'track' },
      { key: 'progress_notes', label: 'Progress Notes' },
    ],
  },
  { title: 'Whirlwind', fields: [{ key: 'whirlwind', label: null }] },
  {
    title: 'Rubric Reflection',
    fields: [
      { key: 'strength_areas', label: 'Strength Areas' },
      { key: 'growth_areas', label: 'Growth Areas' },
    ],
  },
  {
    title: 'FLS Commitments',
    fields: [
      { key: 'commit_strength', label: 'Commitment Strength' },
      { key: 'commit_growth', label: 'Commitment Growth Area' },
    ],
  },
  {
    title: 'Career Growth',
    fields: [
      { key: 'career_goals', label: 'Career Goals' },
      { key: 'licenses', label: 'Licenses / Certifications / Trainings' },
    ],
  },
  {
    title: 'Concerns',
    fields: [
      { key: 'concerns', label: 'Areas of Concern', kind: 'list' },
      { key: 'concern_comments', label: 'Comments' },
    ],
  },
]

// Self-reflection uses a subset of PMAP (no meeting checklist, no WIG tracker).
const SR_LAYOUT = [
  {
    title: 'Rubric Reflection',
    fields: [
      { key: 'strength_areas', label: 'Strength Areas' },
      { key: 'growth_areas', label: 'Growth Areas' },
    ],
  },
  {
    title: 'FLS Commitments',
    fields: [
      { key: 'commit_strength', label: 'Commitment Strength' },
      { key: 'commit_growth', label: 'Commitment Growth Area' },
    ],
  },
  {
    title: 'Career Growth',
    fields: [
      { key: 'career_goals', label: 'Career Goals' },
      { key: 'licenses', label: 'Licenses / Certifications / Trainings' },
    ],
  },
]

function layoutFor(formType) {
  if (!formType) return null
  if (formType.startsWith('pmap_')) return PMAP_LAYOUT
  if (formType.startsWith('self_reflection_')) return SR_LAYOUT
  return FORM_LAYOUTS[formType] || null
}

function prettyDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function parseJSONMaybe(v) {
  if (v == null || v === '') return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

function GroupCard({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">{title}</div>
      {children}
    </div>
  )
}

function TextField({ label, value }) {
  if (value == null || value === '' || value === 'null') return null
  const s = typeof value === 'string' ? value : String(value)
  if (!s.trim()) return null
  return (
    <div className="mb-3 last:mb-0">
      {label && (
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</div>
      )}
      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{s}</div>
    </div>
  )
}

function TrackField({ label, value }) {
  if (!value) return null
  const isOff = value === 'off'
  const color = isOff ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
  return (
    <div className="flex items-center justify-between mb-2 last:mb-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${color}`}>
        {isOff ? 'Off Track' : 'On Track'}
      </span>
    </div>
  )
}

function YesNoField({ label, value }) {
  if (!value) return null
  const isYes = String(value).toLowerCase() === 'yes'
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
        isYes ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
      }`}>
        {String(value)}
      </span>
    </div>
  )
}

function BoolField({ label, value }) {
  if (value == null) return null
  return (
    <div className="flex items-center justify-between mt-2">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
        value ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
      }`}>
        {value ? 'Yes' : 'No'}
      </span>
    </div>
  )
}

function ListField({ label, value }) {
  const arr = Array.isArray(value) ? value : (value ? [value] : [])
  if (arr.length === 0) return null
  return (
    <div className="mb-3 last:mb-0">
      {label && (
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{label}</div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {arr.map((item, i) => (
          <span key={i} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-gray-100 text-gray-700">
            {typeof item === 'string' ? item : JSON.stringify(item)}
          </span>
        ))}
      </div>
    </div>
  )
}

function ActionStepField({ value }) {
  const parsed = parseJSONMaybe(value) || value
  if (!parsed) return null
  if (typeof parsed === 'object') {
    return (
      <div className="bg-orange-50 border border-orange-100 rounded-lg p-3">
        {parsed.title && <div className="text-sm font-bold text-orange-900 mb-1">{parsed.title}</div>}
        {parsed.description && <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{parsed.description}</div>}
        {!parsed.title && !parsed.description && (
          <div className="text-sm text-gray-800 whitespace-pre-wrap">{JSON.stringify(parsed, null, 2)}</div>
        )}
      </div>
    )
  }
  return (
    <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">
      {parsed}
    </div>
  )
}

function renderField({ key, label, kind }, feedback, action_step) {
  const val = key === 'action_step' ? action_step : feedback[key]
  if (kind === 'track') return <TrackField key={key} label={label} value={val} />
  if (kind === 'yesno') return <YesNoField key={key} label={label} value={val} />
  if (kind === 'bool')  return <BoolField key={key} label={label} value={val} />
  if (kind === 'list')  return <ListField key={key} label={label} value={val} />
  if (kind === 'action_step') return <ActionStepField key={key} value={val} />
  return <TextField key={key} label={label} value={val} />
}

function FormLayoutBody({ formType, feedback, action_step }) {
  const layout = layoutFor(formType)
  if (!layout) return null
  const groups = layout
    .map(g => {
      const rendered = g.fields.map(f => renderField(f, feedback, action_step)).filter(Boolean)
      return rendered.length > 0 ? { title: g.title, rendered } : null
    })
    .filter(Boolean)
  if (groups.length === 0) return null
  return (
    <div className="mt-3">
      {groups.map(g => (
        <GroupCard key={g.title} title={g.title}>
          {g.rendered}
        </GroupCard>
      ))}
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

function Section({ label, children }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">{label}</div>
      {children}
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
  // Also parse the plaintext feedback column as JSON (form submissions stash
  // their structured data here; if it's not JSON it's treated as plaintext).
  const feedbackInlineObj = parseJSONMaybe(tp.feedback)

  const narrative = Array.isArray(feedbackData?.narrative) ? feedbackData.narrative : []
  const checkboxesSelected = Array.isArray(feedbackData?.checkboxes_selected) ? feedbackData.checkboxes_selected : []
  const comments = Array.isArray(feedbackData?.comments) ? feedbackData.comments : []
  const growId = feedbackData?.grow_id
  const isEnrichedFromGrow = !!(growId || narrative.length || checkboxesSelected.length)

  // Structured form data takes priority; fall back to the enriched feedback_json if present.
  const formFeedback = (feedbackInlineObj && typeof feedbackInlineObj === 'object' && !Array.isArray(feedbackInlineObj))
    ? feedbackInlineObj
    : null
  const action_step = formFeedback?.action_step || null

  const hasFormLayout = !!layoutFor(tp.form_type) && !!formFeedback

  const isFormLabelNotes = tp.notes &&
    (tp.notes.trim() === label || tp.notes.trim() === tp.form_type ||
     tp.notes.trim() === `Observation: ${label.replace('Observation','').trim() || 'Teacher'}`)
  const cleanNotes = tp.notes && !isFormLabelNotes ? tp.notes : null

  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[900]" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] shadow-[0_-10px_32px_rgba(0,0,0,.22)] max-h-[88dvh] overflow-y-auto animate-slide-up">
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5" />
        <div className="px-4 pt-3 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
            <div className="min-w-0">
              <div className="text-base font-extrabold truncate">{label}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {prettyDate(tp.date)}
                {tp.school_year ? <> · {tp.school_year}</> : null}
                {tp.status && tp.status !== 'published' ? (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">{tp.status}</span>
                ) : null}
                {isEnrichedFromGrow && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Imported</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-10 h-10 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 flex items-center justify-center text-xl border-0 cursor-pointer shrink-0"
            >×</button>
          </div>

          {/* Scores — always first when present */}
          {scoreCodes.length > 0 && (
            <Section label="Rubric Scores">
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

          {/* Notes — only when real (not form-label garbage) */}
          {cleanNotes && (
            <Section label="Notes">
              <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
                {cleanNotes}
              </div>
            </Section>
          )}

          {/* Form-structured body — renders by form type, section-by-section */}
          {hasFormLayout && (
            <FormLayoutBody formType={tp.form_type} feedback={formFeedback} action_step={action_step} />
          )}

          {/* Grow-imported narrative (no form structure available) */}
          {isEnrichedFromGrow && narrative.length > 0 && (
            <Section label="Coaching Narrative">
              {narrative.map((n, i) => (
                <NarrativeBlock key={i} text={n.text} />
              ))}
            </Section>
          )}

          {/* Grow-imported plaintext feedback when no structured narrative */}
          {!isEnrichedFromGrow && !hasFormLayout && tp.feedback && typeof tp.feedback === 'string' && !feedbackInlineObj && (
            <Section label="Feedback">
              <NarrativeBlock text={tp.feedback} />
            </Section>
          )}

          {/* Grow-imported selections */}
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

          {/* Grow-imported observation-level comments */}
          {comments.length > 0 && (
            <Section label="Comments">
              {comments.map((c, i) => (
                <NarrativeBlock key={i} text={typeof c === 'string' ? c : JSON.stringify(c)} />
              ))}
            </Section>
          )}

          {/* Observer + provenance */}
          <div className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100 space-y-0.5">
            {(tp.observer_name || tp.observer_email) && (
              <div>
                Observer: <span className="text-gray-600 font-semibold">{tp.observer_name || tp.observer_email}</span>
                {tp.observer_name && tp.observer_email && (
                  <span className="text-gray-300"> · {tp.observer_email}</span>
                )}
              </div>
            )}
            {growId && <div className="font-mono text-[10px]">Grow ID: {growId}</div>}
          </div>
        </div>
      </div>
    </>
  )
}
