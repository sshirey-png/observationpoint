import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * PIP — Performance Improvement Plan (formerly IAP).
 * V3 family with red HR accents. Draft paradigm + typed acknowledgment
 * collected on the employee side via email link.
 */

const FORM_TYPE = 'performance_improvement_plan'
const CONCERN_OPTIONS = ['Professionalism', 'Performance', 'Commitment']

export default function PIP() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [authStatus, setAuthStatus] = useState({ loading: true, canFile: false })
  useEffect(() => {
    api.get('/api/auth/status').then(r => {
      setAuthStatus({ loading: false, canFile: !!r?.user?.can_file_hr_doc, user: r?.user })
    }).catch(() => setAuthStatus({ loading: false, canFile: false }))
  }, [])

  const [teacher, setTeacher] = useState(null)
  const [concerns, setConcerns] = useState([])
  const [descriptionOfConcern, setDescriptionOfConcern] = useState('')
  const [priorDiscussions, setPriorDiscussions] = useState('')
  const [actionSteps, setActionSteps] = useState('')
  const [indicatorsOfSuccess, setIndicatorsOfSuccess] = useState('')
  const [supportProvided, setSupportProvided] = useState('')
  const [startDate, setStartDate] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const [consequences, setConsequences] = useState('')

  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

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
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=${FORM_TYPE}`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (Array.isArray(fb.concerns)) setConcerns(fb.concerns)
        if (fb.description_of_concern) setDescriptionOfConcern(fb.description_of_concern)
        if (fb.prior_discussions) setPriorDiscussions(fb.prior_discussions)
        if (fb.action_steps) setActionSteps(fb.action_steps)
        if (fb.indicators_of_success) setIndicatorsOfSuccess(fb.indicators_of_success)
        if (fb.support_provided) setSupportProvided(fb.support_provided)
        if (fb.start_date) setStartDate(fb.start_date)
        if (fb.review_date) setReviewDate(fb.review_date)
        if (fb.consequences) setConsequences(fb.consequences)
      } catch (e) {} finally {
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
  }, [teacher, concerns, descriptionOfConcern, priorDiscussions, actionSteps, indicatorsOfSuccess, supportProvided, startDate, reviewDate, consequences])

  function buildBody(status, isPublished) {
    return {
      form_type: FORM_TYPE,
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      notes: descriptionOfConcern,
      feedback: JSON.stringify({
        concerns,
        description_of_concern: descriptionOfConcern,
        prior_discussions: priorDiscussions,
        action_steps: actionSteps,
        indicators_of_success: indicatorsOfSuccess,
        support_provided: supportProvided,
        start_date: startDate,
        review_date: reviewDate,
        consequences,
      }),
    }
  }

  async function autoSave() {
    if (!teacher) return
    setSaveStatus('saving')
    const body = buildBody('draft', false)
    try {
      let res
      if (draftId) {
        res = await api.put(`/api/touchpoints/${draftId}`, body)
      } else {
        res = await api.post('/api/touchpoints', body)
        if (res?.id) setDraftId(res.id)
      }
      if (res?.authorized === false) {
        setAuthStatus({ loading: false, canFile: false })
        return
      }
      setSaveStatus('saved')
      setLastSavedAt(new Date())
    } catch (e) {
      setSaveStatus('error')
    }
  }

  const requiredFilled = (
    concerns.length > 0 &&
    descriptionOfConcern.trim() &&
    priorDiscussions.trim() &&
    actionSteps.trim() &&
    indicatorsOfSuccess.trim() &&
    startDate &&
    reviewDate &&
    consequences.trim()
  )
  const canSubmit = !!teacher && !saving && requiredFilled

  async function submit(mode) {
    if (!teacher) return
    clearTimeout(saveTimerRef.current)
    setSaving(true)
    const asDraft = mode === 'draft'
    const body = buildBody(asDraft ? 'draft' : 'published', !asDraft)
    try {
      let finalId = draftId
      let res
      if (draftId) {
        res = await api.put(`/api/touchpoints/${draftId}`, body)
      } else {
        res = await api.post('/api/touchpoints', body)
        if (res?.id) { setDraftId(res.id); finalId = res.id }
      }
      if (res?.authorized === false) {
        setAuthStatus({ loading: false, canFile: false })
        setSaving(false)
        return
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
            alert('PIP published, but email to employee failed: ' + e.message)
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
    if (!confirm('Abandon this draft? Your work will be deleted.')) return
    try {
      await api.del(`/api/touchpoints/${draftId}`)
      setDraftId(null); setResumedDraft(false)
      setConcerns([]); setDescriptionOfConcern(''); setPriorDiscussions('')
      setActionSteps(''); setIndicatorsOfSuccess(''); setSupportProvided('')
      setStartDate(''); setReviewDate(''); setConsequences('')
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  function toggleConcern(c) {
    setConcerns(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }

  if (authStatus.loading) {
    return (
      <FormShell>
        <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', color: '#6b7280' }}>Loading…</div>
      </FormShell>
    )
  }
  if (!authStatus.canFile) {
    return (
      <FormShell>
        <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#dc2626', fontSize: 28, fontWeight: 800 }}>🔒</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#002f60' }}>Access restricted</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>PIPs are a formal HR document and can only be filed by Leadership, Network staff, or HR admins.</div>
            <button onClick={() => navigate('/')} style={{ marginTop: 18, background: '#002f60', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Back to Home</button>
          </div>
        </div>
      </FormShell>
    )
  }

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#dc2626', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>PIP submitted</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{teacher?.first_name} {teacher?.last_name} will receive an acknowledgment email</div>
          <button
            onClick={() => navigate(teacher ? `/app/staff/${teacher.email}` : '/')}
            style={{ marginTop: 18, background: '#002f60', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >View Profile</button>
        </div>
      </div>
    )
  }

  const input = { width: '100%', padding: '11px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', color: '#111827', background: '#fff', boxSizing: 'border-box' }
  const dateInput = { ...input, textAlign: 'left', WebkitAppearance: 'none', appearance: 'none', minHeight: 44, display: 'block' }
  const textarea = { width: '100%', minHeight: 80, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', lineHeight: 1.5 }
  const cardLabel = { fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 10, marginBottom: 6 }
  const sectionTitle = { fontSize: 15, fontWeight: 800, color: '#111827', margin: '18px 4px 4px' }
  const sectionSub = { fontSize: 11, color: '#6b7280', margin: '0 4px 10px' }

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
          {teacher ? <>{teacher.first_name} {teacher.last_name} · PIP</> : 'Performance Improvement Plan'}</div>
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
          roleLabel="PIP"
        />

        <div style={{ background: '#fef2f2', borderLeft: '4px solid #dc2626', borderRadius: '0 10px 10px 0', padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#991b1b', lineHeight: 1.5 }}>
          <b>Formal HR document.</b> This Performance Improvement Plan (PIP) will be stored in the employee's record and may be referenced in future performance or employment decisions.
        </div>

        <div style={sectionTitle}>
          Performance Improvement Plan
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginLeft: 6 }}>formerly IAP</span>
        </div>
        <div style={sectionSub}>Document the specific performance concern and support provided to date.</div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardLabel}>Area(s) of Concern <span style={{ color: '#dc2626' }}>*</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CONCERN_OPTIONS.map(c => {
              const on = concerns.includes(c)
              return (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: on ? '#fee2e2' : '#f5f7fa', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: on ? '#991b1b' : '#374151', fontWeight: on ? 700 : 400 }}>
                  <input type="checkbox" checked={on} onChange={() => toggleConcern(c)} style={{ width: 16, height: 16, accentColor: '#dc2626' }} />
                  {c}
                </label>
              )
            })}
          </div>
          <div style={cardLabel}>Description of Concern <span style={{ color: '#dc2626' }}>*</span></div>
          <textarea value={descriptionOfConcern} onChange={e => setDescriptionOfConcern(e.target.value)} placeholder="Describe the specific performance or behavioral concern. Include dates, examples, and context." style={textarea} />
          <div style={cardLabel}>Prior Conversations & Support <span style={{ color: '#dc2626' }}>*</span></div>
          <textarea value={priorDiscussions} onChange={e => setPriorDiscussions(e.target.value)} placeholder="What prior conversations, coaching, or support has been provided? Include dates." style={textarea} />
        </div>

        <div style={sectionTitle}>Improvement Plan</div>
        <div style={sectionSub}>What needs to change, how success will be measured, and by when.</div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={cardLabel}>Action Steps for Improvement <span style={{ color: '#dc2626' }}>*</span></div>
          <textarea value={actionSteps} onChange={e => setActionSteps(e.target.value)} placeholder="Specific, measurable steps the employee must take to improve." style={textarea} />
          <div style={cardLabel}>Non-Negotiable Indicators of Success <span style={{ color: '#dc2626' }}>*</span></div>
          <textarea value={indicatorsOfSuccess} onChange={e => setIndicatorsOfSuccess(e.target.value)} placeholder="What must be demonstrated for the PIP to be considered resolved? Be specific." style={textarea} />
          <div style={cardLabel}>Support to be Provided</div>
          <textarea value={supportProvided} onChange={e => setSupportProvided(e.target.value)} placeholder="What support, resources, or coaching will the supervisor provide?" style={{ ...textarea, minHeight: 60 }} />
          <div style={cardLabel}>Timeline <span style={{ color: '#dc2626' }}>*</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Start Date</div>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={dateInput} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>Review Date</div>
              <input type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)} style={dateInput} />
            </div>
          </div>
          <div style={cardLabel}>Consequences if Not Corrected <span style={{ color: '#dc2626' }}>*</span></div>
          <textarea value={consequences} onChange={e => setConsequences(e.target.value)} placeholder="What will happen if the employee does not meet the indicators of success within the timeline?" style={{ ...textarea, minHeight: 60 }} />
        </div>

        <div style={sectionTitle}>Employee Acknowledgment</div>
        <div style={sectionSub}>Typed signature collected via email link after you Submit & Send.</div>

        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#e47727', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>✉</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>How acknowledgment works</div>
              <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.6, marginTop: 4 }}>
                • Submit &amp; Send emails the PIP to the employee<br />
                • Employee clicks a link, reviews the document<br />
                • Employee types their full name to acknowledge receipt<br />
                • Timestamp + IP captured; you're notified
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving || !teacher}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={!canSubmit}
            title={!teacher ? 'Pick a teacher first' : !canSubmit ? 'Fill required fields' : 'Submit PIP internally'}
            style={{ flex: 1.2, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#dc2626', color: '#fff', opacity: !canSubmit ? 0.5 : 1 }}
          >{saving ? '…' : 'Submit PIP'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={!canSubmit}
            title={!teacher ? 'Pick a teacher first' : 'Submit AND email employee for acknowledgment'}
            style={{ flex: 1.4, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#991b1b', color: '#fff', opacity: !canSubmit ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Submit & Send'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
