import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * QuickFeedback — single note + Share/Private. No tags, no rubric.
 * V3 family: navy nav, SubjectBlock, single submit at bottom:0.
 */
export default function QuickFeedback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [teacher, setTeacher] = useState(null)
  const [note, setNote] = useState('')
  const [shared, setShared] = useState(true)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!teacher || !note.trim()) return
    setSaving(true)
    try {
      const res = await api.post('/api/touchpoints', {
        form_type: 'quick_feedback',
        teacher_email: teacher.email,
        school: teacher.school || '',
        school_year: '2026-2027',
        is_test: true,
        status: 'published',
        is_published: true,
        notes: note,
        feedback: JSON.stringify({ shared }),
      })
      // If user chose Share, fire the notify endpoint so the teacher actually
      // gets an email. Private = save to dashboard only, no notify.
      if (shared && res?.id) {
        try { await api.post(`/api/touchpoints/${res.id}/notify`, {}) } catch (e) {}
      }
      setDone(true)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#059669', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Feedback sent</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            {shared ? `Email sent to ${teacher?.first_name}` : 'Saved on your dashboard (private — not sent)'}
          </div>
          <button
            onClick={() => navigate('/')}
            style={{ marginTop: 18, background: '#e47727', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >Done</button>
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
          {teacher ? <>{teacher.first_name} {teacher.last_name} · Quick Feedback</> : 'Quick Feedback'}</div>
      </nav>

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>

        <SubjectBlock
          selected={teacher}
          onSelect={setTeacher}
          initialEmail={teacherParam}
          roleLabel="Quick"
        />

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>What did you observe?</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>A quick touchpoint — no rubric, no scoring. Just a note.</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Quick observation or feedback for the teacher..."
            autoFocus
            style={{ width: '100%', minHeight: 100, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', resize: 'vertical' }}
          />
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Share with teacher?</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Share sends a notification. Private keeps it on your dashboard only.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { v: true, label: 'Share' },
              { v: false, label: 'Private' },
            ].map(({ v, label }) => {
              const on = shared === v
              return (
                <button
                  key={label}
                  onClick={() => setShared(v)}
                  style={{ flex: 1, padding: 12, border: `1.5px solid ${on ? '#002f60' : '#e5e7eb'}`, borderRadius: 10, fontSize: 13, fontWeight: 700, background: on ? '#002f60' : '#fff', color: on ? '#fff' : '#6b7280', cursor: 'pointer', fontFamily: 'inherit' }}
                >{label}</button>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <button
            onClick={submit}
            disabled={!teacher || !note.trim() || saving}
            style={{ width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#e47727', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', opacity: (!teacher || !note.trim() || saving) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Submit Feedback'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
