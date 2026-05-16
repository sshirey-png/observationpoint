import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import FormShell from '../components/FormShell'
import SendCopyToggle from '../components/SendCopyToggle'
import { api } from '../lib/api'

/**
 * Meeting Notes — multi-participant touchpoint.
 * V3 family. Replaces SubjectBlock with a chip-based multi-participant picker
 * since meetings can have many people (not just one subject).
 *
 * form_type = 'meeting_notes'
 * Stored as a single touchpoint with the FIRST participant as teacher_email
 * and the rest in feedback.participants[]. Absentees in feedback.absentees[].
 * feedback also carries: is_recurring, series_name, links[] (URL chips).
 * File attachments live in the uploads table linked by parent_type='touchpoint'.
 */

const FORM_TYPE = 'meeting_notes'

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

  const [name, setName] = useState('Meeting Notes')
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [meetingTime, setMeetingTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const [participants, setParticipants] = useState([])
  const [absentees, setAbsentees] = useState([])
  const [discussed, setDiscussed] = useState('')
  const [nextSteps, setNextSteps] = useState('')

  // Recurring-series state (per mock: Make-recurring toggle + Continue-a-series picker)
  const [isRecurring, setIsRecurring] = useState(false)
  const [seriesName, setSeriesName] = useState('')
  const [seriesOptions, setSeriesOptions] = useState([])
  const [pickedSeriesId, setPickedSeriesId] = useState(null)
  const [picking, setPicking] = useState(false)
  const [prevMeeting, setPrevMeeting] = useState(null)  // { discussed, next_steps, attachments[] } from last in series

  // Attachments — links (client-side JSON in feedback) + uploaded files (uploads table)
  const [links, setLinks] = useState([])              // [{ url, label }]
  const [attachments, setAttachments] = useState([])  // uploaded files for THIS draft, polled from /api/uploads
  const [uploadingFiles, setUploadingFiles] = useState(0)
  const fileInputRef = useRef(null)

  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [ccSelf, setCcSelf] = useState(false)
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
        if (fb.is_recurring) setIsRecurring(true)
        if (fb.series_name) setSeriesName(fb.series_name)
        if (Array.isArray(fb.links)) setLinks(fb.links)
        // Refresh file attachments for the resumed draft from the uploads table
        try {
          const ups = await api.get(`/api/uploads?parent_type=touchpoint&parent_id=${encodeURIComponent(existing.id)}`)
          if (!cancelled && Array.isArray(ups)) setAttachments(ups)
        } catch {}
        setTimeout(() => { hydratingRef.current = false }, 100)
      } catch (e) {}
    }
    loadDraft()
    return () => { cancelled = true }
  }, [])

  // Load the user's recurring series for the "Continue a series" picker
  useEffect(() => {
    let cancelled = false
    api.get('/api/me/recurring-series')
       .then(s => { if (!cancelled && Array.isArray(s)) setSeriesOptions(s) })
       .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (hydratingRef.current || done) return
    if (participants.length === 0 && !discussed && !nextSteps && links.length === 0) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [name, meetingDate, meetingTime, participants, absentees, discussed, nextSteps, isRecurring, seriesName, links])

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
        cc_self: ccSelf,
        is_recurring: !!isRecurring,
        series_name: isRecurring ? (seriesName || name) : '',
        links,           // [{ url, label }] — file attachments are in the uploads table
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

  // ── Continue-a-series: pre-fill from a picked series + load last meeting's
  // notes (read-only context) + carry over its links/attachments by default.
  async function pickSeries(s) {
    if (!s) return
    setPicking(true)
    try {
      hydratingRef.current = true
      setName(s.series_name || name)
      setSeriesName(s.series_name || '')
      setIsRecurring(true)
      setPickedSeriesId(s.last_touchpoint_id || null)
      if (Array.isArray(s.participants)) setParticipants(s.participants)
      // Load last meeting's notes (read-only context) + carry forward links
      if (s.last_touchpoint_id) {
        try {
          const prev = await api.get(`/api/touchpoint/${s.last_touchpoint_id}/full-detail`)
          let fb = {}
          try { fb = prev?.feedback ? JSON.parse(prev.feedback) : {} } catch {}
          setPrevMeeting({
            date: s.last_date,
            discussed: fb.discussed || '',
            next_steps: fb.next_steps || '',
            links: Array.isArray(fb.links) ? fb.links : [],
          })
          if (Array.isArray(fb.links)) setLinks(fb.links)
        } catch {}
      }
      setTimeout(() => { hydratingRef.current = false }, 150)
    } finally { setPicking(false) }
  }

  // ── Attachments: links are JSON in feedback; files use the existing /api/uploads/* flow
  function addLink() {
    const url = window.prompt('Paste a URL (Google Doc, Drive, etc.)')
    if (!url || !url.trim()) return
    const label = window.prompt('Label for this link (optional)', '') || ''
    setLinks(ls => [...ls, { url: url.trim(), label: label.trim() || url.trim() }])
  }
  function removeLink(idx) { setLinks(ls => ls.filter((_, i) => i !== idx)) }

  async function ensureDraftId() {
    if (draftId) return draftId
    setSaveStatus('saving')
    const body = await buildBody('draft', false)
    const res = await api.post('/api/touchpoints', body)
    if (res?.id) {
      setDraftId(res.id)
      setSaveStatus('saved'); setLastSavedAt(new Date())
      return res.id
    }
    throw new Error('Could not create draft to attach to')
  }

  async function uploadFile(file) {
    if (!file) return
    setUploadingFiles(n => n + 1)
    try {
      const tid = await ensureDraftId()
      const signRes = await api.post('/api/uploads/sign', {
        parent_type: 'touchpoint',
        parent_id: tid,
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        form_type: FORM_TYPE,
      })
      const putRes = await fetch(signRes.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': signRes.mime_type || file.type || 'application/octet-stream' },
        body: file,
      })
      if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`)
      const finalized = await api.post(`/api/uploads/${signRes.upload_id}/finalize`, {})
      setAttachments(a => [{ ...finalized, uploaded_at: new Date().toISOString() }, ...a])
    } catch (e) {
      alert('Upload failed: ' + (e?.message || 'unknown error'))
    } finally {
      setUploadingFiles(n => Math.max(0, n - 1))
    }
  }

  async function removeAttachment(uploadId) {
    if (!confirm('Remove this attachment?')) return
    try {
      await api.del(`/api/uploads/${uploadId}`)
      setAttachments(a => a.filter(x => x.id !== uploadId))
    } catch (e) { alert('Could not remove: ' + (e?.message || 'error')) }
  }

  async function openAttachment(uploadId) {
    try {
      const dl = await api.get(`/api/uploads/${uploadId}/download`)
      if (dl?.url) window.open(dl.url, '_blank')
    } catch (e) { alert('Could not open: ' + (e?.message || 'error')) }
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
      setName('Meeting Notes'); setParticipants([]); setAbsentees([])
      setDiscussed(''); setNextSteps('')
      setIsRecurring(false); setSeriesName(''); setPickedSeriesId(null); setPrevMeeting(null)
      setLinks([]); setAttachments([])
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
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>Meeting Notes</div>
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

        {/* Continue-a-series picker — shown when there are recurring series + we haven't picked yet */}
        {seriesOptions.length > 0 && !pickedSeriesId && !isRecurring && !resumedDraft && (
          <div style={{ border: '1.5px solid #e47727', background: 'linear-gradient(135deg,#fff7ed,#ffffff)', borderRadius: 14, padding: 14, marginBottom: 12, boxShadow: '0 1px 3px rgba(228,119,39,.15)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>📂 Continue a series</span>
              <span style={{ fontSize: 10, color: '#9ca3af', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{seriesOptions.length} recent</span>
            </div>
            {seriesOptions.slice(0, 4).map((s, i) => (
              <button key={i} type="button" onClick={() => pickSeries(s)} disabled={picking}
                style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', marginBottom: 7, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>🗓</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{s.series_name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {(s.participants || []).slice(0, 3).map(p => p.name).join(' · ')}
                    {(s.participants || []).length > 3 ? ` · +${s.participants.length - 3}` : ''}
                    {s.last_date ? ` · last ${s.last_date.slice(5).replace('-', '/')}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e47727', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 11, padding: '3px 9px', flexShrink: 0 }}>{s.count} prior</div>
                <div style={{ color: '#9ca3af', fontSize: 18, flexShrink: 0 }}>›</div>
              </button>
            ))}
            <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#6b7280', padding: 8, marginTop: 3 }}>Start fresh — one-off meeting ↓</div>
          </div>
        )}

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#111827', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Meeting Details</span>
            {pickedSeriesId && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#e47727', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 11, padding: '3px 9px', textTransform: 'none', letterSpacing: 0 }}>▸ Series</span>
            )}
          </div>
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

          {/* Make-this-a-recurring-meeting toggle (per mock State 1). Hidden if user is mid-series — that's already recurring by definition. */}
          {!pickedSeriesId && (
            <div onClick={() => setIsRecurring(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', marginTop: 12,
                       border: isRecurring ? '1.5px solid #e47727' : '1.5px dashed #e5e7eb',
                       borderRadius: 10, background: isRecurring ? '#fff7ed' : '#fafafa', cursor: 'pointer' }}>
              <div style={{ position: 'relative', width: 38, height: 22, background: isRecurring ? '#e47727' : '#e5e7eb', borderRadius: 11, flexShrink: 0, transition: 'background .15s' }}>
                <div style={{ position: 'absolute', top: 2, left: isRecurring ? 18 : 2, width: 18, height: 18, background: '#fff', borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .15s' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Make this a recurring meeting</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>From next week, you'll see this series at the top of the form.</div>
              </div>
            </div>
          )}
          {isRecurring && !pickedSeriesId && (
            <div style={{ marginTop: 10, paddingLeft: 49 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#e47727', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Series name (groups future meetings)</div>
              <input type="text" value={seriesName} onChange={e => setSeriesName(e.target.value)} placeholder={name}
                style={{ width: '100%', padding: '9px 11px', border: '1.5px solid #fed7aa', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: '#111827', background: '#fff', boxSizing: 'border-box' }}
              />
            </div>
          )}
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

          {/* Previous notes (read-only) — shown when continuing a series and we loaded the prior meeting */}
          {prevMeeting && (
            <details open style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
              <summary style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', cursor: 'pointer', listStyle: 'none' }}>
                📜 Previous notes{prevMeeting.date ? ` · ${prevMeeting.date.slice(5).replace('-', '/')}` : ''} · click to collapse
              </summary>
              {prevMeeting.discussed && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 10, marginBottom: 3 }}>What was discussed</div>
                  <p style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{prevMeeting.discussed}</p>
                </>
              )}
              {prevMeeting.next_steps && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 8, marginBottom: 3 }}>Next steps</div>
                  <p style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{prevMeeting.next_steps}</p>
                </>
              )}
              {(prevMeeting.links || []).length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 8, marginBottom: 3 }}>Last week's links</div>
                  <div>{prevMeeting.links.map((l, i) => (
                    <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#002f60', background: '#eef4ff', border: '1px solid #c7d2fe', borderRadius: 9, padding: '4px 9px', marginRight: 5, marginTop: 4, textDecoration: 'none', fontWeight: 600 }}>🔗 {l.label || l.url}</a>
                  ))}</div>
                </>
              )}
            </details>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 6, marginBottom: 6 }}>What was discussed?</div>
          <textarea value={discussed} onChange={e => setDiscussed(e.target.value)} placeholder="Topics covered, decisions made, key takeaways..."
            style={{ width: '100%', minHeight: 90, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginTop: 10, marginBottom: 6 }}>What are the next steps?</div>
          <textarea value={nextSteps} onChange={e => setNextSteps(e.target.value)} placeholder="Action items, owners, deadlines..."
            style={{ width: '100%', minHeight: 90, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', lineHeight: 1.5 }} />

          {/* Attachments & links */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9ca3af', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📎 Attachments &amp; links</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'none', letterSpacing: 0 }}>· optional</span>
            </div>
            {(links.length > 0 || attachments.length > 0) && (
              <div style={{ marginBottom: 7 }}>
                {links.map((l, i) => (
                  <span key={`l${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', border: '1px solid #c7d2fe', background: '#eef4ff', color: '#002f60', borderRadius: 9, fontSize: 12, fontWeight: 600, margin: '4px 5px 0 0', maxWidth: '100%' }}>
                    <span style={{ fontSize: 14 }}>🔗</span>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.url}>{l.label || l.url}</a>
                    <span onClick={() => removeLink(i)} style={{ opacity: 0.6, cursor: 'pointer', marginLeft: 2 }}>×</span>
                  </span>
                ))}
                {attachments.map(a => (
                  <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', border: '1px solid #c7d2fe', background: '#eef4ff', color: '#002f60', borderRadius: 9, fontSize: 12, fontWeight: 600, margin: '4px 5px 0 0', maxWidth: '100%' }}>
                    <span style={{ fontSize: 14 }}>📄</span>
                    <span onClick={() => openAttachment(a.id)} style={{ cursor: 'pointer', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.filename}>{a.filename}</span>
                    <span onClick={() => removeAttachment(a.id)} style={{ opacity: 0.6, cursor: 'pointer', marginLeft: 2 }}>×</span>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 4 }}>
              <button type="button" onClick={addLink}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', border: '1.5px dashed #c7d2fe', background: '#fff', color: '#002f60', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                🔗 Add link
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingFiles > 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 11px', border: '1.5px dashed #c7d2fe', background: '#fff', color: '#002f60', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: uploadingFiles > 0 ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: uploadingFiles > 0 ? 0.6 : 1 }}>
                📁 {uploadingFiles > 0 ? `Uploading ${uploadingFiles}…` : 'Upload file'}
              </button>
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
                onChange={e => { const fs = Array.from(e.target.files || []); fs.forEach(uploadFile); e.target.value = '' }} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <SendCopyToggle checked={ccSelf} onChange={setCcSelf} />
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
