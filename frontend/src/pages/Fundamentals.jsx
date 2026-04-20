import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import { api } from '../lib/api'
import FormShell from '../components/FormShell'

/**
 * Fundamentals — 5-minute on-task observation.
 * Port of prototypes/fundamentals.html.
 * Timer, count-based input (total students + # on task per minute), yes/no status.
 */

export default function Fundamentals() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)
  const [classSize, setClassSize] = useState('')
  const [counts, setCounts] = useState(['', '', '', '', ''])
  const [timerRunning, setTimerRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [currentMinute, setCurrentMinute] = useState(0)
  const [onPace, setOnPace] = useState(null)
  const [locked, setLocked] = useState(null)
  const [relationship, setRelationship] = useState(null)
  const [skillsNotes, setSkillsNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const intervalRef = useRef(null)

  // Timer logic
  function toggleTimer() {
    if (timerRunning) {
      clearInterval(intervalRef.current)
      setTimerRunning(false)
    } else {
      setTimerRunning(true)
      intervalRef.current = setInterval(() => {
        setSeconds(prev => {
          const next = prev + 1
          if (next >= 300) {
            clearInterval(intervalRef.current)
            setTimerRunning(false)
          }
          return Math.min(next, 300)
        })
      }, 1000)
    }
  }

  function resetTimer() {
    clearInterval(intervalRef.current)
    setTimerRunning(false)
    setSeconds(0)
    setCurrentMinute(0)
    setCounts(['', '', '', '', ''])
  }

  // Update current minute from timer
  useEffect(() => {
    const min = Math.min(Math.floor(seconds / 60) + 1, 5)
    if (min !== currentMinute && seconds > 0) {
      setCurrentMinute(min)
    }
  }, [seconds])

  // Cleanup interval on unmount
  useEffect(() => () => clearInterval(intervalRef.current), [])

  function setCount(idx, val) {
    setCounts(prev => { const next = [...prev]; next[idx] = val; return next })
  }

  // Calculate percentages
  const total = parseInt(classSize) || 0
  const percents = counts.map(c => {
    const n = parseInt(c)
    if (isNaN(n) || total === 0) return null
    return Math.round((Math.min(n, total) / total) * 100)
  })
  const validPercents = percents.filter(p => p !== null)
  const avgPercent = validPercents.length
    ? Math.round(validPercents.reduce((a, b) => a + b, 0) / validPercents.length)
    : null

  const mm = Math.floor(seconds / 60)
  const ss = String(seconds % 60).padStart(2, '0')

  async function publish() {
    if (!teacher) return
    setSaving(true)
    const scores = {}
    counts.forEach((c, i) => {
      const pct = percents[i]
      if (pct !== null) scores[`M${i + 1}`] = pct
    })
    if (onPace !== null) scores.OP = onPace ? 1 : 0
    if (locked !== null) scores.FL = locked ? 1 : 0
    if (relationship !== null) scores.RB = relationship ? 1 : 0

    try {
      await api.post('/api/touchpoints', {
        form_type: 'observation_fundamentals',
        teacher_email: teacher.email,
        school: teacher.school || '',
        scores,
        notes: skillsNotes,
        feedback: JSON.stringify({ class_size: total }),
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
          <button onClick={() => navigate('/')} className="bg-fls-orange text-white px-8 py-3 rounded-xl font-semibold">
            Done
          </button>
        </div>
      </div>
    )
  }

  function YesNo({ label, value, onChange }) {
    return (
      <div className="flex items-center gap-3 py-3.5 border-b border-gray-100 last:border-0">
        <div className="text-[13px] font-medium flex-1 leading-snug">{label}</div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onChange(value === false ? null : false)}
            className={`px-4 py-2.5 rounded-lg border-2 text-[13px] font-semibold transition-all active:scale-95 ${
              value === false ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 text-gray-400'
            }`}
          >No</button>
          <button
            onClick={() => onChange(value === true ? null : true)}
            className={`px-4 py-2.5 rounded-lg border-2 text-[13px] font-semibold transition-all active:scale-95 ${
              value === true ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 text-gray-400'
            }`}
          >Yes</button>
        </div>
      </div>
    )
  }

  return (
    <FormShell>
    <div className="pb-24">
      <Nav title="Fundamentals" />
      <StaffPicker selected={teacher} onSelect={setTeacher} initialEmail={teacherParam} />

      <div className="px-4">
        {/* Timer */}
        <div className="bg-white rounded-xl shadow-sm p-5 mt-4 text-center">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
            {timerRunning ? 'Observing' : seconds >= 300 ? 'Observation complete' : 'Ready — 5 minute observation'}
          </div>
          <div className={`text-5xl font-extrabold tabular-nums tracking-tight ${timerRunning ? 'text-red-600' : 'text-fls-navy'}`}>
            {mm}:{ss}
          </div>
          {currentMinute > 0 && currentMinute <= 5 && (
            <div className="text-sm font-semibold text-fls-orange mt-1">Minute {currentMinute} of 5</div>
          )}
          <div className="flex gap-2 justify-center mt-3.5">
            <button
              onClick={toggleTimer}
              className={`px-6 py-3 rounded-[10px] text-sm font-semibold ${
                timerRunning ? 'bg-gray-500 text-white' : 'bg-red-600 text-white'
              }`}
            >
              {timerRunning ? 'Pause' : seconds > 0 ? 'Resume' : 'Start'}
            </button>
            <button onClick={resetTimer} className="px-6 py-3 rounded-[10px] text-sm font-semibold bg-gray-100 text-gray-500 border border-gray-200">
              Reset
            </button>
          </div>
        </div>

        {/* Class size */}
        <div className="bg-white rounded-xl shadow-sm p-4 mt-4 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-semibold">Students in class</div>
            <div className="text-xs text-gray-400 mt-0.5">Total count — set once at start</div>
          </div>
          <input
            type="number"
            value={classSize}
            onChange={(e) => setClassSize(e.target.value)}
            placeholder="0"
            min="1" max="99"
            className="w-20 px-3 py-3 border border-gray-200 rounded-[10px] text-xl font-extrabold text-center text-fls-navy outline-none focus:border-fls-orange"
          />
        </div>

        {/* On Task by minute */}
        <div className="mt-4">
          <div className="text-base font-bold mb-1">On Task by Minute</div>
          <div className="text-xs text-gray-400 mb-3">Count students on task at the end of each minute — percent auto-calculates</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            {[0, 1, 2, 3, 4].map(i => {
              const min = i + 1
              const isDone = currentMinute > min
              const isActive = currentMinute === min && timerRunning
              const pct = percents[i]
              return (
                <div key={i} className="flex items-center gap-3 py-3.5 border-b border-gray-100 last:border-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                    isDone ? 'bg-green-500 text-white' : isActive ? 'bg-fls-orange text-white animate-pulse' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {min}
                  </div>
                  <div className="text-[13px] font-medium flex-1">Minute {min}</div>
                  <input
                    type="number"
                    value={counts[i]}
                    onChange={(e) => setCount(i, e.target.value)}
                    placeholder="#"
                    min="0" max="99"
                    className={`w-16 px-2.5 py-2.5 border rounded-lg text-base font-bold text-center outline-none ${
                      pct !== null ? 'border-green-500 bg-green-50' : 'border-gray-200'
                    } focus:border-fls-orange`}
                  />
                  <div className="text-[13px] text-gray-500 w-8">/ {total || '—'}</div>
                  <div className={`text-sm font-bold w-12 text-right tabular-nums ${
                    pct !== null ? (pct >= 90 ? 'text-green-500' : pct >= 70 ? 'text-yellow-500' : 'text-red-500') : 'text-gray-300'
                  }`}>
                    {pct !== null ? `${pct}%` : '—'}
                  </div>
                </div>
              )
            })}

            {/* Average */}
            <div className="flex items-center gap-2.5 mt-3.5 p-3 bg-gray-50 rounded-[10px]">
              <div className="text-xs text-gray-500 flex-1">Average On Task</div>
              <div className={`text-[22px] font-extrabold ${
                avgPercent === null ? '' : avgPercent >= 90 ? 'text-green-500' : avgPercent >= 70 ? 'text-yellow-500' : 'text-red-500'
              }`}>
                {avgPercent !== null ? `${avgPercent}%` : '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Status */}
        <div className="text-base font-bold mb-2">Status</div>
        <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
          <YesNo label="On Pace?" value={onPace} onChange={setOnPace} />
          <YesNo label="Is Fundamentals locked in for this teacher?" value={locked} onChange={setLocked} />
          <YesNo label="Are the foundations for Relationship Building / Community of Learners in place?" value={relationship} onChange={setRelationship} />
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Fundamental Skills */}
        <div className="text-base font-bold mb-2">Fundamental Skills</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <textarea
            value={skillsNotes}
            onChange={(e) => setSkillsNotes(e.target.value)}
            placeholder="Identify the Fundamental skills to be addressed"
            rows={3}
            className="w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange resize-y placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 z-50">
        <button
          onClick={async () => {
            if (!teacher) return
            setSaving(true)
            const draftScores = {}
            counts.forEach((c, i) => {
              const pct = percents[i]
              if (pct !== null) draftScores[`M${i + 1}`] = pct
            })
            try {
              await api.post('/api/touchpoints', {
                form_type: 'observation_fundamentals',
                teacher_email: teacher.email,
                school: teacher.school || '',
                status: 'draft',
                is_published: false,
                scores: draftScores,
                notes: skillsNotes,
                feedback: JSON.stringify({ class_size: total }),
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
          disabled={!teacher || saving || validPercents.length === 0 || !total}
          title={!teacher ? 'Pick a teacher' : !total ? 'Enter class size' : validPercents.length === 0 ? 'Record at least one minute of counts' : ''}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50 disabled:bg-gray-300"
        >
          {saving ? 'Saving…' : 'Publish'}
        </button>
      </div>
    </div>
    </FormShell>
  )
}
