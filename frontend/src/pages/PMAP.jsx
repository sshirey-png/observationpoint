import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'
import { TEACHER_RUBRIC, LEADER_RUBRIC } from '../lib/rubric-descriptors'
import RubricCard from '../components/RubricCard'

/**
 * PMAP — Performance Map. Role-aware: form_type derived from the person's
 * job_function + job_title. Teacher rubric (T1-T5) for pmap_teacher/pmap_prek;
 * Leader rubric (L1-L5) for pmap_leader; Network/Support are narrative-only.
 *
 * Ported to the Fundamentals/Celebrate navy V3 pattern:
 * - inline styles (not Tailwind at the form level — RubricCard keeps its own)
 * - draft paradigm (resume + 2s autosave + abandon)
 * - 3-button submit bar (Save draft / Publish / Publish & Send)
 */

const CARD = {
  background: '#fff',
  borderRadius: 14,
  padding: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,.05)',
  marginBottom: 12,
}

const SECTION_LABEL = {
  fontSize: 12,
  fontWeight: 800,
  color: '#111827',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
}

const FIELD_LABEL = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  marginBottom: 6,
  marginTop: 10,
}

const TEXTAREA = {
  width: '100%',
  minHeight: 72,
  padding: 12,
  border: '1.5px solid #e5e7eb',
  borderRadius: 10,
  fontSize: 13,
  fontFamily: 'inherit',
  resize: 'vertical',
  color: '#111827',
  boxSizing: 'border-box',
}

const SELECT = {
  width: '100%',
  padding: '11px 12px',
  border: '1.5px solid #e5e7eb',
  borderRadius: 10,
  fontSize: 13,
  fontFamily: 'inherit',
  color: '#111827',
  background: '#fff',
  boxSizing: 'border-box',
}

// Derive the correct PMAP form_type for this person. Mirrors the backend
// derive_form_type mapping in app.py /api/admin/enrich-narrative.
function pmapFormTypeFor(teacher) {
  const role = (teacher?.job_function || '').toLowerCase()
  const title = (teacher?.job_title || '').toLowerCase()
  if (title.includes('prek') || title.includes('pre-k') || title.includes('pre k')) return 'pmap_prek'
  if (role === 'leadership' || title.includes('principal') || title.includes('director')) return 'pmap_leader'
  if (role === 'network') return 'pmap_network'
  if (role === 'support' || role === 'operations') return 'pmap_support'
  return 'pmap_teacher'
}

// Per-role rubric wiring. Teacher + PreK-fallback use T1-T5; Leader uses L1-L5.
// Network/Support don't have a defined rubric yet — narrative-only.
const RUBRIC_FOR_ROLE = {
  pmap_teacher: TEACHER_RUBRIC,
  pmap_prek: TEACHER_RUBRIC,
  pmap_leader: LEADER_RUBRIC,
}

function TrackButton({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#4b5563', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onChange(value === 'off' ? null : 'off')}
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            border: '1.5px solid',
            borderColor: value === 'off' ? '#dc2626' : '#e5e7eb',
            background: value === 'off' ? '#dc2626' : '#fff',
            color: value === 'off' ? '#fff' : '#9ca3af',
          }}
        >Off Track</button>
        <button
          type="button"
          onClick={() => onChange(value === 'on' ? null : 'on')}
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            border: '1.5px solid',
            borderColor: value === 'on' ? '#22c55e' : '#e5e7eb',
            background: value === 'on' ? '#22c55e' : '#fff',
            color: value === 'on' ? '#fff' : '#9ca3af',
          }}
        >On Track</button>
      </div>
    </div>
  )
}

export default function PMAP() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)

  // Meeting Checklist
  const [jobDescReviewed, setJobDescReviewed] = useState('')

  // WIG + Goals
  const [goalsNotes, setGoalsNotes] = useState('')
  const [wigTrack, setWigTrack] = useState(null)
  const [ag1Track, setAg1Track] = useState(null)
  const [ag2Track, setAg2Track] = useState(null)
  const [ag3Track, setAg3Track] = useState(null)
  const [progressNotes, setProgressNotes] = useState('')

  // Whirlwind
  const [whirlwind, setWhirlwind] = useState('')

  // Rubric scores
  const [scores, setScores] = useState({})
  const [rubricComments, setRubricComments] = useState('')

  // Rubric Review
  const [strengthAreas, setStrengthAreas] = useState('')
  const [growthAreas, setGrowthAreas] = useState('')

  // Commitments
  const [commitStrength, setCommitStrength] = useState('')
  const [commitGrowth, setCommitGrowth] = useState('')

  // Career
  const [careerGoals, setCareerGoals] = useState('')
  const [licenses, setLicenses] = useState('')

  // Concerns
  const [concerns, setConcerns] = useState([])
  const [concernComments, setConcernComments] = useState('')

  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Draft paradigm state
  const [draftId, setDraftId] = useState(null)
  const [resumedDraft, setResumedDraft] = useState(false)
  const [saveStatus, setSaveStatus] = useState('idle')  // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const saveTimerRef = useRef(null)
  const hydratingRef = useRef(false)

  const currentFormType = pmapFormTypeFor(teacher)
  const activeRubric = RUBRIC_FOR_ROLE[currentFormType] || null
  const showRubric = !!activeRubric
  const roleLabel = ({
    pmap_teacher: 'Teacher',
    pmap_prek: 'PreK',
    pmap_leader: 'Leader',
    pmap_network: 'Network',
    pmap_support: 'Support',
  })[currentFormType] || 'Teacher'

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  // Resume existing draft when teacher selected
  useEffect(() => {
    if (!teacher) return
    hydratingRef.current = true
    let cancelled = false
    const formType = pmapFormTypeFor(teacher)
    async function loadDraft() {
      try {
        const existing = await api.get(
          `/api/touchpoints/active-draft?teacher_email=${encodeURIComponent(teacher.email)}&form_type=${encodeURIComponent(formType)}`
        )
        if (cancelled || !existing) return
        setDraftId(existing.id)
        setResumedDraft(true)

        // Scores — only hydrate if this role has a rubric
        if (RUBRIC_FOR_ROLE[formType] && existing.scores && typeof existing.scores === 'object') {
          setScores(existing.scores)
        }
        // notes = rubric comments
        if (existing.notes) setRubricComments(existing.notes)

        // feedback JSON holds everything narrative
        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (fb.job_desc_reviewed) setJobDescReviewed(fb.job_desc_reviewed)
        if (fb.goals_notes) setGoalsNotes(fb.goals_notes)
        if (fb.wig_track !== undefined) setWigTrack(fb.wig_track)
        if (fb.ag1_track !== undefined) setAg1Track(fb.ag1_track)
        if (fb.ag2_track !== undefined) setAg2Track(fb.ag2_track)
        if (fb.ag3_track !== undefined) setAg3Track(fb.ag3_track)
        if (fb.progress_notes) setProgressNotes(fb.progress_notes)
        if (fb.whirlwind) setWhirlwind(fb.whirlwind)
        if (fb.strength_areas) setStrengthAreas(fb.strength_areas)
        if (fb.growth_areas) setGrowthAreas(fb.growth_areas)
        if (fb.commit_strength) setCommitStrength(fb.commit_strength)
        if (fb.commit_growth) setCommitGrowth(fb.commit_growth)
        if (fb.career_goals) setCareerGoals(fb.career_goals)
        if (fb.licenses) setLicenses(fb.licenses)
        if (Array.isArray(fb.concerns)) setConcerns(fb.concerns)
        if (fb.concern_comments) setConcernComments(fb.concern_comments)
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
  }, [
    teacher, jobDescReviewed, goalsNotes, wigTrack, ag1Track, ag2Track, ag3Track,
    progressNotes, whirlwind, scores, rubricComments,
    strengthAreas, growthAreas, commitStrength, commitGrowth,
    careerGoals, licenses, concerns, concernComments,
  ])

  function buildBody(status, isPublished) {
    return {
      form_type: currentFormType,
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      // Only send scores for variants that use a wired rubric
      scores: RUBRIC_FOR_ROLE[currentFormType] ? scores : {},
      notes: rubricComments,
      feedback: JSON.stringify({
        job_desc_reviewed: jobDescReviewed,
        goals_notes: goalsNotes,
        wig_track: wigTrack,
        ag1_track: ag1Track,
        ag2_track: ag2Track,
        ag3_track: ag3Track,
        progress_notes: progressNotes,
        whirlwind,
        strength_areas: strengthAreas,
        growth_areas: growthAreas,
        commit_strength: commitStrength,
        commit_growth: commitGrowth,
        career_goals: careerGoals,
        licenses,
        concerns,
        concern_comments: concernComments,
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

  function setScore(code, value) {
    setScores(prev => ({ ...prev, [code]: value }))
  }

  function toggleConcern(item) {
    setConcerns(prev => prev.includes(item) ? prev.filter(c => c !== item) : [...prev, item])
  }

  async function submit(mode) {
    // mode: 'draft' | 'publish' | 'publish_and_send'
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
            alert('PMAP published, but email to teacher failed: ' + e.message)
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
      setJobDescReviewed('')
      setGoalsNotes(''); setWigTrack(null); setAg1Track(null); setAg2Track(null); setAg3Track(null)
      setProgressNotes(''); setWhirlwind('')
      setScores({}); setRubricComments('')
      setStrengthAreas(''); setGrowthAreas('')
      setCommitStrength(''); setCommitGrowth('')
      setCareerGoals(''); setLicenses('')
      setConcerns([]); setConcernComments('')
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  // Validation — publish gate
  const rubricFilled = !showRubric || activeRubric.every(d => scores[d.code] != null)
  const narrativeFilled = (
    jobDescReviewed &&
    goalsNotes.trim() &&
    wigTrack &&
    strengthAreas.trim() &&
    growthAreas.trim() &&
    commitStrength.trim() &&
    commitGrowth.trim() &&
    careerGoals.trim() &&
    licenses.trim()
  )
  const concernsFilled = concerns.length === 0 || concernComments.trim()
  const canPublish = !!teacher && !saving && rubricFilled && narrativeFilled && concernsFilled

  if (done) {
    return (
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#059669', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>PMAP Published</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{teacher?.first_name} {teacher?.last_name} · {roleLabel}</div>
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
        DESIGN MOCK · PMAP form
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
            <>{teacher.first_name} {teacher.last_name} · PMAP · {roleLabel}</>
          ) : <>new PMAP</>}
          <span style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>TEST MODE</span>
        </div>
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
          roleLabel={`PMAP · ${roleLabel}`}
          pickerLabel="Pick a teacher"
        />

        {teacher && (
          <>

            {/* 1. Meeting Checklist */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>Meeting Checklist</div>
              <div style={{ ...FIELD_LABEL, marginTop: 10 }}>
                Has the job description been reviewed? <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <select value={jobDescReviewed} onChange={e => setJobDescReviewed(e.target.value)} style={SELECT}>
                <option value="">Choose one...</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            {/* 2. WIG + Annual Goals */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>WIG + Annual Goals Review</div>
              <div style={{ ...FIELD_LABEL, marginTop: 10 }}>
                WIG + Annual Goals <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={goalsNotes} onChange={e => setGoalsNotes(e.target.value)}
                placeholder='Refer to the goals. Note any updates or changes, or write "N/A" if unchanged.'
                style={TEXTAREA} />

              <div style={{ marginTop: 14 }}>
                <TrackButton label="Wildly Important Goal (WIG) *" value={wigTrack} onChange={setWigTrack} />
                <TrackButton label="Annual Goal 1 (AG1)" value={ag1Track} onChange={setAg1Track} />
                <TrackButton label="Annual Goal 2 (AG2)" value={ag2Track} onChange={setAg2Track} />
                <TrackButton label="Annual Goal 3 (AG3)" value={ag3Track} onChange={setAg3Track} />
              </div>

              <div style={FIELD_LABEL}>Progress Toward Goal</div>
              <textarea value={progressNotes} onChange={e => setProgressNotes(e.target.value)}
                placeholder="Please provide data to support your ratings above."
                style={{ ...TEXTAREA, minHeight: 56 }} />
            </div>

            {/* 3. Whirlwind */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>Whirlwind Work Review</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>
                Other responsibilities not defined by your WIG or Annual Goals.
              </div>
              <textarea value={whirlwind} onChange={e => setWhirlwind(e.target.value)}
                placeholder="List the 3-5 most important aspects of whirlwind work and how those responsibilities are handled effectively."
                style={TEXTAREA} />
            </div>

            {/* 4. Rubric — teacher/prek get T1-T5, leader gets L1-L5.
                Network/support are narrative-only (no rubric). */}
            {showRubric && (
              <div style={CARD}>
                <div style={SECTION_LABEL}>
                  {currentFormType === 'pmap_leader' ? 'FLS Leadership Competencies' : 'FLS Teacher Rubric'}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Score each area.</div>

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

                <div style={FIELD_LABEL}>Additional Comments</div>
                <textarea value={rubricComments} onChange={e => setRubricComments(e.target.value)}
                  placeholder="Any additional notes or context here."
                  style={{ ...TEXTAREA, minHeight: 56 }} />
              </div>
            )}

            {/* 5. Rubric Review */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>Rubric Review</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 8 }}>
                Provide input on strength and growth areas.
              </div>
              <div style={{ ...FIELD_LABEL, marginTop: 4 }}>
                Strength Areas <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={strengthAreas} onChange={e => setStrengthAreas(e.target.value)}
                placeholder="Identify strengths and provide rationale"
                style={{ ...TEXTAREA, minHeight: 56 }} />
              <div style={FIELD_LABEL}>
                Growth Areas <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={growthAreas} onChange={e => setGrowthAreas(e.target.value)}
                placeholder="Identify areas for growth and provide rationale"
                style={{ ...TEXTAREA, minHeight: 56 }} />
            </div>

            {/* 6. Commitments */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>FLS Commitments</div>
              <div style={{ ...FIELD_LABEL, marginTop: 10 }}>
                FLS Commitment Strength <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={commitStrength} onChange={e => setCommitStrength(e.target.value)}
                placeholder="Identify strengths and provide supporting rationale."
                style={{ ...TEXTAREA, minHeight: 56 }} />
              <div style={FIELD_LABEL}>
                FLS Commitment Growth Area <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={commitGrowth} onChange={e => setCommitGrowth(e.target.value)}
                placeholder="Identify growth areas and provide supporting rationale."
                style={{ ...TEXTAREA, minHeight: 56 }} />
            </div>

            {/* 7. Career */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>Professional Development & Career Growth</div>
              <div style={{ ...FIELD_LABEL, marginTop: 10 }}>
                Career Goals <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={careerGoals} onChange={e => setCareerGoals(e.target.value)}
                placeholder="Reflect on long-term career goals and identify skills, experiences, or opportunities that would help close the gap."
                style={{ ...TEXTAREA, minHeight: 56 }} />
              <div style={FIELD_LABEL}>
                Licenses, Certifications, and Trainings <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={licenses} onChange={e => setLicenses(e.target.value)}
                placeholder="Discuss progress towards required licenses, certifications, and trainings. Write N/A if not applicable."
                style={{ ...TEXTAREA, minHeight: 56 }} />
            </div>

            {/* 8. Concerns */}
            <div style={CARD}>
              <div style={SECTION_LABEL}>Area(s) of Concern</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>
                Indicate if there is an issue that could lead to a PIP (formerly IAP) or corrective action.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {['Professionalism', 'Performance', 'Commitment', 'None'].map(item => (
                  <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500, color: '#374151', cursor: 'pointer', padding: '4px 0' }}>
                    <input type="checkbox" checked={concerns.includes(item)} onChange={() => toggleConcern(item)}
                      style={{ width: 16, height: 16, accentColor: '#002f60' }} />
                    {item}
                  </label>
                ))}
              </div>
              <div style={FIELD_LABEL}>
                Area of Concern Comments <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <textarea value={concernComments} onChange={e => setConcernComments(e.target.value)}
                placeholder="Include any action steps and non-negotiable indicators of success."
                style={{ ...TEXTAREA, minHeight: 56 }} />
            </div>
          </>
        )}
      </div>

      {/* Sticky 3-button bar — always rendered; buttons disabled until teacher + validation met */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
          <button onClick={() => submit('draft')} disabled={saving || !teacher}
            style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
          >Save draft</button>
          <button onClick={() => submit('publish')} disabled={!canPublish}
            title={!teacher ? 'Pick a teacher first' : !canPublish ? 'Fill in all required fields (*) to publish' : 'Publish — teacher NOT notified yet'}
            style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: !canPublish ? 0.5 : 1 }}
          >{saving ? '…' : 'Publish'}</button>
          <button onClick={() => submit('publish_and_send')} disabled={!canPublish}
            title={!teacher ? 'Pick a teacher first' : !canPublish ? 'Fill in all required fields (*) to publish' : 'Publish AND email the teacher now'}
            style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: !canPublish ? 0.5 : 1 }}
          >{saving ? 'Saving…' : 'Publish & Send'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
