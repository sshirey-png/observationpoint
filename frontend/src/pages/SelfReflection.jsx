import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import FormShell from '../components/FormShell'
import RubricCard from '../components/RubricCard'
import { api } from '../lib/api'
import { TEACHER_RUBRIC, LEADER_RUBRIC } from '../lib/rubric-descriptors'

/**
 * SelfReflection — the teacher/leader/staff reflects on themselves.
 * form_type is self_reflection_* matching their role. No StaffPicker
 * because the user IS the subject. Loads the current user from
 * /api/auth/status on mount; that user's email becomes teacher_email.
 *
 * V3 family pattern (matches Fundamentals/Celebrate): draft paradigm +
 * 3-button submit, inline styles, navy nav.
 */

const HERO_BG = { background: 'linear-gradient(135deg, #002f60, #003b7a)' }

function selfReflectionFormType(user) {
  const role = (user?.job_function || '').toLowerCase()
  const title = (user?.job_title || '').toLowerCase()
  if (title.includes('prek') || title.includes('pre-k') || title.includes('pre k')) return 'self_reflection_prek'
  if (role === 'leadership' || title.includes('principal') || title.includes('director')) return 'self_reflection_leader'
  if (role === 'network') return 'self_reflection_network'
  if (role === 'support' || role === 'operations') return 'self_reflection_support'
  return 'self_reflection_teacher'
}

const RUBRIC_FOR_ROLE = {
  self_reflection_teacher: TEACHER_RUBRIC,
  self_reflection_prek: TEACHER_RUBRIC,  // fallback until PK CLASS rubric is wired
  self_reflection_leader: LEADER_RUBRIC,
}

const ROLE_LABEL = {
  self_reflection_teacher: 'Teacher',
  self_reflection_prek: 'PreK',
  self_reflection_leader: 'Leader',
  self_reflection_network: 'Network',
  self_reflection_support: 'Support',
}

export default function SelfReflection() {
  const navigate = useNavigate()

  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const [scores, setScores] = useState({})
  const [rubricComments, setRubricComments] = useState('')
  const [strengthAreas, setStrengthAreas] = useState('')
  const [growthAreas, setGrowthAreas] = useState('')
  const [commitStrength, setCommitStrength] = useState('')
  const [commitGrowth, setCommitGrowth] = useState('')
  const [careerGoals, setCareerGoals] = useState('')
  const [licenses, setLicenses] = useState('')

  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Draft paradigm
  const [draftId, setDraftId] = useState(null)
  const [resumedDraft, setResumedDraft] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const hydratingRef = useRef(false)

  const formType = selfReflectionFormType(user)
  const activeRubric = RUBRIC_FOR_ROLE[formType] || null
  const showRubric = !!activeRubric
  const roleLabel = ROLE_LABEL[formType] || 'Teacher'

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  // Load current user first
  useEffect(() => {
    api.get('/api/auth/status')
      .then(r => { setUser(r?.user || null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Resume existing draft once user is loaded
  useEffect(() => {
    if (!user) return
    hydratingRef.current = true
    let cancelled = false
    async function loadDraft() {
      try {
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(user.email)}&form_type=${formType}`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)
        if (existing.scores && typeof existing.scores === 'object') setScores(existing.scores)
        if (existing.notes) setRubricComments(existing.notes)
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (fb.strength_areas) setStrengthAreas(fb.strength_areas)
        if (fb.growth_areas) setGrowthAreas(fb.growth_areas)
        if (fb.commit_strength) setCommitStrength(fb.commit_strength)
        if (fb.commit_growth) setCommitGrowth(fb.commit_growth)
        if (fb.career_goals) setCareerGoals(fb.career_goals)
        if (fb.licenses) setLicenses(fb.licenses)
      } catch (e) {
        // 404 expected when no draft — silent
      } finally {
        setTimeout(() => { hydratingRef.current = false }, 100)
      }
    }
    loadDraft()
    return () => { cancelled = true }
  }, [user, formType])

  // Debounced auto-save
  useEffect(() => {
    if (!user) return
    if (hydratingRef.current) return
    if (done) return
    // Don't autosave a totally empty form
    const hasAnyContent = (
      Object.keys(scores).length > 0 ||
      rubricComments.trim() ||
      strengthAreas.trim() ||
      growthAreas.trim() ||
      commitStrength.trim() ||
      commitGrowth.trim() ||
      careerGoals.trim() ||
      licenses.trim()
    )
    if (!hasAnyContent) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => autoSave(), 2000)
    return () => clearTimeout(saveTimerRef.current)
    // eslint-disable-next-line
  }, [user, scores, rubricComments, strengthAreas, growthAreas, commitStrength, commitGrowth, careerGoals, licenses])

  function setScore(code, value) {
    setScores(prev => ({ ...prev, [code]: value }))
  }

  function buildBody(status, isPublished) {
    return {
      form_type: formType,
      teacher_email: user.email,  // self-reflection: user IS the subject
      school: user.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      scores: showRubric ? scores : {},
      notes: rubricComments,
      feedback: JSON.stringify({
        strength_areas: strengthAreas,
        growth_areas: growthAreas,
        commit_strength: commitStrength,
        commit_growth: commitGrowth,
        career_goals: careerGoals,
        licenses,
      }),
    }
  }

  async function autoSave() {
    if (!user) return
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

  // Validation — all 6 narrative fields plus (if rubric shown) all dims scored
  const requiredFilled = (
    strengthAreas.trim() &&
    growthAreas.trim() &&
    commitStrength.trim() &&
    commitGrowth.trim() &&
    careerGoals.trim() &&
    licenses.trim()
  )
  const rubricFilled = !showRubric ||
    (activeRubric && activeRubric.every(d => scores[d.code] != null))
  const canPublish = !!(requiredFilled && rubricFilled && user)

  async function submit(mode) {
    // mode: 'draft' | 'publish' | 'publish_and_send'
    if (!user) return
    if (mode !== 'draft' && !canPublish) return
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
            alert('Reflection published, but email notification failed: ' + e.message)
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
      setScores({}); setRubricComments('')
      setStrengthAreas(''); setGrowthAreas('')
      setCommitStrength(''); setCommitGrowth('')
      setCareerGoals(''); setLicenses('')
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  if (loading) {
    return (
      <FormShell>
        <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
      </FormShell>
    )
  }

  if (!user) {
    return (
      <FormShell>
        <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 6 }}>Sign in required</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Please sign in to submit a self-reflection.</div>
          </div>
        </div>
      </FormShell>
    )
  }

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 14l6 6 12-12" /></svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Reflection submitted</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>Your leader will review this before your PMAP meeting.</div>
          <button
            onClick={() => navigate('/')}
            style={{ marginTop: 18, background: '#002f60', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >Done</button>
        </div>
      </div>
    )
  }

  const initials = `${(user.first_name || user.name || user.email || '?')[0] || '?'}${(user.last_name || '')[0] || ''}`.toUpperCase()
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.name || user.email

  return (
    <FormShell>
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '6px 12px', letterSpacing: '.05em' }}>
        DESIGN MOCK · Self-Reflection form
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
          Self-Reflection — {roleLabel}
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

      {resumedDraft && (
        <div style={{ background: '#fff7ed', borderBottom: '1px solid #fed7aa', padding: '10px 14px', fontSize: 11, color: '#9a3412', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>Resumed your draft from earlier. Your work is preserved.</span>
          <a onClick={abandonDraft} style={{ color: '#e47727', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Abandon & start fresh</a>
        </div>
      )}

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>

        {/* Self hero — small, no picker above it */}
        <div style={{ ...HERO_BG, borderRadius: 14, padding: 14, marginBottom: 10, color: '#fff', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 3px 10px rgba(0,47,96,.2)' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e47727', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, flexShrink: 0 }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.65)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Reflecting on</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1.2, marginTop: 2 }}>{displayName}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', marginTop: 2 }}>{user.school || '—'}</div>
          </div>
        </div>

        {/* Rubric (conditional) */}
        {showRubric && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 2 }}>
              {formType === 'self_reflection_leader' ? 'FLS Leadership Competencies' : 'FLS Teacher Rubric'}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>Score yourself honestly on each dimension.</div>
            {activeRubric.map(dim => (
              <RubricCard
                key={dim.code}
                code={dim.code}
                name={dim.name}
                question={dim.question}
                descriptors={dim.descriptors}
                required={true}
                value={scores[dim.code] || null}
                onChange={v => setScore(dim.code, v)}
              />
            ))}
            <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Additional Comments</div>
              <textarea
                value={rubricComments} onChange={e => setRubricComments(e.target.value)}
                placeholder="Any additional notes or context."
                style={{ width: '100%', minHeight: 60, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
              />
            </div>
          </div>
        )}

        {/* Rubric Reflection */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Rubric Reflection</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>What are your strengths, and where do you want to grow?</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Strength Areas <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea value={strengthAreas} onChange={e => setStrengthAreas(e.target.value)}
              placeholder="What are you doing well? Provide specific examples."
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Growth Areas <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea value={growthAreas} onChange={e => setGrowthAreas(e.target.value)}
              placeholder="Where do you want to improve? What support would help?"
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
            />
          </div>
        </div>

        {/* FLS Commitments */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>FLS Commitments</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>How are you living the six commitments?</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Commitment Strength <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea value={commitStrength} onChange={e => setCommitStrength(e.target.value)}
              placeholder="Which commitment(s) do you model consistently? Provide examples."
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Commitment Growth Area <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea value={commitGrowth} onChange={e => setCommitGrowth(e.target.value)}
              placeholder="Which commitment(s) do you want to grow in?"
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
            />
          </div>
        </div>

        {/* Career */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Professional Development & Career Growth</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Where are you headed, and what will help you get there?</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Career Goals <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea value={careerGoals} onChange={e => setCareerGoals(e.target.value)}
              placeholder="Where do you see yourself in 3-5 years? What skills or experiences would help you get there?"
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
              Licenses, Certifications, and Trainings <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea value={licenses} onChange={e => setLicenses(e.target.value)}
              placeholder="Progress towards required certifications. Write N/A if not applicable."
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', color: '#111827' }}
            />
          </div>
        </div>

      </div>

      {/* Sticky 3-button bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: saving ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={saving || !canPublish}
            title="Submit reflection · leader NOT emailed yet"
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: (saving || !canPublish) ? 0.5 : 1 }}
          >{saving ? '…' : 'Publish'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={saving || !canPublish}
            title="Submit AND email your leader now"
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (saving || !canPublish) ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Publish & Send'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
