import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * Fundamentals observation form.
 * Port of prototypes/form-fundamentals.html — navy V3 family.
 * Mastery rule: single obs qualifies if AVG across m1..m5 >= 90%.
 * Teacher locks in when they have 5 qualifying obs.
 */

const MASTERY_THRESHOLD = 90 // avg across 5 minutes
const MAX_ACTION_STEPS = 2

const T1_STEPS = [
  {cat:'Routines & Procedures', action:'Plan critical routines and procedures moment-by-moment', when:'routines aren\'t clear', prompt:'"What is each step the teacher takes in this routine? What is the teacher doing and what are the students doing?"', rtc:'N/A'},
  {cat:'Routines & Procedures', action:'Plan the roll-out for introducing the routine', when:'routine is new for the students', prompt:'"What will be the most difficult parts for students to master? How will you model this effectively?"', rtc:'If model is ineffective: "Am I following your model effectively?"'},
  {cat:'Routines & Procedures', action:'Do It Again & Cut It Short', when:'students aren\'t performing a routine correctly', prompt:'"What are the keys to running a Do It Again effectively?"', rtc:'Non-verbal: Make a circle with your finger to cue Do It Again'},
  {cat:'Strong Voice', action:'Square up and stand still', when:'teacher\'s body language lacks leadership presence', prompt:'"What is the value in communicating leadership with our body language?"', rtc:'Non-verbal: shift body upward and arch shoulders'},
  {cat:'Strong Voice', action:'Use formal register', when:'teacher\'s tone lacks leadership presence', prompt:'"Imagine saying \'It\'s time to leave\' to three audiences. What\'s the value of the middle one?"', rtc:'Non-verbal: square up gesture + point to mouth'},
  {cat:'Clear Directions', action:'Use MVP Directions', when:'teacher\'s directions are unclear and use too many words', prompt:'"What happened when you asked students to ___? What caused the dip in behavior?"', rtc:'Non-verbal: sign MVP. Whisper: "When I say go, at a level zero..."'},
  {cat:'Teacher Radar', action:'Perch and Be Seen Looking', when:'students don\'t feel teacher is monitoring', prompt:'"How do the students know you are monitoring their behavior?"', rtc:'Non-verbal: Make gesture of Be Seen Looking'},
  {cat:'Teacher Radar', action:'Scan Hot Spots', when:'teacher is not noticing earliest non-compliance', prompt:'"At what moment do the first students begin to go off track? Which students are most often off task?"', rtc:'Hold hand out over a hot spot'},
  {cat:'Teacher Radar', action:'Circulate the perimeter', when:'teacher is stationary', prompt:'"Where did the off-task behavior start? Where were you standing?"', rtc:'Non-verbal: point to a corner where they should stand'},
  {cat:'Pacing', action:'Time Yourself', when:'lesson doesn\'t conform to time stamps', prompt:'"How much time did you want to spend on the I Do? What kept us from sticking?"', rtc:'Non-verbal: point at watch. Hand signal for minutes remaining'},
  {cat:'Pacing', action:'Illusion of Speed', when:'students don\'t have urgency', prompt:'"How could you challenge students to work with greater purpose?"', rtc:'Non-verbal: 5-4-3-2-1 with fingers'},
  {cat:'Narrate the Positive', action:'Use a warm/strict voice', when:'tone when addressing management is overly negative', prompt:'"How did the teacher get students to correct misbehaviors without being negative?"', rtc:'Non-verbal: index card with plus sign. Whisper: "Warm strict"'},
  {cat:'Narrate the Positive', action:'Narrate the Positive X3', when:'off-task students don\'t respond to clear directions', prompt:'"What does this teacher do after giving clear directions? How does that affect attention?"', rtc:'Whisper: "Narrate X3"'},
  {cat:'Individual Correction', action:'Least-Invasive Intervention', when:'corrections draw more attention than necessary', prompt:'"What is the advantage of starting with the least invasive intervention?"', rtc:'Non-verbal: point to off-task students. Whisper: "Use ___ intervention"'},
  {cat:'Consequence', action:'Give a consequence', when:'consequences are not being implemented', prompt:'"You gave clear directions, narrated X3, did non-verbal cues but students still off task. What could you do?"', rtc:'Non-verbal or whisper to implement consequence'},
]

function pctColor(p) {
  if (p == null) return '#d1d5db'
  if (p >= 90) return '#22c55e'
  if (p >= 70) return '#eab308'
  return '#dc2626'
}

function Toggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      {['yes', 'no'].map((v) => {
        const on = value === (v === 'yes')
        return (
          <button
            key={v}
            onClick={() => onChange(v === 'yes')}
            style={{
              flex: 1, padding: '11px 12px', border: '1.5px solid',
              borderColor: on ? (v === 'yes' ? '#22c55e' : '#dc2626') : '#e5e7eb',
              background: on ? (v === 'yes' ? '#dcfce7' : '#fee2e2') : '#fff',
              borderRadius: 10, fontSize: 13, fontWeight: 700,
              color: on ? (v === 'yes' ? '#166534' : '#991b1b') : '#6b7280',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >{v === 'yes' ? 'Yes' : 'No'}</button>
        )
      })}
    </div>
  )
}

function ActionStepCard({ step, selected, disabled, onToggle }) {
  return (
    <div
      onClick={() => onToggle(step, !selected)}
      style={{
        padding: '10px 14px', borderTop: '1px solid #f3f4f6', cursor: 'pointer',
        background: selected ? '#fff7ed' : 'transparent',
        boxShadow: selected ? 'inset 3px 0 0 #e47727' : 'none',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>{step.action}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>When: {step.when}</div>
      {selected && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #fed7aa' }}>
          <div style={{ fontSize: 11, fontStyle: 'italic', color: '#1d4ed8', background: '#eff6ff', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 }}>{step.prompt}</div>
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>RTC Cue: {step.rtc}</div>
        </div>
      )}
    </div>
  )
}

function CategoryBucket({ cat, steps, selectedIds, onToggle, maxReached }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, marginTop: 8, overflow: 'hidden', background: '#fff' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', padding: '12px 14px', cursor: 'pointer',
          borderBottom: open ? '1px solid #f3f4f6' : 'none',
        }}
      >
        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, color: '#e47727', textTransform: 'uppercase', letterSpacing: '.08em' }}>{cat}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, marginRight: 8 }}>{steps.length}</div>
        <div style={{ color: '#9ca3af', fontSize: 12, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</div>
      </div>
      {open && (
        <div style={{ padding: '4px 0' }}>
          {steps.map((s, i) => {
            const isSel = selectedIds.includes(s.action)
            return (
              <ActionStepCard
                key={i}
                step={s}
                selected={isSel}
                disabled={!isSel && maxReached}
                onToggle={onToggle}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Fundamentals() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)
  const [classSize, setClassSize] = useState('')
  const [counts, setCounts] = useState(['', '', '', '', ''])
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [onPace, setOnPace] = useState(null)
  const [col, setCol] = useState(null)
  const [lockedIn, setLockedIn] = useState(false)
  const [skills, setSkills] = useState('')
  const [selectedSteps, setSelectedSteps] = useState([])
  const [customStep, setCustomStep] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const intervalRef = useRef(null)
  // Draft paradigm state
  const [draftId, setDraftId] = useState(null)
  const [resumedDraft, setResumedDraft] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')  // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const hydratingRef = useRef(false)  // skip autosave while loading draft

  function toggleTimer() {
    if (running) {
      clearInterval(intervalRef.current)
      setRunning(false)
    } else {
      setRunning(true)
      intervalRef.current = setInterval(() => {
        setSeconds((prev) => {
          const next = prev + 1
          if (next >= 300) {
            clearInterval(intervalRef.current)
            setRunning(false)
          }
          return Math.min(next, 300)
        })
      }, 1000)
    }
  }
  function resetTimer() {
    clearInterval(intervalRef.current)
    setRunning(false)
    setSeconds(0)
  }
  useEffect(() => () => {
    clearInterval(intervalRef.current)
    clearTimeout(saveTimerRef.current)
  }, [])

  // Draft resume — when a teacher is picked, look for existing draft
  useEffect(() => {
    if (!teacher) return
    hydratingRef.current = true
    let cancelled = false
    async function loadDraft() {
      try {
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=observation_fundamentals`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        // Hydrate form from the draft
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (fb.class_size) setClassSize(String(fb.class_size))
        if (fb.custom_step) setCustomStep(fb.custom_step)
        const newCounts = ['', '', '', '', '']
        for (let i = 1; i <= 5; i++) {
          const pct = existing.scores?.[`M${i}`]
          if (pct != null && fb.class_size) {
            newCounts[i - 1] = String(Math.round((pct / 100) * fb.class_size))
          }
        }
        setCounts(newCounts)
        if (existing.scores?.OP != null) setOnPace(existing.scores.OP === 1)
        if (existing.scores?.CL != null) setCol(existing.scores.CL === 1)
        if (existing.locked_in != null) setLockedIn(!!existing.locked_in)
        if (existing.notes) setSkills(existing.notes)
      } catch (e) {
        // 404 is expected when no draft exists — silent
      } finally {
        setTimeout(() => { hydratingRef.current = false }, 100)
      }
    }
    loadDraft()
    return () => { cancelled = true }
  }, [teacher])

  // Debounced auto-save
  useEffect(() => {
    if (!teacher) return
    if (hydratingRef.current) return
    if (done) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [teacher, classSize, counts, onPace, col, lockedIn, skills, selectedSteps, customStep])

  async function autoSave() {
    if (!teacher) return
    setSaveStatus('saving')
    const scores = {}
    pcts.forEach((p, i) => { if (p !== null) scores[`M${i + 1}`] = p })
    if (onPace !== null) scores.OP = onPace ? 1 : 0
    if (col !== null) scores.CL = col ? 1 : 0
    const body = {
      form_type: 'observation_fundamentals',
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      locked_in: lockedIn,
      status: 'draft',
      is_published: false,
      scores,
      notes: skills,
      feedback: JSON.stringify({ class_size: total, qualifies, avg_pct: avgPct, custom_step: customStep || null }),
    }
    try {
      if (draftId) {
        await api.put(`/api/touchpoints/${draftId}`, body)
      } else {
        const res = await api.post('/api/touchpoints', body)
        if (res.id) setDraftId(res.id)
      }
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) {
      setSaveStatus('error')
    }
  }

  const total = parseInt(classSize) || 0
  const pcts = counts.map((c) => {
    const n = parseInt(c)
    if (isNaN(n) || total === 0) return null
    return Math.round((Math.min(n, total) / total) * 100)
  })
  const valid = pcts.filter((p) => p !== null)
  const avgPct = valid.length === 5 ? Math.round(valid.reduce((a, b) => a + b, 0) / 5) : null
  const qualifies = avgPct !== null && avgPct >= MASTERY_THRESHOLD

  const mm = Math.floor(seconds / 60)
  const ss = String(seconds % 60).padStart(2, '0')
  const currentMin = seconds > 0 && seconds < 300 ? Math.min(Math.floor(seconds / 60) + 1, 5) : null

  function toggleStep(step, select) {
    setSelectedSteps((prev) => {
      if (!select) return prev.filter((s) => s.action !== step.action)
      if (prev.length >= MAX_ACTION_STEPS) return prev
      return [...prev, step]
    })
  }

  async function submit(mode) {
    // mode: 'draft' | 'publish' | 'publish_and_send'
    if (!teacher) return
    clearTimeout(saveTimerRef.current)  // cancel any pending autosave
    setSaving(true)
    const asDraft = mode === 'draft'
    const scores = {}
    pcts.forEach((p, i) => { if (p !== null) scores[`M${i + 1}`] = p })
    if (onPace !== null) scores.OP = onPace ? 1 : 0
    if (col !== null) scores.CL = col ? 1 : 0

    const body = {
      form_type: 'observation_fundamentals',
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      locked_in: lockedIn,
      status: asDraft ? 'draft' : 'published',
      is_published: !asDraft,
      scores,
      notes: skills,
      feedback: JSON.stringify({ class_size: total, qualifies, avg_pct: avgPct, custom_step: customStep || null }),
      action_steps_selected: selectedSteps.map((s) => ({ action: s.action, cat: s.cat })),
    }

    try {
      let finalId = draftId
      if (draftId) {
        await api.put(`/api/touchpoints/${draftId}`, body)
      } else {
        const res = await api.post('/api/touchpoints', body)
        if (res.id) { setDraftId(res.id); finalId = res.id }
      }
      if (asDraft) {
        setSaveStatus('saved')
        setLastSavedAt(new Date())
        setSaving(false)
      } else {
        // Publish — optionally fire the notify endpoint
        if (mode === 'publish_and_send' && finalId) {
          try {
            await api.post(`/api/touchpoints/${finalId}/notify`, {})
          } catch (e) {
            alert('Observation published, but email to teacher failed: ' + e.message)
          }
        }
        setDone(true)
      }
    } catch (e) {
      alert('Save failed: ' + e.message)
      setSaving(false)
    }
  }

  async function abandonDraft() {
    if (!draftId) return
    if (!confirm('Abandon this draft and start fresh? Your work will be deleted.')) return
    try {
      await api.del(`/api/touchpoints/${draftId}`)
      // Reset form state
      setDraftId(null)
      setResumedDraft(false)
      setClassSize(''); setCounts(['', '', '', '', ''])
      setOnPace(null); setCol(null); setLockedIn(false)
      setSkills(''); setSelectedSteps([]); setCustomStep('')
      setSeconds(0); setRunning(false)
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#059669', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Published</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{teacher?.first_name} {teacher?.last_name} · {qualifies ? 'qualifies toward mastery' : 'does not qualify'}</div>
          <button
            onClick={() => navigate(teacher ? `/app/staff/${teacher.email}` : '/')}
            style={{ marginTop: 18, background: '#e47727', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >View Profile</button>
        </div>
      </div>
    )
  }


  return (
    <FormShell>
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', fontFamily: 'Inter, sans-serif' }}>
      <nav style={{ background: '#002f60', padding: '14px 16px', textAlign: 'center', position: 'relative' }}>
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="Back"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', borderRadius: 8, background: 'rgba(255,255,255,.08)', border: 'none', fontFamily: 'inherit' }}
        >←</button>
        <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', cursor: 'pointer' }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
        </Link>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>
          {teacher ? (
            <>{teacher.first_name} {teacher.last_name} · new Fundamentals</>
          ) : <>new Fundamentals observation</>}</div>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', padding: '6px 12px', background: '#f5f7fa' }}>
        <span><span style={{ color: '#e47727', fontWeight: 700 }}>*</span> = mock data</span>
        {teacher && (
          <span style={{ fontWeight: 600 }}>
            {saveStatus === 'saving' && <span style={{ color: '#6b7280' }}>Saving…</span>}
            {saveStatus === 'saved' && lastSavedAt && <span style={{ color: '#16a34a' }}>✓ Saved {lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
            {saveStatus === 'error' && <span style={{ color: '#dc2626' }}>Save failed — will retry</span>}
          </span>
        )}
      </div>

      {resumedDraft && teacher && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '10px 14px', fontSize: 11, color: '#9a3412', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>Resumed your draft from earlier. Your work is preserved.</span>
          <a onClick={abandonDraft} style={{ color: '#e47727', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Abandon & start fresh</a>
        </div>
      )}

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>
        <SubjectBlock
          selected={teacher}
          onSelect={setTeacher}
          initialEmail={teacherParam}
          roleLabel="Fundamentals"
          pickerLabel="Pick a teacher"
        />

        {teacher && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 12, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} style={{ aspectRatio: 1, maxWidth: 40, margin: '0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: '#f3f4f6', color: '#9ca3af' }}>{n}</div>
              ))}
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, color: '#6b7280', marginTop: 8 }}>
              0<span style={{ fontSize: '.55em', color: '#e47727', verticalAlign: 'super', marginLeft: 1, fontWeight: 700 }}>*</span> of 5 qualifying obs · 5 more to lock in
            </div>
          </div>
        )}

        {/* Everything below always renders — matches Observe form pattern */}
        {true && (
          <>

            {/* Timer */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4, fontWeight: 700 }}>
                {running ? 'Observing' : seconds >= 300 ? 'Observation complete' : seconds > 0 ? 'Paused' : 'Ready · 5-minute observation'}
              </div>
              <div style={{ fontSize: 44, fontWeight: 900, color: running ? '#dc2626' : '#002f60', lineHeight: 1, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{mm}:{ss}</div>
              {currentMin && running && <div style={{ fontSize: 12, color: '#e47727', fontWeight: 700, marginTop: 4 }}>Minute {currentMin} of 5</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button onClick={toggleTimer} disabled={seconds >= 300} style={{ padding: '10px 22px', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: running ? '#6b7280' : '#dc2626', color: '#fff' }}>
                  {running ? 'Pause' : seconds > 0 ? 'Resume' : 'Start'}
                </button>
                <button onClick={resetTimer} style={{ padding: '10px 22px', background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
              </div>
            </div>

            {/* Class size */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Students in class</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Set once at start — enables auto-% calc</div>
              </div>
              <input type="number" value={classSize} onChange={(e) => setClassSize(e.target.value)} min="1" max="99" placeholder="0"
                style={{ width: 76, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 20, fontWeight: 800, textAlign: 'center', color: '#002f60', fontFamily: 'inherit' }}
              />
            </div>

            {/* On Task by minute */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>On Task · by minute</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 12 }}>Count students on-task at the end of each minute. Average ≥ 90% = this obs qualifies.</div>
              {[0, 1, 2, 3, 4].map((i) => {
                const min = i + 1
                const isDone = seconds >= min * 60
                const isActive = running && currentMin === min
                const pct = pcts[i]
                const rawN = parseInt(counts[i])
                const exceeds = !isNaN(rawN) && total > 0 && rawN > total
                return (
                  <div key={i} style={{ borderBottom: i < 4 ? '1px solid #f3f4f6' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 800,
                        background: isDone ? '#22c55e' : isActive ? '#e47727' : '#f3f4f6',
                        color: isDone || isActive ? '#fff' : '#9ca3af',
                        animation: isActive ? 'pulse 1.5s infinite' : 'none',
                      }}>{min}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Minute {min}</div>
                      <input type="number" value={counts[i]} onChange={(e) => {
                        const next = [...counts]; next[i] = e.target.value; setCounts(next)
                      }} min="0" max="99" placeholder="#"
                        style={{
                          width: 56, padding: 8,
                          border: `1.5px solid ${exceeds ? '#dc2626' : '#e5e7eb'}`,
                          background: exceeds ? '#fef2f2' : '#fff',
                          borderRadius: 8, fontSize: 15, fontWeight: 800, textAlign: 'center', color: '#002f60', fontFamily: 'inherit',
                        }}
                      />
                      <div style={{ fontSize: 12, color: '#9ca3af', width: 26, textAlign: 'center' }}>/ {total || '—'}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: pctColor(pct) }}>{pct !== null ? `${pct}%` : '—'}</div>
                    </div>
                    {exceeds && (
                      <div style={{ fontSize: 10, color: '#dc2626', paddingLeft: 44, paddingBottom: 8, fontWeight: 600 }}>
                        exceeds class size ({total})
                      </div>
                    )}
                  </div>
                )
              })}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '10px 12px', background: '#f9fafb', borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: '#6b7280', flex: 1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Average On Task</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: pctColor(avgPct) }}>{avgPct !== null ? `${avgPct}%` : '—'}</div>
              </div>
            </div>

            {/* Verdict */}
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 12 }}>
                <span>Average across 5 minutes</span>
                <b style={{ color: '#002f60', fontWeight: 800 }}>{avgPct !== null ? `${avgPct}%` : '—'}</b>
              </div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #fed7aa', fontSize: 13, fontWeight: 700, textAlign: 'center', color: avgPct === null ? '#9a3412' : qualifies ? '#16a34a' : '#9a3412' }}>
                {avgPct === null ? 'Enter class size and counts for all 5 minutes' : qualifies ? '✓ QUALIFIES · counts toward the 5 needed for mastery' : 'Does not qualify · average needs to be 90% or above'}
              </div>
            </div>

            {/* On Pace */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>On Pace?</div>
              <Toggle value={onPace} onChange={setOnPace} />
            </div>

            {/* CoL Foundations */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Relationship Building / CoL foundations in place?</div>
              <Toggle value={col} onChange={setCol} />
            </div>

            {/* Skills narrative */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Fundamental Skills · what you saw</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 12 }}>Routines that landed, skills that need reinforcement. Specifics help.</div>
              <textarea value={skills} onChange={(e) => setSkills(e.target.value)}
                placeholder="Cold-call rotated across rows · MVP directions announced before every transition..."
                style={{ width: '100%', minHeight: 80, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
              />
            </div>

            {/* Action Steps */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Assign Action Step</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 4 }}>Tap a category to expand, tap a card to select. Up to {MAX_ACTION_STEPS} can be assigned.</div>
              {Object.entries(T1_STEPS.reduce((acc, s) => { (acc[s.cat] ||= []).push(s); return acc }, {})).map(([cat, steps]) => (
                <CategoryBucket
                  key={cat}
                  cat={cat}
                  steps={steps}
                  selectedIds={selectedSteps.map((s) => s.action)}
                  onToggle={toggleStep}
                  maxReached={selectedSteps.length >= MAX_ACTION_STEPS}
                />
              ))}
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
                <b style={{ color: '#002f60', fontWeight: 800 }}>{selectedSteps.length}</b> <span style={{ color: '#9ca3af', fontWeight: 400 }}>of {MAX_ACTION_STEPS}</span> assigned
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginTop: 14, marginBottom: 6 }}>Custom Action Step (optional)</div>
              <textarea value={customStep} onChange={(e) => setCustomStep(e.target.value)}
                placeholder="Or write your own action step..."
                style={{ width: '100%', minHeight: 60, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
              />
            </div>

            {/* Locked In */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12, borderLeft: '4px solid #e47727' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Fundamentals Locked In?</div>
              <div style={{ fontSize: 11, color: '#9a3412', background: '#fff7ed', borderRadius: 6, padding: '6px 10px', marginTop: 8, marginBottom: 8 }}>
                Once at 5 qualifying obs, lock in = Yes. System suggests, you confirm.
              </div>
              <Toggle value={lockedIn} onChange={setLockedIn} />
            </div>
          </>
        )}
      </div>

      {/* Sticky submit bar — always rendered; buttons disabled until teacher + scores complete */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving || !teacher}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={saving || !teacher || avgPct === null}
            title={!teacher ? 'Pick a teacher first' : 'Publish — teacher NOT notified yet'}
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (saving || !teacher || avgPct === null) ? 0.5 : 1 }}
          >{saving ? '…' : 'Publish'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={saving || !teacher || avgPct === null}
            title={!teacher ? 'Pick a teacher first' : 'Publish AND email the teacher now'}
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (saving || !teacher || avgPct === null) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Publish & Send'}</button>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
      `}</style>
    </div>
    </FormShell>
  )
}
