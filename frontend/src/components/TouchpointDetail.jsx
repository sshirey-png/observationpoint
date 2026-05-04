import { useEffect, useState, useRef } from 'react'
import { api } from '../lib/api'
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
  iap: 'Performance Improvement Plan',
  performance_improvement_plan: 'Performance Improvement Plan',
  celebrate: 'Celebrate',
  solicited_feedback: 'Solicit Feedback',
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

// ---------------------------------------------------------------
// Archive PMAP view — renders the full 24-25 [ARCHIVE] PMAP form:
//   1. Teacher Performance Review (7 narrative Qs)
//   2. Leader's Rubric Scores For Teacher (5pt: T1-T5 score + narrative)
//   3. Compass Scores For Teacher (4pt: C1-C5 score-only, for state reporting)
//   4. Professionalism (P.1-P.7 scored 1-3)
//   5. Values (LV.1 Values 1-6 scored 1-3)
//   6. Goals (WIG + AG1-3 from goals table for school_year)
// Print stylesheet flips this to a paper-friendly layout when the user
// hits Download → Save as PDF in the browser.
// ---------------------------------------------------------------
const PMAP_PRINT_CSS = `
  @media print {
    /* Page setup */
    html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
    @page { size: letter; margin: 0.55in; }

    /* Use display:none on everything that does NOT contain the print root,
       so non-modal content doesn't reserve vertical space (which was pushing
       the modal header to the bottom of page 1). :has() lets us target
       siblings/cousins precisely while keeping the print root's ancestor
       chain visible. */
    body :not(:has(.pmap-print-root)):not(.pmap-print-root):not(.pmap-print-root *) {
      display: none !important;
    }
    .pmap-no-print { display: none !important; }

    /* Reset positioning + scrolling on the print root + every ancestor so
       content flows from the top of page 1 and paginates naturally */
    html, body, body *:has(.pmap-print-root), .pmap-print-root {
      position: static !important;
      max-height: none !important;
      height: auto !important;
      overflow: visible !important;
      transform: none !important;
    }
    .pmap-print-root {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      animation: none !important;
      inset: auto !important;
    }
    .pmap-print-root * { overflow: visible !important; max-height: none !important; }

    /* Allow sections to break across pages (they're often taller than a page);
       only protect smaller cohesive blocks like the per-dim rubric cards. */
    .pmap-dim-card { page-break-inside: avoid; break-inside: avoid; }
    .pmap-narr-block { page-break-inside: avoid; break-inside: avoid; }
  }
`

function PMAPScoreChip({ score, scale }) {
  if (score == null) return <span className="text-gray-400 text-xs italic">No score</span>
  const max = scale === 4 ? 4 : (scale === 3 ? 3 : 5)
  const colors5 = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }
  const colors3 = { 1: '#ef4444', 2: '#22c55e', 3: '#0ea5e9' }
  const idx = Math.max(1, Math.min(max, Math.round(score)))
  const palette = scale === 3 ? colors3 : colors5
  const c = palette[idx] || '#6b7280'
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap"
          style={{ background: c + '1f', color: c }}>
      {score}<span className="opacity-50 font-normal">/{max}</span>
    </span>
  )
}

function ArchivePMAPView({ touchpoint, onClose }) {
  const tp = touchpoint
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    api.get(`/api/touchpoint/${encodeURIComponent(tp.id)}/full-detail`)
       .then(d => { if (alive) setData(d) })
       .catch(e => { if (alive) setErr(String(e)) })
    return () => { alive = false }
  }, [tp.id])

  const triggerPrint = () => window.print()
  const formLabel = FORM_LABELS[tp.form_type] || tp.form_type
  const dateStr = prettyDate(tp.date)

  // 25-26 archive form: backend returns a `pmap_2526` block when the record
  // has 25-26 form measurement_ids. Use that if present.
  const useNative = !!data?.pmap_2526

  return (
    <>
      <style>{PMAP_PRINT_CSS}</style>
      <div className="fixed inset-0 bg-black/45 z-[900] pmap-no-print" onClick={onClose} />
      <div className="pmap-print-root fixed bottom-0 left-0 right-0 z-[901] bg-white rounded-t-[22px] shadow-[0_-10px_32px_rgba(0,0,0,.22)] max-h-[88dvh] overflow-y-auto">
        <div className="w-11 h-1 bg-gray-200 rounded-md mx-auto mt-2.5 pmap-no-print" />
        <div className="px-4 pt-3 pb-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-4 pb-3 border-b border-gray-200">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-fls-navy">{formLabel}</div>
              <div className="text-xs text-gray-600 mt-0.5">
                {data?.teacher_name || tp.teacher_name || ''} · {dateStr}
                {tp.school_year ? <> · {tp.school_year}</> : null}
              </div>
              <div className="text-xs text-gray-500">
                Observed by {data?.observer_name || tp.observer_name || tp.observer_email || ''}
                {tp.school || data?.school ? <> · {tp.school || data.school}</> : null}
              </div>
            </div>
            <div className="flex items-center gap-2 pmap-no-print">
              <button
                onClick={triggerPrint}
                className="px-3 py-1.5 rounded-lg bg-fls-navy text-white text-xs font-bold border-0 cursor-pointer"
                title="Open browser print → Save as PDF"
              >↓ Download</button>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-xl border-0 cursor-pointer"
              >×</button>
            </div>
          </div>

          {err && <div className="text-sm text-red-600 mb-3">Could not load full detail: {err}</div>}
          {!data && !err && <div className="text-sm text-gray-500 italic">Loading…</div>}

          {data && useNative && <NativePMAPSections data={data} tp={tp} />}

          {data && !useNative && (
            <>
              {/* 1. Teacher Performance Review */}
              {(data.sections?.performance_review?.entries?.length || 0) > 0 && (
                <SectionGroup title={data.sections.performance_review.label}>
                  {data.sections.performance_review.entries.map((e, i) => (
                    <div key={i} className="mb-3">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-fls-navy mb-1">{e.label}</div>
                      <div className="bg-gray-50 border-l-[3px] border-fls-navy pl-3 pr-3 py-2 rounded text-sm text-gray-800 leading-relaxed"
                           dangerouslySetInnerHTML={{ __html: e.html }} />
                    </div>
                  ))}
                </SectionGroup>
              )}

              {/* 2. 5pt FLS Rubric */}
              {(data.sections?.rubric_5pt?.dims?.length || 0) > 0 && (
                <SectionGroup title={data.sections.rubric_5pt.label}>
                  {data.sections.rubric_5pt.dims.map(d => (
                    <div key={d.dim} className="border border-gray-200 rounded-lg p-3 mb-2 pmap-dim-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-bold text-sm">{d.dim} · {dimName(d.dim)}</div>
                        <PMAPScoreChip score={d.score} scale={5} />
                      </div>
                      {d.narrative_html ? (
                        <div className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: d.narrative_html }} />
                      ) : (
                        <div className="text-xs text-gray-400 italic">No narrative recorded for this dimension.</div>
                      )}
                    </div>
                  ))}
                </SectionGroup>
              )}

              {/* 3. 4pt Compass — score-only, for state reporting */}
              {(data.sections?.compass_4pt?.dims?.length || 0) > 0 && (
                <SectionGroup title={data.sections.compass_4pt.label}>
                  <div className="grid grid-cols-1 gap-1.5">
                    {data.sections.compass_4pt.dims.map(d => (
                      <div key={d.dim} className="flex items-center justify-between border border-gray-200 rounded-md px-3 py-2">
                        <div className="text-sm">{d.label || d.dim}</div>
                        <PMAPScoreChip score={d.score} scale={4} />
                      </div>
                    ))}
                  </div>
                </SectionGroup>
              )}

              {/* 4. Professionalism */}
              {(data.sections?.professionalism?.entries?.length || 0) > 0 && (
                <SectionGroup title={data.sections.professionalism.label}>
                  <div className="text-[11px] text-gray-500 mb-2">1=Below · 2=Meets · 3=Exceeds Expectations</div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {data.sections.professionalism.entries.map((e, i) => (
                      <div key={i} className="flex items-start justify-between gap-3 border border-gray-200 rounded-md px-3 py-2">
                        <div className="text-sm leading-snug flex-1">{e.label}</div>
                        <PMAPScoreChip score={e.score} scale={3} />
                      </div>
                    ))}
                  </div>
                </SectionGroup>
              )}

              {/* 5. Values */}
              {(data.sections?.values?.entries?.length || 0) > 0 && (
                <SectionGroup title={data.sections.values.label}>
                  <div className="text-[11px] text-gray-500 mb-2">1=Below · 2=Meets · 3=Exceeds Expectations</div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {data.sections.values.entries.map((e, i) => (
                      <div key={i} className="flex items-center justify-between border border-gray-200 rounded-md px-3 py-2">
                        <div className="text-sm">{e.label}</div>
                        <PMAPScoreChip score={e.score} scale={3} />
                      </div>
                    ))}
                  </div>
                </SectionGroup>
              )}

              {/* 6. Goals */}
              {(data.goals?.length || 0) > 0 && (
                <SectionGroup title={`Goals · ${tp.school_year || ''}`}>
                  {data.goals.map(g => {
                    const isWig = g.goal_type === 'WIG'
                    const accent = isWig ? '#e47727' : '#002f60'
                    return (
                      <div key={g.id} className="border-l-[3px] pl-3 pr-3 py-2 mb-2 rounded bg-gray-50"
                           style={{ borderColor: accent }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                                style={{ background: accent }}>{g.goal_type}</span>
                          {g.status ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{g.status}</span>
                          ) : null}
                        </div>
                        <div className="text-sm text-gray-800 leading-snug">{g.goal_text}</div>
                      </div>
                    )
                  })}
                </SectionGroup>
              )}

              {/* Unmapped — only show if we have leftover scores; helps Scott see
                  what sections still need a label mapping. */}
              {(data.sections?.unmapped?.entries?.length || 0) > 0 && (
                <SectionGroup title={data.sections.unmapped.label}>
                  <div className="text-[11px] text-gray-500 mb-2">Score rows not yet mapped to a known section.</div>
                  {data.sections.unmapped.entries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between border border-gray-200 rounded-md px-3 py-1.5 mb-1 text-xs text-gray-600">
                      <div>mid={String(e.mid).slice(0,12)}… · group={String(e.measurement_group || '').slice(0,8)}…</div>
                      <div className="font-bold">{e.score}</div>
                    </div>
                  ))}
                </SectionGroup>
              )}

              {/* Provenance footer */}
              <div className="text-[11px] text-gray-400 mt-4 pt-3 border-t border-gray-100">
                Touchpoint ID: {data.id}<br />
                {data.grow_id ? <>Grow ID: {data.grow_id}<br /></> : null}
                Source: <span className="font-semibold">scores_v2</span> + Grow narrative cache
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function SectionGroup({ title, children }) {
  return (
    <div className="mt-4 pmap-section">
      <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">{title}</div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------
// 25-26 archive PMAP layout — mirrors `PMAP Teacher.pdf` form structure:
//   1. Meeting Checklist
//   2. WIG + Annual Goals Review (text + per-goal track + Progress Toward Goal)
//   3. Whirlwind Work Review
//   4. FLS Teacher Rubric (T1-T5 + Additional Comments + TR Strength/Growth)
//   5. Commitments (CS Strength + CGA Growth)
//   6. Professional Development (Career Goals + Licenses)
//   7. Area(s) of Concern
// Goals embedded inside Section 2; Action Steps NOT embedded (per Scott's spec).
// Driven by `data.pmap_2526.fields` assembled server-side.
// ---------------------------------------------------------------
function NativePMAPSections({ data, tp }) {
  const p = data.pmap_2526 || {}
  const F = p.fields || {}
  const goals = p.goals || []
  const dims5 = p.rubric_5pt_dims || []

  // Form-type variants (all share the 25-26 form shell, with differences):
  //   Teacher (pmap_teacher / self_reflection_teacher):   T1-T5 rubric · TR Strength/Growth · Licenses
  //   Leader (pmap_leader / self_reflection_leader):       L1-L5 rubric · PLS/PLGA Personal Leadership · NO Licenses
  //   Network (pmap_network / self_reflection_network):    NO rubric · PLS/PLGA Personal Leadership · NO Licenses
  //   Support (pmap_support / self_reflection_support):    NO rubric · NO Personal Leadership · NO Licenses (simplest)
  // SR variants of all four: drop Area of Concern + add Self Reflection: Additional Comments at bottom.
  const isLeaderForm = tp.form_type === 'pmap_leader' || tp.form_type === 'self_reflection_leader'
  const isNetworkForm = tp.form_type === 'pmap_network' || tp.form_type === 'self_reflection_network'
  const isSupportForm = tp.form_type === 'pmap_support' || tp.form_type === 'self_reflection_support'
  const isPreKForm = tp.form_type === 'pmap_prek' || tp.form_type === 'self_reflection_prek'
  const isSR = tp.form_type && tp.form_type.startsWith('self_reflection_')
  const hasPersonalLeadership = isLeaderForm || isNetworkForm  // Support + PreK have none
  const hasFiveDimRubric = !isNetworkForm && !isSupportForm && !isPreKForm  // PreK uses 7pt CLASS instead
  const hasPreKCycles = isPreKForm  // 3 CLASS observation cycles
  const hasRubric = hasFiveDimRubric || hasPreKCycles
  const hasLicenses = !isLeaderForm && !isNetworkForm && !isSupportForm  // Teacher + PreK + SR variants
  // Aliases for backward compat with existing callsites
  const isLeader = isLeaderForm
  const isNetwork = isNetworkForm

  // Compute section numbers dynamically since variants skip different sections
  let _n = 4
  let rubricNum = null
  let cycleNums = null
  let prekRubricNum = null
  if (hasPreKCycles) {
    cycleNums = [_n++, _n++, _n++]  // Cycle 1, 2, 3 each get their own section
    prekRubricNum = _n++  // FLS PreK Class Rubric Review (PKS/PKGA)
  } else if (hasFiveDimRubric) {
    rubricNum = _n++
  }
  const personalLeadershipNum = hasPersonalLeadership ? _n++ : null
  const commitmentsNum = _n++
  const proDevNum = _n++
  const finalNum = _n++  // Concern (PMAP) or Additional Comments (SR)

  const NarrField = ({ k, fallbackEmpty = false, emptyAs = null }) => {
    const f = F[k]; if (!f) return null
    const html = f.html || ''
    const showEmptyAs = !html && emptyAs
    return (
      <div className="mb-3 pmap-narr-block">
        <div className="text-[12px] font-bold text-gray-800 mb-1">{f.label}</div>
        {f.placeholder && !showEmptyAs && <div className="text-[11px] text-gray-400 italic mb-1">{f.placeholder}</div>}
        {html ? (
          <div className="bg-gray-50 border-l-[3px] border-fls-navy pl-3 pr-3 py-2 rounded text-sm text-gray-800 leading-relaxed"
               dangerouslySetInnerHTML={{ __html: html }} />
        ) : showEmptyAs ? (
          <div className="bg-gray-50 border-l-[3px] border-fls-navy pl-3 pr-3 py-2 rounded text-sm text-gray-800">{emptyAs}</div>
        ) : fallbackEmpty ? (
          <div className="bg-gray-50 border-l-[3px] border-gray-200 pl-3 pr-3 py-2 rounded text-xs text-gray-400 italic">Empty for this PMAP</div>
        ) : null}
      </div>
    )
  }

  const TrackChip = ({ score }) => {
    if (score == null) return <span className="text-xs text-gray-400 italic">No Score</span>
    const isOn = score >= 2
    const c = isOn ? '#15803d' : '#b91c1c'
    const bg = isOn ? '#22c55e1f' : '#ef44441f'
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap"
            style={{ background: bg, color: c }}>
        {isOn ? '2 — On Track' : '1 — Off Track'}
      </span>
    )
  }

  const RubricChip = ({ score }) => {
    if (score == null) return <span className="text-xs text-gray-400 italic">No Score</span>
    const palette = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }
    const labels = { 1: 'Needs Improvement', 2: 'Emerging', 3: 'Developing', 4: 'Proficient', 5: 'Exemplary' }
    const s = Math.round(score); const c = palette[s] || '#6b7280'
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-bold whitespace-nowrap"
            style={{ background: c + '1f', color: c }}>
        {score}<span className="opacity-50 font-medium">/5 · {labels[s] || ''}</span>
      </span>
    )
  }

  // 1-7 CLASS rubric chip (PreK only). Low=1-2, Mid=3-5, High=6-7.
  const ClassChip = ({ score }) => {
    if (score == null) return <span className="text-xs text-gray-400 italic">No Score</span>
    const palette = { 1:'#ef4444', 2:'#f97316', 3:'#eab308', 4:'#84cc16', 5:'#22c55e', 6:'#0ea5e9', 7:'#3b82f6' }
    const labels = { 1:'Low', 2:'Low', 3:'Mid-Low', 4:'Mid', 5:'Mid', 6:'Mid-High', 7:'High' }
    const s = Math.round(score); const c = palette[s] || '#6b7280'
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-bold whitespace-nowrap"
            style={{ background: c + '1f', color: c }}>
        {score}<span className="opacity-50 font-medium">/7 · {labels[s] || ''}</span>
      </span>
    )
  }

  const GoalCardWithTrack = ({ goal }) => {
    const isWig = goal.goal_type === 'WIG'
    const accent = isWig ? '#e47727' : '#002f60'
    const trackKey = { WIG: 'wig_track', AG1: 'ag1_track', AG2: 'ag2_track', AG3: 'ag3_track' }[goal.goal_type]
    const trackScore = F[trackKey]?.score
    return (
      <div className="border-l-[3px] pl-3 pr-3 py-2 mb-2 rounded bg-gray-50 pmap-narr-block" style={{ borderColor: accent }}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                  style={{ background: accent }}>{goal.goal_type}</span>
            {goal.status && (
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{goal.status}</span>
            )}
          </div>
          <TrackChip score={trackScore} />
        </div>
        <div className="text-sm text-gray-800 leading-snug">{goal.goal_text}</div>
      </div>
    )
  }

  const CheckboxField = ({ k, emptyAs = null }) => {
    const f = F[k]; if (!f) return null
    const value = f.selected || emptyAs
    return (
      <div className="text-sm mb-2"><strong>{f.label}</strong> &nbsp; {value || <span className="text-gray-400 italic">Not answered</span>}</div>
    )
  }

  return (
    <>
      {/* 1. Meeting Checklist */}
      <SectionGroup title="1. Meeting Checklist">
        <CheckboxField k="mc_job_desc_reviewed" />
      </SectionGroup>

      {/* 2. WIG + Annual Goals Review */}
      <SectionGroup title="2. WIG + Annual Goals Review">
        <NarrField k="wig_ag_text" />
        {goals.map(g => <GoalCardWithTrack key={g.id} goal={g} />)}
        <NarrField k="progress_toward_goal" />
      </SectionGroup>

      {/* 3. Whirlwind Work Review */}
      <SectionGroup title="3. Whirlwind Work Review (Other Workstreams)">
        <NarrField k="whirlwind_workstreams" />
      </SectionGroup>

      {/* PreK: 3 separate CLASS observation cycle sections, each with PK1-PK10 on 1-7 scale */}
      {hasPreKCycles && (p.prek_cycles || []).map((cyc, idx) => (
        <SectionGroup key={cyc.cycle} title={`${cycleNums[idx]}. CLASS Observation Cycle ${cyc.cycle}`}>
          <div className="text-[11px] text-gray-500 mb-2 italic">FLS PreK CLASS Rubric (1-7 scale)</div>
          {cyc.dims.map(dimRow => (
            <div key={dimRow.dim} className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-2.5 mb-1.5 pmap-dim-card">
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-gray-800">{dimRow.dim}</span>
                <span className="text-sm text-gray-600"> · {dimRow.name}</span>
              </div>
              <ClassChip score={dimRow.score} />
            </div>
          ))}
        </SectionGroup>
      ))}

      {/* PreK Rubric Review — PKS/PKGA replaces TR for PreK */}
      {hasPreKCycles && (
        <SectionGroup title={`${prekRubricNum}. FLS PreK Class Rubric Review`}>
          <NarrField k="tr_strength" />
          <NarrField k="tr_growth" />
        </SectionGroup>
      )}

      {/* Rubric — Teacher: FLS Teacher Rubric · Leader: Leadership Competencies · Network/Support/PreK: skipped */}
      {hasFiveDimRubric && (
      <SectionGroup title={`${rubricNum}. ${isLeader ? 'Firstline Leadership Competencies' : 'FLS Teacher Rubric'}`}>
        {dims5.map(d => (
          <div key={d.dim} className="flex items-start justify-between gap-3 border border-gray-200 rounded-lg p-3 mb-2 pmap-dim-card">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{d.dim} · {dimName(d.dim)}</div>
            </div>
            <RubricChip score={d.score} />
          </div>
        ))}
        {/* Additional Comments — empty for many records but always shown so structure is clear */}
        <div className="mt-3">
          <div className="text-[12px] font-bold text-gray-800 mb-1">Additional Comments</div>
          <div className="text-[11px] text-gray-400 italic mb-1">Please provide any additional notes or context here.</div>
          <div className="bg-gray-50 border-l-[3px] border-gray-200 pl-3 pr-3 py-2 rounded text-xs text-gray-400 italic">Empty for this record</div>
        </div>
        {/* Teacher + SR show TR Strength/Growth here. Leader doesn't (replaced by Personal Leadership block in Section 5). PreK shows them separately as PKS/PKGA. */}
        {!hasPersonalLeadership && !hasPreKCycles && (
          <div className="mt-3">
            <NarrField k="tr_strength" />
            <NarrField k="tr_growth" />
          </div>
        )}
      </SectionGroup>
      )}

      {/* Personal Leadership — Leader + Network show PLS/PLGA. Teacher/SR Teacher show TR above. Support has none. */}
      {hasPersonalLeadership && (
        <SectionGroup title={`${personalLeadershipNum}. FLS Personal Leadership`}>
          <NarrField k="pls_strength" />
          <NarrField k="plga_growth" />
        </SectionGroup>
      )}

      {/* Commitments */}
      <SectionGroup title={`${commitmentsNum}. Commitments`}>
        <NarrField k="commit_strength" />
        <NarrField k="commit_growth" />
      </SectionGroup>

      {/* Professional Development & Career Growth — Licenses only on Teacher/SR Teacher */}
      <SectionGroup title={`${proDevNum}. Professional Development & Career Growth`}>
        <NarrField k="career_goals" />
        {hasLicenses && (isSR ? <NarrField k="licenses_sr" /> : <NarrField k="licenses" />)}
      </SectionGroup>

      {/* SR-only Additional Comments at bottom */}
      {isSR && (
        <SectionGroup title={`${finalNum}. Additional Comments`}>
          <NarrField k="sr_additional_comments" />
        </SectionGroup>
      )}

      {/* Area of Concern — all PMAPs have it; SR doesn't */}
      {!isSR && (
        <SectionGroup title={`${finalNum}. Area(s) of Concern`}>
          <CheckboxField k="ac_concerns" emptyAs="None" />
          <NarrField k="concern_comments" emptyAs="None" />
        </SectionGroup>
      )}

      {/* Provenance footer */}
      <div className="text-[11px] text-gray-400 mt-4 pt-3 border-t border-gray-100">
        Touchpoint ID: {data.id}<br />
        {data.grow_id ? <>Grow ID: {data.grow_id}<br /></> : null}
        Source: <span className="font-semibold">scores_v2</span> + Grow narrative cache + 25-26 form labels
      </div>
    </>
  )
}

export default function TouchpointDetail({ touchpoint, onClose }) {
  if (!touchpoint) return null

  const tp = touchpoint

  // Evaluation modal — handles PMAP + Self-Reflection. Branches internally on
  // school_year (24-25 archive vs 25-26 form) and on form_type within the
  // NativePMAPSections (Teacher / Leader / SR variants).
  const isEvalForm = tp.form_type && (tp.form_type.startsWith('pmap_') || tp.form_type.startsWith('self_reflection_'))
  if (isEvalForm) {
    return <ArchivePMAPView touchpoint={tp} onClose={onClose} />
  }

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
