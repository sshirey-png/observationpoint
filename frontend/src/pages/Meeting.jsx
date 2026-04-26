import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * Meeting — Data Meeting (Relay) form.
 * V3 family: navy nav, SubjectBlock, draft paradigm (active-draft + autosave),
 * 3-button submit (Save draft / Publish / Publish & Send).
 */

const FORM_TYPE = 'meeting_data_meeting_(relay)'

export default function Meeting() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [teacher, setTeacher] = useState(null)
  const [standard, setStandard] = useState('')
  const [initialMastery, setInitialMastery] = useState('')
  const [knowShow, setKnowShow] = useState('')
  const [seeItSuccess, setSeeItSuccess] = useState('')
  const [seeItGrowth, setSeeItGrowth] = useState('')
  const [reteachPlan, setReteachPlan] = useState('')
  const [reteachPrep, setReteachPrep] = useState('')
  const [reteachDate, setReteachDate] = useState('')
  const [reteachMastery, setReteachMastery] = useState('')
  const [reteachReflection, setReteachReflection] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Draft paradigm
  const [draftId, setDraftId] = useState(null)
  const [resumedDraft, setResumedDraft] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const hydratingRef = useRef(false)

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  useEffect(() => {
    if (!teacher) return
    hydratingRef.current = true
    let cancelled = false
    async function loadDraft() {
      try {
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=${encodeURIComponent(FORM_TYPE)}`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (existing.notes) setNotes(existing.notes)
        if (fb.standard) setStandard(fb.standard)
        if (fb.initial_mastery) setInitialMastery(fb.initial_mastery)
        if (fb.know_show_summary) setKnowShow(fb.know_show_summary)
        if (fb.see_it_success) setSeeItSuccess(fb.see_it_success)
        if (fb.see_it_growth) setSeeItGrowth(fb.see_it_growth)
        if (fb.reteach_plan) setReteachPlan(fb.reteach_plan)
        if (fb.reteach_prep) setReteachPrep(fb.reteach_prep)
        if (fb.reteach_date) setReteachDate(fb.reteach_date)
        if (fb.reteach_mastery) setReteachMastery(fb.reteach_mastery)
        if (fb.reteach_reflection) setReteachReflection(fb.reteach_reflection)
      } catch (e) {
        // 404 expected when no draft — silent
      } finally {
        setTimeout(() => { hydratingRef.current = false }, 100)
      }
    }
    loadDraft()
    return () => { cancelled = true }
  }, [teacher])

  useEffect(() => {
    if (!teacher || hydratingRef.current || done) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [teacher, standard, initialMastery, knowShow, seeItSuccess, seeItGrowth, reteachPlan, reteachPrep, reteachDate, reteachMastery, reteachReflection, notes])

  function buildBody(status, isPublished) {
    return {
      form_type: FORM_TYPE,
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      notes,
      feedback: JSON.stringify({
        standard,
        initial_mastery: initialMastery,
        know_show_summary: knowShow,
        see_it_success: seeItSuccess,
        see_it_growth: seeItGrowth,
        reteach_plan: reteachPlan,
        reteach_prep: reteachPrep,
        reteach_date: reteachDate,
        reteach_mastery: reteachMastery,
        reteach_reflection: reteachReflection,
      }),
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
    if (!teacher) return
    clearTimeout(saveTimerRef.current)
    setSaving(true)
    const asDraft = mode === 'draft'
    const body = buildBody(asDraft ? 'draft' : 'published', !asDraft)
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
            alert('Meeting published, but email to teacher failed: ' + e.message)
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
      setStandard(''); setInitialMastery(''); setKnowShow('')
      setSeeItSuccess(''); setSeeItGrowth('')
      setReteachPlan(''); setReteachPrep(''); setReteachDate('')
      setReteachMastery(''); setReteachReflection(''); setNotes('')
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
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Meeting published</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{teacher?.first_name} {teacher?.last_name}</div>
          <button
            onClick={() => navigate(teacher ? `/app/staff/${teacher.email}` : '/')}
            style={{ marginTop: 18, background: '#e47727', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >View Profile</button>
        </div>
      </div>
    )
  }

  const input = { width: '100%', padding: '11px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', background: '#fff', boxSizing: 'border-box' }
  const dateInput = { ...input, textAlign: 'left', WebkitAppearance: 'none', appearance: 'none', minHeight: 44, display: 'block' }
  const textarea = { width: '100%', minHeight: 70, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical' }
  const cardHead = { fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }
  const cardLabel = { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 10, marginBottom: 6 }

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
          {teacher ? <>{teacher.first_name} {teacher.last_name} · Data Meeting</> : 'Data Meeting'}</div>
      </nav>

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
          roleLabel="Data Meeting"
        />

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardHead}>Meeting Details</div>
          <div style={cardLabel}>Standard</div>
          <input type="text" value={standard} onChange={e => setStandard(e.target.value)} placeholder="Enter standard" style={input} />
          <div style={cardLabel}>Initial Mastery</div>
          <input type="number" value={initialMastery} onChange={e => setInitialMastery(e.target.value)} placeholder="Enter number" style={input} />
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardHead}>Know / Show Summary</div>
          <textarea value={knowShow} onChange={e => setKnowShow(e.target.value)} placeholder="Summary of student understanding..." style={textarea} />
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardHead}>See It / Name It</div>
          <div style={cardLabel}>Success</div>
          <textarea value={seeItSuccess} onChange={e => setSeeItSuccess(e.target.value)} placeholder="What's working?" style={textarea} />
          <div style={cardLabel}>Area of Growth (Gap)</div>
          <textarea value={seeItGrowth} onChange={e => setSeeItGrowth(e.target.value)} placeholder="Where is the gap?" style={textarea} />
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardHead}>Do It · Reteach Cycle</div>
          <div style={cardLabel}>Reteach Plan</div>
          <textarea value={reteachPlan} onChange={e => setReteachPlan(e.target.value)} placeholder="Plan for reteaching..." style={textarea} />
          <div style={cardLabel}>Reteach Prep</div>
          <textarea value={reteachPrep} onChange={e => setReteachPrep(e.target.value)} placeholder="Preparation for reteach..." style={textarea} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 10 }}>
            <div>
              <div style={{ ...cardLabel, marginTop: 0 }}>Reteach Date</div>
              <input type="date" value={reteachDate} onChange={e => setReteachDate(e.target.value)} style={dateInput} />
            </div>
            <div>
              <div style={{ ...cardLabel, marginTop: 0 }}>Reteach Mastery</div>
              <input type="number" value={reteachMastery} onChange={e => setReteachMastery(e.target.value)} placeholder="0" style={dateInput} />
            </div>
          </div>
          <div style={cardLabel}>Reteach Reflection</div>
          <textarea value={reteachReflection} onChange={e => setReteachReflection(e.target.value)} placeholder="Reflection on reteach outcomes..." style={textarea} />
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardHead}>Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." style={textarea} />
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving || !teacher}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={saving || !teacher}
            title={!teacher ? 'Pick a teacher first' : 'Publish — teacher NOT notified yet'}
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >{saving ? '…' : 'Publish'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={saving || !teacher}
            title={!teacher ? 'Pick a teacher first' : 'Publish AND email the teacher now'}
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Publish & Send'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
