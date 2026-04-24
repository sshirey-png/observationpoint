import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * Celebrate — praise / recognition form.
 * V3 family pattern (matches Fundamentals): draft paradigm + 3-button submit.
 * Tags dropped (redundant with FLS Commitments); Share-with dropped (Publish/Send handles it).
 */

const COMMITMENTS = [
  'We Keep Learning',
  'We Work Together',
  'We are Helpful',
  'We are the Safekeepers',
  'We Share Joy',
  'We Show Results',
]
const RECOGNITION_OPTIONS = ['Newsletter', 'This Week at FirstLine (TWAF)', 'Huddle Shout Out', 'Other']

export default function Celebrate() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [teacher, setTeacher] = useState(null)
  const [note, setNote] = useState('')
  const [commitments, setCommitments] = useState([])
  const [recognition, setRecognition] = useState({})
  const [personalNote, setPersonalNote] = useState('')
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

  // Resume existing draft when teacher selected
  useEffect(() => {
    if (!teacher) return
    hydratingRef.current = true
    let cancelled = false
    async function loadDraft() {
      try {
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=celebrate`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (existing.notes) setNote(existing.notes)
        if (Array.isArray(fb.commitments)) setCommitments(fb.commitments)
        if (fb.recognition && typeof fb.recognition === 'object') setRecognition(fb.recognition)
        if (fb.personal_note) setPersonalNote(fb.personal_note)
      } catch (e) {
        // 404 expected when no draft — silent
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
    if (!note.trim() && commitments.length === 0 && !personalNote && Object.keys(recognition).length === 0) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [teacher, note, commitments, recognition, personalNote])

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

  function buildBody(status, isPublished) {
    return {
      form_type: 'celebrate',
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      notes: note,
      feedback: JSON.stringify({
        commitments,
        recognition,
        personal_note: personalNote,
      }),
    }
  }

  async function submit(mode) {
    // mode: 'draft' | 'publish' | 'publish_and_send'
    if (!teacher || !note.trim()) return
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
            alert('Celebration published, but email to teacher failed: ' + e.message)
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
      setNote(''); setCommitments([]); setRecognition({}); setPersonalNote('')
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  function toggleCommitment(c) {
    setCommitments((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])
  }
  function toggleRecognition(opt) {
    setRecognition((prev) => {
      const next = { ...prev }
      if (next[opt] !== undefined) { delete next[opt] } else { next[opt] = '' }
      return next
    })
  }

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Celebration captured</div>
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
          new Celebration
          <span style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>TEST MODE</span>
        </div>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', padding: '6px 12px', background: '#f5f7fa' }}>
        <span>Auto-save enabled</span>
        <span style={{ fontWeight: 600 }}>
          {saveStatus === 'saving' && <span style={{ color: '#6b7280' }}>Saving…</span>}
          {saveStatus === 'saved' && lastSavedAt && <span style={{ color: '#16a34a' }}>✓ Saved {lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          {saveStatus === 'error' && <span style={{ color: '#dc2626' }}>Save failed — will retry</span>}
        </span>
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
          roleLabel="Celebration"
          pickerLabel="Who are you celebrating?"
        />

        {/* What are you celebrating? */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>What are you celebrating?</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Be specific — this goes directly to the teacher.</div>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What did you see? What made it land?"
            style={{ width: '100%', minHeight: 88, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
          />
        </div>

        {/* FLS Commitments */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Linked FLS Commitment (optional)</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 8 }}>Pick one or more that this celebration reflects.</div>
          {COMMITMENTS.map((c) => {
            const on = commitments.includes(c)
            return (
              <div
                key={c}
                onClick={() => toggleCommitment(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                  cursor: 'pointer', fontSize: 13,
                  background: on ? '#fff7ed' : 'transparent',
                  color: on ? '#e47727' : '#374151',
                  fontWeight: on ? 700 : 400,
                }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${on ? '#e47727' : '#d1d5db'}`,
                  background: on ? '#e47727' : 'transparent',
                }} />
                {c}
              </div>
            )
          })}
        </div>

        {/* Public Recognition */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Public Recognition</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Track where this shout-out was shared publicly.</div>
          {RECOGNITION_OPTIONS.map((opt) => (
            <div key={opt}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={recognition[opt] !== undefined}
                  onChange={() => toggleRecognition(opt)}
                  style={{ width: 16, height: 16, accentColor: '#002f60' }}
                />
                {opt}
              </label>
              {recognition[opt] !== undefined && (
                <div style={{ marginTop: 4, marginLeft: 26 }}>
                  <input
                    type="text"
                    value={recognition[opt]}
                    onChange={(e) => setRecognition({ ...recognition, [opt]: e.target.value })}
                    placeholder={opt === 'Other' ? 'Where and why?' : 'Add context...'}
                    style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Personal note (green accent, optional) */}
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#22c55e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>✉</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>Send a personal note (optional)</div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>Private message that lands in {teacher?.first_name || 'teacher'}'s inbox</div>
            </div>
          </div>
          <textarea
            value={personalNote} onChange={(e) => setPersonalNote(e.target.value)}
            placeholder={`Hey ${teacher?.first_name || 'there'} — just wanted you to know...`}
            style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #bbf7d0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
          />
        </div>
      </div>

      {/* Sticky 3-button bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving || !teacher}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={saving || !teacher || !note.trim()}
            title="Record celebration on dashboards · teacher NOT emailed"
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (saving || !teacher || !note.trim()) ? 0.5 : 1 }}
          >{saving ? '…' : 'Publish'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={saving || !teacher || !note.trim()}
            title="Publish AND email teacher the personal note"
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (saving || !teacher || !note.trim()) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Publish & Send'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
