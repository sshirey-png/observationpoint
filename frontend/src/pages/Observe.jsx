import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import RubricCard from '../components/RubricCard'
import { api } from '../lib/api'

/**
 * Observe — the teacher observation form.
 * This is the core product experience: leader walks into classroom,
 * picks teacher, scores T1-T5, writes feedback, publishes.
 *
 * State lives here. Child components receive props and call onChange.
 */

const RUBRIC = [
  { code: 'T1', name: 'On Task', question: 'Are all students engaged in the work of the lesson from start to finish?', required: true },
  { code: 'T2', name: 'Community of Learners', question: 'Are all students active members of a joyful and supportive classroom community?' },
  { code: 'T3', name: 'Essential Content', question: 'Are all students working with content aligned to appropriate standards?' },
  { code: 'T4', name: 'Cognitive Engagement', question: 'Are all students responsible for doing the thinking?' },
  { code: 'T5', name: 'Demonstration of Learning', question: 'Do all students demonstrate that they are learning?' },
]

export default function Observe() {
  const navigate = useNavigate()

  // All form state in one place
  const [teacher, setTeacher] = useState(null)
  const [scores, setScores] = useState({})
  const [notes, setNotes] = useState('')
  const [seeItSuccess, setSeeItSuccess] = useState('')
  const [seeItGrowth, setSeeItGrowth] = useState('')
  const [doItPractice, setDoItPractice] = useState('')
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
      })
      setDone(true)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

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
          <button
            onClick={() => navigate('/app/team')}
            className="bg-fls-orange text-white px-8 py-3 rounded-xl font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-24">
      <Nav title="Teacher Observation" />

      {/* Step 1: Pick teacher */}
      <StaffPicker selected={teacher} onSelect={setTeacher} />

      <div className="px-4">
        {/* Notes */}
        <div className="mt-4">
          <div className="text-[13px] font-semibold mb-1.5">Observation Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Type observations here..."
            rows={3}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm font-[Inter] outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Rubric */}
        <div className="text-base font-bold mb-1">FLS Teacher Rubric</div>
        <div className="text-xs text-gray-400 mb-3">
          Score at least one area. A rating of 1 requires explanation.
        </div>

        {RUBRIC.map((dim) => (
          <RubricCard
            key={dim.code}
            code={dim.code}
            name={dim.name}
            question={dim.question}
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
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm font-[Inter] outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="mb-3.5">
          <div className="text-[13px] font-semibold mb-1.5">See It / Name It: Area(s) of Growth</div>
          <textarea
            value={seeItGrowth}
            onChange={(e) => setSeeItGrowth(e.target.value)}
            placeholder="Where is there opportunity to grow?"
            rows={2}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm font-[Inter] outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="mb-3.5">
          <div className="text-[13px] font-semibold mb-1.5">Do It: What did you practice?</div>
          <textarea
            value={doItPractice}
            onChange={(e) => setDoItPractice(e.target.value)}
            placeholder="What was practiced during the debrief?"
            rows={2}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm font-[Inter] outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 z-50">
        <button
          onClick={() => alert('Draft saved')}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold border border-gray-200"
        >
          Save Draft
        </button>
        <button
          onClick={publish}
          disabled={!teacher || saving}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Publish'}
        </button>
      </div>
    </div>
  )
}
