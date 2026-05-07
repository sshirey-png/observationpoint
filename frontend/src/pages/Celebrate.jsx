import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import SendCopyToggle from '../components/SendCopyToggle'
import { api } from '../lib/api'

/**
 * Recognize — one form, three types (Celebration / Shoutout / Gratitude).
 * Type and FLS Commitment both required. Wall-only — no visibility toggles.
 * Supervisor → staff always counts in dashboards (auto via is_peer_recognition).
 */

// FLS Commitments — full canonical list (We Work Together appears twice
// per fls_commitments.json: listening + honesty/respect).
const COMMITMENTS = [
  { num: 1, theme: 'We Keep Learning', personal: 'I commit to my own and others\' development.' },
  { num: 2, theme: 'We Work Together', personal: 'I commit to listening and understanding.' },
  { num: 3, theme: 'We Work Together', personal: 'I commit to speaking with honesty and respect.' },
  { num: 4, theme: 'We are Helpful', personal: 'I commit to doing what it takes to serve others.' },
  { num: 5, theme: 'We are the Safekeepers of our Community', personal: 'I commit to keeping myself and others safe in mind, body, and spirit.' },
  { num: 6, theme: 'We Share Joy', personal: 'I commit to bringing my personal joy to our work.' },
  { num: 7, theme: 'We Show Results', personal: 'I commit to holding myself and others accountable.' },
]

const TYPES = [
  { id: 'celebration', emoji: '🎉', label: 'Celebration', sub: 'A win achieved' },
  { id: 'shoutout',    emoji: '👏', label: 'Shoutout',    sub: 'Saw something cool' },
  { id: 'gratitude',   emoji: '🙏', label: 'Gratitude',   sub: 'Thanks for…' },
]

export default function Celebrate() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [teacher, setTeacher] = useState(null)
  const [type, setType] = useState(null)
  const [note, setNote] = useState('')
  const [commitmentNum, setCommitmentNum] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [ccSelf, setCcSelf] = useState(false)

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
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=celebrate`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (existing.notes) setNote(existing.notes)
        if (fb.recognition_type) setType(fb.recognition_type)
        if (fb.commitment_num) setCommitmentNum(fb.commitment_num)
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
    if (!teacher) return
    if (hydratingRef.current) return
    if (done) return
    if (!note.trim() && !type && !commitmentNum) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [teacher, type, note, commitmentNum])

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
    const commitment = COMMITMENTS.find(c => c.num === commitmentNum)
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
        recognition_type: type || 'celebration',
        commitment_num: commitmentNum,
        commitment_theme: commitment?.theme || '',
        commitment_personal: commitment?.personal || '',
        cc_self: ccSelf,
      }),
    }
  }

  const formValid = !!(teacher && type && note.trim() && commitmentNum)

  async function submit(mode) {
    if (!formValid) return
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
            alert('Recognition published, but email failed: ' + e.message)
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
      setNote(''); setType(null); setCommitmentNum(null)
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  const selectedType = TYPES.find(t => t.id === type)

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>{selectedType?.emoji || '🎉'}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>{selectedType?.label || 'Recognition'} sent</div>
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
          Recognize a colleague</div>
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
          roleLabel="Recognition"
          pickerLabel="Who are you recognizing?"
        />

        {/* Type — required, no default */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Type <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 10, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>required — pick one</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
            {TYPES.map(t => {
              const on = type === t.id
              const onColors = {
                celebration: { border: '#e47727', bg: '#fff7ed', text: '#9a3412' },
                shoutout:    { border: '#fbbf24', bg: '#fef3c7', text: '#78350f' },
                gratitude:   { border: '#22c55e', bg: '#dcfce7', text: '#166534' },
              }[t.id]
              return (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  type="button"
                  style={{
                    padding: '12px 6px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit',
                    border: `2px solid ${on ? onColors.border : '#e5e7eb'}`,
                    background: on ? onColors.bg : '#fff',
                  }}
                >
                  <div style={{ fontSize: 22 }}>{t.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: on ? onColors.text : '#111827', marginTop: 2 }}>{t.label}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>{t.sub}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* What did you see? */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>What you want them to know</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Be specific — name a behavior, not a vibe. This is the first thing they'll read.</div>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={
              type === 'gratitude' ? `Hey ${teacher?.first_name || 'there'} — thanks for...` :
              type === 'shoutout'  ? `${teacher?.first_name || 'There'} — saw you do something cool...` :
              `${teacher?.first_name || 'There'} — what you accomplished was...`
            }
            style={{ width: '100%', minHeight: 96, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
          />
        </div>

        {/* FLS Commitment — required */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>FLS Commitment <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 10, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>required — every recognition ties back</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {COMMITMENTS.map((c) => {
              const on = commitmentNum === c.num
              return (
                <div
                  key={c.num}
                  onClick={() => setCommitmentNum(c.num)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    border: `1.5px solid ${on ? '#002f60' : '#e5e7eb'}`,
                    background: on ? '#eff6ff' : '#fff',
                  }}
                >
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    background: on ? '#002f60' : '#f3f4f6',
                    color: on ? '#fff' : '#6b7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800,
                  }}>{c.num}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: on ? '#002f60' : '#111827' }}>{c.theme}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1, lineHeight: 1.35 }}>{c.personal}</div>
                  </div>
                  {on && (
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#002f60', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>✓</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <SendCopyToggle checked={ccSelf} onChange={setCcSelf} />
        </div>

      </div>

      {/* Sticky 3-button bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving || !teacher}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={saving || !formValid}
            title="Record on dashboards · subject NOT emailed"
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (saving || !formValid) ? 0.5 : 1 }}
          >{saving ? '…' : 'Publish'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={saving || !formValid}
            title="Publish AND email subject"
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (saving || !formValid) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Publish & Send'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
