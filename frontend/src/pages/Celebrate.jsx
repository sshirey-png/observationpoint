import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import { api } from '../lib/api'

/**
 * Celebrate — praise/recognition touchpoint.
 * Port of prototypes/celebrate.html.
 * Linked to FLS commitments, tags, share level, public recognition, personal note.
 */

const COMMITMENTS = [
  'We Keep Learning',
  'We Work Together',
  'We are Helpful',
  'We are the Safekeepers',
  'We Share Joy',
  'We Show Results',
]

const TAGS = ['Instruction', 'Culture', 'Leadership', 'Collaboration', 'Growth', 'Above & Beyond']

const SHARE_LEVELS = ['Teacher Only', 'Team', 'School']

const RECOGNITION_OPTIONS = ['Newsletter', 'This Week at FirstLine (TWAF)', 'Huddle Shout Out', 'Other']

export default function Celebrate() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)
  const [note, setNote] = useState('')
  const [commitments, setCommitments] = useState([])
  const [tags, setTags] = useState([])
  const [shareLevel, setShareLevel] = useState('Teacher Only')
  const [recognition, setRecognition] = useState({})
  const [personalNote, setPersonalNote] = useState('')
  const [showPersonalNote, setShowPersonalNote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  function toggleList(list, setList, item) {
    setList(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
  }

  function toggleRecognition(option) {
    setRecognition(prev => {
      const next = { ...prev }
      if (next[option] !== undefined) { delete next[option] } else { next[option] = '' }
      return next
    })
  }

  async function submit() {
    if (!teacher || !note.trim()) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'celebrate',
        teacher_email: teacher.email,
        school: teacher.school || '',
        notes: note,
        feedback: JSON.stringify({
          commitments,
          tags,
          share_level: shareLevel,
          recognition,
          personal_note: personalNote,
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
          <div className="text-5xl mb-2.5">🎉</div>
          <div className="text-xl font-bold mb-1">Celebration Sent!</div>
          <div className="text-sm text-gray-500 mb-5">
            {teacher?.first_name} {teacher?.last_name} has been notified
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
      <Nav title="Celebrate" />
      <StaffPicker selected={teacher} onSelect={setTeacher} initialEmail={teacherParam} />

      <div className="px-4 pt-4">
        <div className="text-base font-bold mb-1">Celebrate / Praise</div>
        <div className="text-xs text-gray-400 mb-3.5">Recognize a win. Teachers see these on their profile.</div>

        {/* What are you celebrating? */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            What are you celebrating?
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you see? Be specific — this goes directly to the teacher."
            rows={3}
            autoFocus
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>

        {/* FLS Commitments */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Linked to FLS Commitment (optional)
          </div>
          <div className="space-y-1.5">
            {COMMITMENTS.map(c => (
              <button
                key={c}
                onClick={() => toggleList(commitments, setCommitments, c)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition-all ${
                  commitments.includes(c)
                    ? 'bg-fls-orange/10 text-fls-orange'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                  commitments.includes(c) ? 'bg-fls-orange border-fls-orange' : 'border-gray-300'
                }`} />
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Tags</div>
          <div className="flex flex-wrap gap-2">
            {TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleList(tags, setTags, tag)}
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

        {/* Share level */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Share with</div>
          <div className="flex gap-2">
            {SHARE_LEVELS.map(level => (
              <button
                key={level}
                onClick={() => setShareLevel(level)}
                className={`flex-1 py-3 rounded-[10px] text-[13px] font-semibold border transition-all ${
                  shareLevel === level
                    ? 'bg-fls-navy border-fls-navy text-white'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Public Recognition */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
            Public Recognition
          </div>
          <div className="text-xs text-gray-500 mb-2.5">Track where this shout-out was shared publicly</div>
          <div className="space-y-2">
            {RECOGNITION_OPTIONS.map(opt => (
              <div key={opt}>
                <label className="flex items-center gap-2 text-[13px] font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recognition[opt] !== undefined}
                    onChange={() => toggleRecognition(opt)}
                    className="w-4 h-4 accent-fls-navy"
                  />
                  {opt}
                </label>
                {recognition[opt] !== undefined && (
                  <input
                    type="text"
                    value={recognition[opt]}
                    onChange={(e) => setRecognition(prev => ({ ...prev, [opt]: e.target.value }))}
                    placeholder={opt === 'Other' ? 'Where and why?' : 'Add context...'}
                    className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:border-fls-orange"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Send a note */}
        <div
          className="bg-green-50 border border-green-200 rounded-xl p-4 mb-3 cursor-pointer"
          onClick={() => setShowPersonalNote(!showPersonalNote)}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center shrink-0">
              <svg width="16" height="16" fill="none" stroke="white" strokeWidth="2">
                <path d="M4 14l2-2h7a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v9z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-green-600">Send them a note now!</div>
              <div className="text-[11px] text-gray-500">Write a personal message directly to the teacher</div>
            </div>
          </div>
          {showPersonalNote && (
            <textarea
              value={personalNote}
              onChange={(e) => { e.stopPropagation(); setPersonalNote(e.target.value) }}
              onClick={(e) => e.stopPropagation()}
              placeholder={`Hey ${teacher?.first_name || 'there'} — just wanted you to know...`}
              rows={3}
              className="w-full mt-3 px-3 py-3 border border-green-200 rounded-[10px] text-sm outline-none focus:border-green-400 resize-y placeholder:text-gray-400"
            />
          )}
        </div>
      </div>

      {/* Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] z-50">
        <button
          onClick={submit}
          disabled={!teacher || !note.trim() || saving}
          className="w-full py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Send Celebration'}
        </button>
      </div>
    </div>
  )
}
