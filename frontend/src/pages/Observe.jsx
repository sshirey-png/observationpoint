import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import RubricCard from '../components/RubricCard'
import RecordingBar from '../components/RecordingBar'
import ActionSteps from '../components/ActionSteps'
import ObservePreKForm from '../components/ObservePreKForm'
import { api } from '../lib/api'
import { TEACHER_RUBRIC } from '../lib/rubric-descriptors'

/**
 * Observe — teacher observation form.
 * V3 family pattern (matches Fundamentals/Celebrate): draft paradigm + 3-button submit.
 * PreK teachers branch to <ObservePreKForm> which owns its own flow.
 */


function observationFormTypeFor(teacher) {
  const title = (teacher?.job_title || '').toLowerCase()
  if (title.includes('prek') || title.includes('pre-k') || title.includes('pre k')) return 'observation_prek'
  return 'observation_teacher'
}

function isPreKTeacher(teacher) {
  return observationFormTypeFor(teacher) === 'observation_prek'
}

export default function Observe() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

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

  // Draft paradigm
  const [draftId, setDraftId] = useState(null)
  const [resumedDraft, setResumedDraft] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const hydratingRef = useRef(false)

  const prek = isPreKTeacher(teacher)

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  // Resume existing draft when teacher selected.
  // Skip for PreK — <ObservePreKForm> manages its own drafts.
  useEffect(() => {
    if (!teacher) return
    if (prek) return
    hydratingRef.current = true
    let cancelled = false
    async function loadDraft() {
      try {
        const formType = observationFormTypeFor(teacher)
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=${formType}`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        if (existing.scores && typeof existing.scores === 'object') setScores(existing.scores)
        if (existing.notes) setNotes(existing.notes)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (fb.see_it_success) setSeeItSuccess(fb.see_it_success)
        if (fb.see_it_growth) setSeeItGrowth(fb.see_it_growth)
        if (fb.do_it_practice) setDoItPractice(fb.do_it_practice)
        if (existing.action_step) {
          try {
            const as = JSON.parse(existing.action_step)
            if (as && typeof as === 'object' && as.action) setActionStep(as)
            else if (typeof as === 'string') setCustomStep(as)
          } catch {
            setCustomStep(existing.action_step)
          }
        }
      } catch (e) {
        // 404 expected when no draft — silent
      } finally {
        setTimeout(() => { hydratingRef.current = false }, 100)
      }
    }
    loadDraft()
    return () => { cancelled = true }
  }, [teacher, prek])

  // Debounced auto-save
  useEffect(() => {
    if (!teacher) return
    if (prek) return
    if (hydratingRef.current) return
    if (done) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [teacher, scores, notes, seeItSuccess, seeItGrowth, doItPractice, actionStep, customStep])

  function setScore(code, value) {
    setScores(prev => ({ ...prev, [code]: value }))
  }

  function buildBody(status, isPublished) {
    return {
      form_type: observationFormTypeFor(teacher),
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      scores,
      notes,
      feedback: JSON.stringify({
        see_it_success: seeItSuccess,
        see_it_growth: seeItGrowth,
        do_it_practice: doItPractice,
      }),
      action_step: actionStep ? JSON.stringify(actionStep) : (customStep || null),
    }
  }

  async function autoSave() {
    if (!teacher) return
    setSaveStatus('saving')
    const body = buildBody('draft', false)
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

  async function submit(mode) {
    // mode: 'draft' | 'publish' | 'publish_and_send'
    if (!teacher) return
    clearTimeout(saveTimerRef.current)
    setSaving(true)
    const asDraft = mode === 'draft'
    const body = buildBody(
      asDraft ? 'draft' : 'published',
      !asDraft,
    )

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
      setDraftId(null); setResumedDraft(false)
      setScores({}); setNotes('')
      setSeeItSuccess(''); setSeeItGrowth(''); setDoItPractice('')
      setActionStep(null); setCustomStep('')
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  const hasContent = (
    notes.trim() ||
    seeItSuccess.trim() ||
    seeItGrowth.trim() ||
    doItPractice.trim() ||
    Object.keys(scores).length > 0
  )

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#059669', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Published</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{teacher?.first_name} {teacher?.last_name}</div>
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
      <div style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '6px 12px', letterSpacing: '.05em' }}>
        DESIGN MOCK · Teacher observation form
      </div>
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
            <>{teacher.first_name} {teacher.last_name} · new {prek ? 'PreK' : 'Teacher'} observation</>
          ) : <>new Teacher observation</>}
          <span style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>TEST MODE</span>
        </div>
      </nav>

      {!prek && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', padding: '6px 12px', background: '#f5f7fa' }}>
          <span>Auto-save enabled</span>
          {teacher && (
            <span style={{ fontWeight: 600 }}>
              {saveStatus === 'saving' && <span style={{ color: '#6b7280' }}>Saving…</span>}
              {saveStatus === 'saved' && lastSavedAt && <span style={{ color: '#16a34a' }}>✓ Saved {lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
              {saveStatus === 'error' && <span style={{ color: '#dc2626' }}>Save failed — will retry</span>}
            </span>
          )}
        </div>
      )}

      {resumedDraft && teacher && !prek && (
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
          roleLabel={prek ? 'Observation · PreK' : 'Observation'}
          pickerLabel="Pick a teacher"
        />

        {/* PreK branch — hand off entirely to ObservePreKForm which owns its own flow */}
        {teacher && prek && <ObservePreKForm teacher={teacher} />}

        {/* Teacher form — standard (non-PreK) rubric flow */}
        {!prek && (
          <>
            {/* Recording bar */}
            <div style={{ marginBottom: 10 }}>
              <RecordingBar onToggleAI={setAiEnabled} />
            </div>

            {/* Observation Notes */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Observation Notes</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>What you saw, in your own words.</div>
              <textarea
                value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Type observations here..."
                style={{ width: '100%', minHeight: 88, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
              />
            </div>

            {/* Rubric */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>FLS Teacher Rubric</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Score at least one area. A rating of 1 requires explanation.</div>
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
            </div>

            {/* Observation Feedback — See-It / Do-It */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Observation Feedback</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 12 }}>Structured debrief notes that land with the teacher.</div>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 6 }}>See It / Name It: Success</div>
              <textarea
                value={seeItSuccess} onChange={(e) => setSeeItSuccess(e.target.value)}
                placeholder="What's working well in this classroom?"
                style={{ width: '100%', minHeight: 60, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827', marginBottom: 12 }}
              />

              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 6 }}>See It / Name It: Area(s) of Growth</div>
              <textarea
                value={seeItGrowth} onChange={(e) => setSeeItGrowth(e.target.value)}
                placeholder="Where is there opportunity to grow?"
                style={{ width: '100%', minHeight: 60, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827', marginBottom: 12 }}
              />

              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 6 }}>Do It: What did you practice?</div>
              <textarea
                value={doItPractice} onChange={(e) => setDoItPractice(e.target.value)}
                placeholder="What was practiced during the debrief?"
                style={{ width: '100%', minHeight: 60, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
              />
            </div>

            {/* Action Step */}
            <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Action Step</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Select a rubric area, then choose an action step from Get Better Faster.</div>
              <ActionSteps
                selected={actionStep}
                onChange={setActionStep}
                customStep={customStep}
                onCustomChange={setCustomStep}
              />
            </div>
          </>
        )}
      </div>

      {/* Sticky 3-button bar — only for non-PreK. PreK form owns its own submit. */}
      {!prek && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
            <button onClick={() => submit('draft')} disabled={saving || !teacher}
              style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
            >Save draft</button>
            <button onClick={() => submit('publish')} disabled={saving || !teacher || !hasContent}
              title="Publish — teacher NOT notified yet"
              style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (saving || !teacher || !hasContent) ? 0.5 : 1 }}
            >{saving ? '…' : 'Publish'}</button>
            <button onClick={() => submit('publish_and_send')} disabled={saving || !teacher || !hasContent}
              title="Publish AND email the teacher now"
              style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (saving || !teacher || !hasContent) ? 0.5 : 1 }}
            >{saving ? 'Saving…' : 'Publish & Send'}</button>
          </div>
        </div>
      )}
    </div>
    </FormShell>
  )
}
