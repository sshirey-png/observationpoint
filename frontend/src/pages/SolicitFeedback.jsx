import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import { api } from '../lib/api'

/**
 * SolicitFeedback — ask a teacher for feedback.
 * Port of prototypes/solicited-feedback.html.
 * Pre-built question templates, custom question, sustainability + flight risk pulse.
 */

const QUESTIONS = [
  'How is your workload right now?',
  'How are you feeling about your goals?',
  'What support do you need from me?',
  'How is the team culture feeling?',
  'Custom question',
]

const SCORE_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#22c55e', 5: '#0ea5e9' }

function PulseScale({ label, lowLabel, midLabel, highLabel, value, onChange }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5">{label}</div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map(n => {
          const selected = value === n
          const labels = { 1: lowLabel, 3: midLabel, 5: highLabel }
          return (
            <button
              key={n}
              onClick={() => onChange(value === n ? null : n)}
              className="flex-1 py-3 rounded-lg border-2 text-center transition-all active:scale-90"
              style={{
                borderColor: selected ? SCORE_COLORS[n] : '#e5e7eb',
                background: selected ? SCORE_COLORS[n] : '#fff',
              }}
            >
              <span className="block text-lg font-bold" style={{ color: selected ? '#fff' : '#9ca3af' }}>{n}</span>
              {labels[n] && (
                <span className="block text-[8px] font-semibold uppercase" style={{ color: selected ? '#fff' : '#9ca3af' }}>
                  {labels[n]}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function SolicitFeedback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)
  const [selectedQuestion, setSelectedQuestion] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [context, setContext] = useState('')
  const [sustainability, setSustainability] = useState(null)
  const [flightRisk, setFlightRisk] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const isCustom = selectedQuestion === 'Custom question'

  async function submit() {
    if (!teacher || !selectedQuestion) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'solicited_feedback',
        teacher_email: teacher.email,
        school: teacher.school || '',
        notes: isCustom ? customQuestion : selectedQuestion,
        feedback: JSON.stringify({
          question: isCustom ? customQuestion : selectedQuestion,
          context,
          sustainability,
          flight_risk: flightRisk,
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
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3.5">
            <svg width="28" height="28" fill="none" stroke="#2563eb" strokeWidth="3">
              <path d="M4 13l3 3 9-9" />
            </svg>
          </div>
          <div className="text-xl font-bold mb-1">Feedback Request Sent!</div>
          <div className="text-sm text-gray-500 mb-5">
            {teacher?.first_name} will see this in ObservationPoint
          </div>
          <button onClick={() => navigate('/')} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-semibold">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-24">
      <Nav title="Solicit Feedback" />
      <StaffPicker selected={teacher} onSelect={setTeacher} initialEmail={teacherParam} />

      <div className="px-4 pt-4">
        <div className="text-base font-bold mb-1">Solicited Feedback</div>
        <div className="text-xs text-gray-400 mb-3.5">Ask the teacher for feedback. Their response shows up on your dashboard.</div>

        {/* Question templates */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Context — What are you asking about?
          </div>
          <div className="space-y-1.5">
            {QUESTIONS.map(q => (
              <button
                key={q}
                onClick={() => setSelectedQuestion(q)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition-all ${
                  selectedQuestion === q
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                  selectedQuestion === q ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                }`} />
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Custom question */}
        {isCustom && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Your Question</div>
            <textarea
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="Type your question for the teacher..."
              rows={3}
              autoFocus
              className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-blue-500 resize-y placeholder:text-gray-400"
            />
          </div>
        )}

        {/* Additional context */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Additional context (optional, visible to teacher)
          </div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Any background or context for the teacher..."
            rows={2}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-blue-500 resize-y placeholder:text-gray-400"
          />
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Pulse */}
        <div className="text-base font-bold mb-1">Quick Pulse (optional)</div>
        <div className="text-xs text-gray-400 mb-3">How would you rate this teacher's current engagement?</div>

        <PulseScale
          label="Sustainability — Is this teacher's workload sustainable?"
          lowLabel="Not at all"
          midLabel="Neutral"
          highLabel="Very"
          value={sustainability}
          onChange={setSustainability}
        />

        <PulseScale
          label="Flight Risk — How likely is this teacher to stay next year?"
          lowLabel="Leaving"
          midLabel="50/50"
          highLabel="Locked in"
          value={flightRisk}
          onChange={setFlightRisk}
        />
      </div>

      {/* Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] z-50">
        <button
          onClick={submit}
          disabled={!teacher || !selectedQuestion || (isCustom && !customQuestion.trim()) || saving}
          className="w-full py-3.5 rounded-xl text-sm font-semibold bg-blue-600 text-white disabled:opacity-50"
        >
          {saving ? 'Sending...' : 'Send to Teacher'}
        </button>
      </div>
    </div>
  )
}
