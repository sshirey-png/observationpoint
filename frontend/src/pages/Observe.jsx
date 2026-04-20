import { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import RubricCard from '../components/RubricCard'
import RecordingBar from '../components/RecordingBar'
import ActionSteps from '../components/ActionSteps'
import { api } from '../lib/api'
import { TEACHER_RUBRIC } from '../lib/rubric-descriptors'
import FormShell from '../components/FormShell'

/**
 * Observe — the teacher observation form.
 * Faithful port of prototypes/teacher-observation.html.
 *
 * Flow: pick teacher → record (optional) → notes → score T1-T5 →
 *       feedback (See It / Do It) → action step → publish
 */
export default function Observe() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  // Form state
  const [teacher, setTeacher] = useState(null)
  const [scores, setScores] = useState({})
  const [notes, setNotes] = useState('')
  const [seeItSuccess, setSeeItSuccess] = useState('')
  const [seeItGrowth, setSeeItGrowth] = useState('')
  const [doItPractice, setDoItPractice] = useState('')
  const [actionStep, setActionStep] = useState(null)
  const [customStep, setCustomStep] = useState('')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function setScore(code, value) {
    setScores(prev => ({ ...prev, [code]: value }))
  }

  async function publish() {
    if (!teacher) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'observation_teacher',
        teacher_email: teacher.email,
        school: teacher.school || '',
        scores,
        notes,
        feedback: JSON.stringify({
          see_it_success: seeItSuccess,
          see_it_growth: seeItGrowth,
          do_it_practice: doItPractice,
        }),
        action_step: actionStep ? JSON.stringify(actionStep) : customStep || null,
      })
      setDone(true)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  // Success screen
  if (done) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-9 text-center mx-4 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3.5">
            <svg width="28" height="28" fill="none" stroke="#059669" strokeWidth="3">
              <path d="M7 14l5 5 10-10" />
            </svg>
          </div>
          <div className="text-xl font-bold mb-1">Published!</div>
          <div className="text-sm text-gray-500 mb-5">
            {teacher?.first_name} {teacher?.last_name} has been notified
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => navigate('/')}
              className="bg-fls-orange text-white px-8 py-3 rounded-xl font-semibold"
            >
              Done
            </button>
            <button
              onClick={() => {
                setDone(false); setTeacher(null); setScores({});
                setNotes(''); setSeeItSuccess(''); setSeeItGrowth('');
                setDoItPractice(''); setActionStep(null); setCustomStep('');
              }}
              className="border border-gray-200 px-6 py-3 rounded-xl font-semibold text-sm"
            >
              New Observation
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <FormShell>
    <div className="pb-24">
      <Nav title="Teacher Observation" />

      {/* Teacher picker + History link */}
      <StaffPicker selected={teacher} onSelect={setTeacher} initialEmail={teacherParam} />
      {teacher && (
        <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
          <Link
            to={`/app/staff/${teacher.email}`}
            target="_blank"
            className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-[11px] font-semibold text-fls-navy no-underline"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
              <path d="M3 8h10m-4-4 4 4-4 4" />
            </svg>
            History
          </Link>
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-100 text-blue-600">
            Teacher Obs
          </span>
        </div>
      )}

      <div className="px-4">
        {/* Recording bar */}
        <div className="mt-4">
          <RecordingBar onToggleAI={setAiEnabled} />
        </div>

        {/* Notes */}
        <div className="mt-4">
          <div className="text-[13px] font-semibold mb-1.5">Observation Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Type observations here..."
            rows={3}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Rubric */}
        <div className="text-base font-bold mb-1">FLS Teacher Rubric</div>
        <div className="text-xs text-gray-400 mb-3">
          Score at least one area. A rating of 1 requires explanation.
        </div>

        {TEACHER_RUBRIC.map((dim) => (
          <RubricCard
            key={dim.code}
            code={dim.code}
            name={dim.name}
            question={dim.question}
            descriptors={dim.descriptors}
            required={dim.required}
            value={scores[dim.code] || null}
            onChange={(v) => setScore(dim.code, v)}
          />
        ))}

        <div className="h-px bg-gray-200 my-5" />

        {/* Feedback */}
        <div className="text-base font-bold mb-3">Observation Feedback</div>

        <div className="mb-3.5">
          <div className="text-[13px] font-semibold mb-1.5">See It / Name It: Success</div>
          <textarea
            value={seeItSuccess}
            onChange={(e) => setSeeItSuccess(e.target.value)}
            placeholder="What's working well in this classroom?"
            rows={2}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="mb-3.5">
          <div className="text-[13px] font-semibold mb-1.5">See It / Name It: Area(s) of Growth</div>
          <textarea
            value={seeItGrowth}
            onChange={(e) => setSeeItGrowth(e.target.value)}
            placeholder="Where is there opportunity to grow?"
            rows={2}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="mb-3.5">
          <div className="text-[13px] font-semibold mb-1.5">Do It: What did you practice?</div>
          <textarea
            value={doItPractice}
            onChange={(e) => setDoItPractice(e.target.value)}
            placeholder="What was practiced during the debrief?"
            rows={2}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Action Steps */}
        <div className="text-base font-bold mb-1">Action Step</div>
        <div className="text-xs text-gray-400 mb-3">
          Select a rubric area, then choose an action step from Get Better Faster
        </div>

        <ActionSteps
          selected={actionStep}
          onChange={setActionStep}
          customStep={customStep}
          onCustomChange={setCustomStep}
        />
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 z-50">
        <button
          onClick={async () => {
            if (!teacher) return
            setSaving(true)
            try {
              await api.post('/api/touchpoints', {
                form_type: 'observation_teacher',
                teacher_email: teacher.email,
                school: teacher.school || '',
                status: 'draft',
                is_published: false,
                scores,
                notes,
                feedback: JSON.stringify({
                  see_it_success: seeItSuccess,
                  see_it_growth: seeItGrowth,
                  do_it_practice: doItPractice,
                }),
                action_step: actionStep ? JSON.stringify(actionStep) : customStep || null,
              })
              alert('Draft saved')
            } catch (e) { alert('Draft save failed: ' + e.message) }
            setSaving(false)
          }}
          disabled={!teacher || saving}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold border border-gray-200 disabled:opacity-50"
        >
          Save Draft
        </button>
        <button
          onClick={publish}
          disabled={!teacher || saving || (!notes.trim() && !seeItSuccess.trim() && !seeItGrowth.trim() && !doItPractice.trim() && Object.keys(scores).length === 0)}
          title={!teacher ? 'Pick a teacher first' : 'Add at least a score, note, or narrative to publish'}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50 disabled:bg-gray-300"
        >
          {saving ? 'Saving…' : 'Publish'}
        </button>
      </div>
    </div>
    </FormShell>
  )
}
