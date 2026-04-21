import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import PreKRubricCard from './PreKRubricCard'
import { PREK_RUBRIC, PREK_CYCLE_FIELDS } from '../lib/rubric-descriptors'

/**
 * ObservePreKForm — CLASS PreK observation flow.
 * Rendered by Observe.jsx when the selected teacher has PreK in their job title.
 *
 * Three observation cycles per visit (CLASS protocol). Each cycle:
 *   - Metadata (students/adults/times/content/format)
 *   - PK1-PK10 scoring 1-7
 * Plus a shared observation note at the bottom.
 *
 * Saves as form_type = 'observation_prek'. Scores are saved per-cycle
 * using keys like "C1_PK1" (cycle 1, PK1). The whole structure is also
 * stashed in the feedback JSON for later display.
 */

const CYCLE_COUNT = 3  // CLASS protocol

function blankCycleInfo() {
  const info = {}
  for (const f of PREK_CYCLE_FIELDS) {
    info[f.id] = f.type === 'checkbox_group' ? [] : ''
  }
  return info
}

function CycleInfoCard({ cycleNum, info, onChange }) {
  function setField(id, val) { onChange({ ...info, [id]: val }) }
  function toggleInArray(id, option) {
    const curr = info[id] || []
    const next = curr.includes(option) ? curr.filter(x => x !== option) : [...curr, option]
    setField(id, next)
  }
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        {PREK_CYCLE_FIELDS.filter(f => f.type !== 'checkbox_group').map(f => (
          <div key={f.id}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{f.label}</div>
            <input
              type={f.type}
              value={info[f.id] || ''}
              onChange={e => setField(f.id, e.target.value)}
              placeholder={f.type === 'number' ? '0' : ''}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-fls-orange"
            />
          </div>
        ))}
      </div>
      {PREK_CYCLE_FIELDS.filter(f => f.type === 'checkbox_group').map(f => (
        <div key={f.id} className="mb-3 last:mb-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{f.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {f.options.map(opt => {
              const on = (info[f.id] || []).includes(opt)
              return (
                <button key={opt} type="button" onClick={() => toggleInArray(f.id, opt)}
                  className={`text-[12px] font-semibold px-2.5 py-1 rounded-md border transition ${
                    on ? 'bg-fls-navy text-white border-fls-navy' : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >{opt}</button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ObservePreKForm({ teacher, onCancel }) {
  const navigate = useNavigate()
  const [activeCycle, setActiveCycle] = useState(1)
  const [cycles, setCycles] = useState(() => {
    const out = {}
    for (let i = 1; i <= CYCLE_COUNT; i++) {
      out[i] = { info: blankCycleInfo(), scores: {} }
    }
    return out
  })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function setCycleInfo(n, info) { setCycles(c => ({ ...c, [n]: { ...c[n], info } })) }
  function setCycleScore(n, code, value) {
    setCycles(c => ({ ...c, [n]: { ...c[n], scores: { ...c[n].scores, [code]: value } } }))
  }

  // Flatten all scores into keys like "C1_PK1" so they fit our scores table schema
  function flattenScores() {
    const flat = {}
    for (let i = 1; i <= CYCLE_COUNT; i++) {
      for (const [code, v] of Object.entries(cycles[i].scores || {})) {
        if (v != null) flat[`C${i}_${code}`] = v
      }
    }
    return flat
  }

  // Validation: at least cycle 1 needs some scores entered
  const cycle1Scored = Object.values(cycles[1].scores).some(v => v != null)
  const canPublish = !!teacher && !saving && cycle1Scored

  async function publish() {
    if (!canPublish) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'observation_prek',
        teacher_email: teacher.email,
        school: teacher.school || '',
        scores: flattenScores(),
        notes,
        feedback: JSON.stringify({ cycles }),
      })
      setDone(true)
    } catch (e) { alert('Failed to save: ' + e.message) }
    setSaving(false)
  }

  if (done) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-9 text-center mx-4 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3.5">
            <svg width="28" height="28" fill="none" stroke="#059669" strokeWidth="3"><path d="M7 14l5 5 10-10" /></svg>
          </div>
          <div className="text-xl font-bold mb-1">Published!</div>
          <div className="text-sm text-gray-500 mb-5">{teacher?.first_name} {teacher?.last_name} has been notified</div>
          <button onClick={() => navigate('/')} className="bg-fls-orange text-white px-8 py-3 rounded-xl font-semibold">Done</button>
        </div>
      </div>
    )
  }

  // Group dimensions by domain (for rubric section headers)
  const byDomain = {}
  for (const d of PREK_RUBRIC) {
    const dom = d.domain || 'Other'
    if (!byDomain[dom]) byDomain[dom] = []
    byDomain[dom].push(d)
  }

  return (
    <div className="pb-24">
      {/* Teacher banner */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
        <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-pink-100 text-pink-700">CLASS PreK</span>
        <div className="text-[11px] text-gray-500 truncate">{teacher?.first_name} {teacher?.last_name} · {teacher?.school}</div>
      </div>

      <div className="px-4">
        {/* Cycle tabs */}
        <div className="mt-4 mb-3 flex gap-2">
          {[1, 2, 3].map(n => {
            const hasScores = Object.values(cycles[n].scores).some(v => v != null)
            return (
              <button key={n} onClick={() => setActiveCycle(n)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${
                  activeCycle === n ? 'bg-fls-navy text-white' : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                Cycle {n}{hasScores ? ' ·' : ''}
              </button>
            )
          })}
        </div>

        {/* Active cycle info */}
        <div className="text-base font-bold mb-2">Cycle {activeCycle} · Information</div>
        <CycleInfoCard
          cycleNum={activeCycle}
          info={cycles[activeCycle].info}
          onChange={(info) => setCycleInfo(activeCycle, info)}
        />

        {/* CLASS scoring for active cycle */}
        <div className="text-base font-bold mt-4 mb-1">Cycle {activeCycle} · CLASS Scoring</div>
        <div className="text-xs text-gray-400 mb-3">Score 1-7 for each dimension</div>

        {Object.entries(byDomain).map(([domain, dims]) => (
          <div key={domain}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mt-3 mb-2 pt-2 border-t border-gray-100">
              {domain}
            </div>
            {dims.map(dim => (
              <PreKRubricCard
                key={dim.code}
                code={dim.code}
                name={dim.name}
                descriptors={dim.descriptors}
                required={true}
                value={cycles[activeCycle].scores[dim.code] || null}
                onChange={v => setCycleScore(activeCycle, dim.code, v)}
              />
            ))}
          </div>
        ))}

        {/* Shared observation note */}
        <div className="text-base font-bold mt-4 mb-2">Observation Note</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Provide additional details or context here (applies to the full visit)"
            rows={4}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-fls-orange resize-y"
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 z-50">
        <button
          onClick={async () => {
            if (!teacher) return
            setSaving(true)
            try {
              await api.post('/api/touchpoints', {
                form_type: 'observation_prek',
                teacher_email: teacher.email,
                school: teacher.school || '',
                status: 'draft',
                is_published: false,
                scores: flattenScores(),
                notes,
                feedback: JSON.stringify({ cycles }),
              })
              alert('Draft saved')
            } catch (e) { alert('Draft save failed: ' + e.message) }
            setSaving(false)
          }}
          disabled={!teacher || saving}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold border border-gray-200 disabled:opacity-50">
          Save Draft
        </button>
        <button
          onClick={publish}
          disabled={!canPublish}
          title={!cycle1Scored ? 'Score at least Cycle 1 to publish' : ''}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50 disabled:bg-gray-300"
        >
          {saving ? 'Saving…' : 'Publish'}
        </button>
      </div>
    </div>
  )
}
