import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import { api } from '../lib/api'

/**
 * QuickFeedback — lightweight touchpoint. No rubric, no scoring.
 * Just a note with tags and share/private toggle.
 * Faithful port of prototypes/quick-feedback.html.
 */

const TAGS = ['Culture', 'Instruction', 'Routines', 'Engagement', 'Kagan', 'Pacing', 'Content', 'Feedback to Students']

export default function QuickFeedback() {
  const navigate = useNavigate()
  const [teacher, setTeacher] = useState(null)
  const [note, setNote] = useState('')
  const [tags, setTags] = useState([])
  const [shared, setShared] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function toggleTag(tag) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  async function submit() {
    if (!teacher || !note.trim()) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'quick_feedback',
        teacher_email: teacher.email,
        school: teacher.school || '',
        notes: note,
        feedback: JSON.stringify({ tags, shared }),
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
          <div className="text-xl font-bold mb-1">Feedback Sent!</div>
          <div className="text-sm text-gray-500 mb-5">
            {shared ? `${teacher?.first_name} has been notified` : 'Saved as private note'}
          </div>
          <button
            onClick={() => navigate('/')}
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
      <Nav title="Quick Feedback" />
      <StaffPicker selected={teacher} onSelect={setTeacher} />

      <div className="px-4 pt-4">
        <div className="text-base font-bold mb-1">Quick Feedback</div>
        <div className="text-xs text-gray-400 mb-3.5">A quick touchpoint — no rubric, no scoring. Just a note.</div>

        {/* Note */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            What did you observe?
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Quick observation or feedback for the teacher..."
            rows={4}
            autoFocus
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        {/* Tags */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Tags
          </div>
          <div className="flex flex-wrap gap-2">
            {TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-3.5 py-2 rounded-full text-[13px] font-medium border transition-all active:scale-95 ${
                  tags.includes(tag)
                    ? 'bg-fls-orange text-white border-fls-orange'
                    : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Share / Private */}
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Share with teacher?
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShared(true)}
              className={`flex-1 py-3 rounded-[10px] text-[13px] font-semibold border transition-all ${
                shared
                  ? 'bg-fls-navy border-fls-navy text-white'
                  : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              Share
            </button>
            <button
              onClick={() => setShared(false)}
              className={`flex-1 py-3 rounded-[10px] text-[13px] font-semibold border transition-all ${
                !shared
                  ? 'bg-fls-navy border-fls-navy text-white'
                  : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              Private
            </button>
          </div>
        </div>
      </div>

      {/* Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] z-50">
        <button
          onClick={submit}
          disabled={!teacher || !note.trim() || saving}
          className="w-full py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  )
}
