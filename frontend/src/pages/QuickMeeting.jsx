import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * Quick Meeting — multi-participant touchpoint.
 * V3 family. Replaces SubjectBlock with a chip-based multi-participant picker
 * since meetings can have many people (not just one subject).
 *
 * form_type = 'meeting_quick_meeting'
 * Stored as a single touchpoint with the FIRST participant as teacher_email
 * and the rest in feedback.participants[]. Absentees in feedback.absentees[].
 */

const FORM_TYPE = 'meeting_quick_meeting'

function ParticipantPicker({ label, sublabel, selected, onAdd, onRemove, chipColor = '#002f60' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  function handleInput(q) {
    setQuery(q)
    clearTimeout(timer.current)
    if (q.length < 2) { setResults([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      const data = await api.get(`/api/staff/search?q=${encodeURIComponent(q)}`)
      if (data) setResults(data)
      setLoading(false)
    }, 300)
  }

  function pick(staff) {
    if (!selected.find(s => s.email === staff.email)) onAdd(staff)
    setQuery(''); setResults([])
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#111827', marginBottom: 8 }}>{label}</div>
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        placeholder="Search staff by name..."
        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', outline: 'none', boxSizing: 'border-box' }}
      />
      {loading && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Searching…</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', borderRadius: 10, border: '1px solid #f3f4f6' }}>
          {results.map(s => (
            <button key={s.email} onClick={() => pick(s)}
              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: '#fff', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{s.first_name} {s.last_name}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {[s.school, s.job_title].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 8 }}>
        {selected.map(p => {
          const initials = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase()
          return (
            <span key={p.email} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px 6px 6px', borderRadius: 20,
              background: chipColor, color: '#fff', fontSize: 12, fontWeight: 600,
              margin: '4px 4px 0 0',
            }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: chipColor === '#9ca3af' ? '#6b7280' : '#e47727', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>{initials}</span>
              {p.first_name} {p.last_name}
              <span onClick={() => onRemove(p.email)}
                style={{ marginLeft: 4, background: 'rgba(255,255,255,.2)', width: 18, height: 18, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, cursor: 'pointer' }}>×</span>
            </span>
          )
        })}
      </div>
      {sublabel && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>{sublabel}</div>}
    </div>
  )
}

export default function QuickMeeting() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [name, setName] = useState('Quick Meeting')
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [meetingTime, setMeetingTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const [participants, setParticipants] = useState([])
  const [absentees, setAbsentees] = useState([])
  const [discussed, setDiscussed] = useState('')
  const [nextSteps, setNextSteps] = useState('')

  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [draftId, setDraftId] = useState(null)
  const [resumedDraft, setResumedDraft] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const hydratingRef = useRef(false)

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  // Resume an active draft anchored to the current user (no single subject)
  useEffect(() => {
    let cancelled = false
    async function loadDraft() {
      try {
        // Use the current user's email as the draft key — quick meetings have
        // many participants; we anchor the draft to whoever is creating it.
        const me = await api.get('/api/auth/status')
        const meEmail = me?.user?.email
        if (!meEmail) return
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(meEmail)}&form_type=${FORM_TYPE}`
        )
        if (cancelled || !existing) return
        hydratingRef.current = true
        setDraftId(existing.id)
        setResumedDraft(true)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (fb.name) setName(fb.name)
        if (fb.meeting_date) setMeetingDate(fb.meeting_date)
        if (fb.meeting_time) setMeetingTime(fb.meeting_time)
        if (Array.isArray(fb.participants)) setParticipants(fb.participants)
        if (Array.isArray(fb.absentees)) setAbsentees(fb.absentees)
        if (fb.discussed) setDiscussed(fb.discussed)
        if (fb.next_steps) setNextSteps(fb.next_steps)
        setTimeout(() => { hydratingRef.current = false }, 100)
      } catch (e) {}
    }
    loadDraft()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (hydratingRef.current || done) return
    if (participants.length === 0 && !discussed && !nextSteps) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [name, meetingDate, meetingTime, participants, absentees, discussed, nextSteps])

  async function buildBody(status, isPublished) {
    const me = await api.get('/api/auth/status')
    const meEmail = me?.user?.email || ''
    // Anchor as touchpoint to the first participant (or to the creator if none)
    const anchor = participants[0]?.email || meEmail
    const anchorSchool = participants[0]?.school || me?.user?.school || ''
    return {
      form_type: FORM_TYPE,
      teacher_email: anchor,
      school: anchorSchool,
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      notes: discussed,
      feedback: JSON.stringify({
        name,
        meeting_date: meetingDate,
        meeting_time: meetingTime,
        participants,
        absentees,
        discussed,
        next_steps: nextSteps,
      }),
    }
  }

  async function autoSave() {
    setSaveStatus('saving')
    try {
      const body = await buildBody('draft', false)
      let res
      if (draftId) {
        res = await api.put(`/api/touchpoints/${draftId}`, body)
      } else {
        res = await api.post('/api/touchpoints', body)
        if (res?.id) setDraftId(res.id)
      }
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) {
      setSaveStatus('error')
    }
  }

  const canComplete = participants.length > 0 && discussed.trim().length > 0

  async function submit(mode) {
    clearTimeout(saveTimerRef.current)
    setSaving(true)
    const asDraft = mode === 'draft'
    const body = await buildBody(asDraft ? 'draft' : 'published', !asDraft)
    try {
      let finalId = draftId
      let res
      if (draftId) {
        res = await api.put(`/api/touchpoints/${draftId}`, body)
      } else {
        res = await api.post('/api/touchpoints', body)
        if (res?.id) { setDraftId(res.id); finalId = res.id }
      }
      if (asDraft) {
        setSaveStatus('saved'); setLastSavedAt(new Date()); setSaving(false)
      } else {
        if (mode === 'publish_and_send' && finalId) {
          try { await api.post(`/api/touchpoints/${finalId}/notify`, {}) } catch (e) {}
        }
        setDone(true)
      }
    } catch (e) {
      alert('Save failed: ' + (e?.message || 'unknown error'))
      setSaving(false)
    }
  }

  async function abandonDraft() {
    if (!draftId) return
    if (!confirm('Abandon this draft? Your work will be deleted.')) return
    try {
      await api.del(`/api/touchpoints/${draftId}`)
      setDraftId(null); setResumedDraft(false)
      setName('Quick Meeting'); setParticipants([]); setAbsentees([])
      setDiscussed(''); setNextSteps('')
      setSaveStatus('idle')
    } catch (e) {}
  }

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#059669', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Meeting recorded</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{participants.length} participant{participants.length === 1 ? '' : 's'}</div>
          <button onClick={() => navigate('/')}
            style={{ marginTop: 18, background: '#002f60', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Done
          </button>
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
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>Quick Meeting</div>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', padding: '6px 12px', background: '#f5f7fa' }}>
        <span>Auto-save enabled</span>
        <span style={{ fontWeight: 600 }}>
          {saveStatus === 'saving' && <span style={{ color: '#6b7280' }}>Saving…</span>}
          {saveStatus === 'saved' && lastSavedAt && <span style={{ color: '#16a34a' }}>✓ Saved {lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          {saveStatus === 'error' && <span style={{ color: '#dc2626' }}>Save failed — will retry</span>}
        </span>
      </div>

      {resumedDraft && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '10px 14px', fontSize: 11, color: '#9a3412', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>Resumed your draft from earlier.</span>
          <a onClick={abandonDraft} style={{ color: '#e47727', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Abandon &amp; start fresh</a>
        </div>
      )}

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#111827', marginBottom: 8 }}>Meeting Details</div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 6 }}>Name</div>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="What's this meeting about?"
            style={{ width: '100%', padding: '11px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', background: '#fff', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 6 }}>Date</div>
              <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                style={{ width: '100%', padding: '11px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', background: '#fff', textAlign: 'left', WebkitAppearance: 'none', appearance: 'none', minHeight: 44, display: 'block', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 6 }}>Time</div>
              <input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)}
                style={{ width: '100%', padding: '11px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', background: '#fff', textAlign: 'left', WebkitAppearance: 'none', appearance: 'none', minHeight: 44, display: 'block', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        </div>

        <ParticipantPicker
          label="Participants"
          sublabel="Tap a result to add. Tap × to remove."
          selected={participants}
          onAdd={(s) => setParticipants(p => [...p, s])}
          onRemove={(email) => setParticipants(p => p.filter(x => x.email !== email))}
          chipColor="#002f60"
        />

        <ParticipantPicker
          label="Absentees (optional)"
          sublabel="Track who was expected but didn't attend."
          selected={absentees}
          onAdd={(s) => setAbsentees(p => [...p, s])}
          onRemove={(email) => setAbsentees(p => p.filter(x => x.email !== email))}
          chipColor="#9ca3af"
        />

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#111827', marginBottom: 8 }}>Meeting Notes</div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 6, marginBottom: 6 }}>What was discussed?</div>
          <textarea value={discussed} onChange={e => setDiscussed(e.target.value)} placeholder="Topics covered, decisions made, key takeaways..."
            style={{ width: '100%', minHeight: 90, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 10, marginBottom: 6 }}>What are the next steps?</div>
          <textarea value={nextSteps} onChange={e => setNextSteps(e.target.value)} placeholder="Action items, owners, deadlines..."
            style={{ width: '100%', minHeight: 90, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', lineHeight: 1.5 }} />
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: saving ? 0.5 : 1 }}>
            Save draft
          </button>
          <button onClick={() => submit('publish')} disabled={!canComplete || saving}
            title={!canComplete ? 'Add at least one participant + meeting notes' : 'Complete meeting (no notifications)'}
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (!canComplete || saving) ? 0.5 : 1 }}>
            {saving ? '…' : 'Complete'}
          </button>
          <button onClick={() => submit('publish_and_send')} disabled={!canComplete || saving}
            title={!canComplete ? 'Add at least one participant + meeting notes' : 'Complete and notify all participants'}
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (!canComplete || saving) ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Complete & Notify'}
          </button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
