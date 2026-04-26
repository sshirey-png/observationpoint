import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'
import { TEACHER_RUBRIC, LEADER_RUBRIC } from '../lib/rubric-descriptors'
import RubricCard from '../components/RubricCard'

/**
 * PMAP — Performance Map. Role-aware: form_type derived from the person's
 * job_function + job_title.
 *   pmap_teacher  → T1-T5 rubric, FLS Teacher Rubric Review
 *   pmap_prek     → 3 CLASS cycles (PK1-PK10, 1-7), FLS PreK Rubric Review
 *   pmap_leader   → L1-L5 rubric, Personal Leadership block, Whirlwind required
 *   pmap_network  → no rubric, Personal Leadership block
 *   pmap_support  → no rubric, no Personal Leadership block
 *
 * Section 2 (WIG + Annual Goals Review) is GOAL-PULLED:
 *   loads from /api/goals/for-teacher and renders one card per WIG/AG1/AG2/AG3
 *   with read-only goal text + 2-button (amber Off / green On) status row.
 *
 * Carries forward from prior PMAP.jsx:
 *   - inline-style V3 chrome (DESIGN MOCK banner, navy nav, status strip)
 *   - draft paradigm (resume + 2s autosave + abandon)
 *   - 3-button sticky submit bar (Save draft / Publish / Publish & Send)
 *   - SubjectBlock for picking the teacher (no separate hero card)
 */

const SCHOOL_YEAR_FOR_GOALS = '2026-2027'

const CARD = {
  background: '#fff',
  borderRadius: 14,
  padding: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,.05)',
  marginBottom: 12,
}

const SECTION_TITLE = {
  fontSize: 15,
  fontWeight: 800,
  color: '#111827',
  letterSpacing: '-.01em',
  margin: '18px 4px 4px',
}

const SECTION_SUB = {
  fontSize: 12,
  color: '#9ca3af',
  margin: '0 4px 10px',
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

const INPUT = {
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  color: '#111827',
  boxSizing: 'border-box',
}

// Derive the correct PMAP form_type for this person. Mirrors backend
// derive_form_type mapping in app.py.
function pmapFormTypeFor(teacher) {
  const role = (teacher?.job_function || '').toLowerCase()
  const title = (teacher?.job_title || '').toLowerCase()
  if (title.includes('prek') || title.includes('pre-k') || title.includes('pre k')) return 'pmap_prek'
  if (role === 'leadership' || title.includes('principal') || title.includes('director')) return 'pmap_leader'
  if (role === 'network') return 'pmap_network'
  if (role === 'support' || role === 'operations') return 'pmap_support'
  return 'pmap_teacher'
}

// ----------------------------------------------------------------------------
// PreK CLASS dimensions: PK1-PK10 grouped by domain.
// 1-2 red, 3-5 yellow, 6-7 green (per port-pmap-prek mock).
// ----------------------------------------------------------------------------
const PREK_DOMAINS = [
  {
    domain: 'Emotional Support',
    dims: [
      { code: 'PK1', name: 'Positive Climate' },
      { code: 'PK2', name: 'Negative Climate' },
      { code: 'PK3', name: 'Teacher Sensitivity' },
    ],
  },
  {
    domain: 'Classroom Organization',
    dims: [
      { code: 'PK4', name: 'Regard for Student Perspectives' },
      { code: 'PK5', name: 'Behavior Management' },
      { code: 'PK6', name: 'Productivity' },
      { code: 'PK7', name: 'Instructional Learning Formats' },
    ],
  },
  {
    domain: 'Instructional Support',
    dims: [
      { code: 'PK8', name: 'Concept Development' },
      { code: 'PK9', name: 'Quality of Feedback' },
      { code: 'PK10', name: 'Language Modeling' },
    ],
  },
]
const PREK_DIMS_FLAT = PREK_DOMAINS.flatMap(d => d.dims)
const PREK_CONTENT_OPTIONS = ['Lit/Lang Arts', 'Math', 'Social Studies', 'Science']
const PREK_FORMAT_OPTIONS = ['Routine', 'Meals/Snacks', 'Whole Group', 'Individual', 'Small Groups']

function prekColor(v) {
  if (!v) return null
  if (v <= 2) return '#ef4444'
  if (v <= 5) return '#eab308'
  return '#22c55e'
}

// 2-button On/Off status row (amber off, green on) — matches goal-card mock.
function GoalStatusButtons({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        type="button"
        onClick={() => onChange(value === 'off' ? null : 'off')}
        style={{
          flex: 1, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          border: '1.5px solid',
          borderColor: value === 'off' ? '#f59e0b' : '#e5e7eb',
          background: value === 'off' ? '#f59e0b' : '#fff',
          color: value === 'off' ? '#fff' : '#9ca3af',
        }}
      >Off Track</button>
      <button
        type="button"
        onClick={() => onChange(value === 'on' ? null : 'on')}
        style={{
          flex: 1, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
          border: '1.5px solid',
          borderColor: value === 'on' ? '#22c55e' : '#e5e7eb',
          background: value === 'on' ? '#22c55e' : '#fff',
          color: value === 'on' ? '#fff' : '#9ca3af',
        }}
      >On Track</button>
    </div>
  )
}

// One card per goal — read-only goal_text + 2-button status row.
function GoalCard({ slotKey, label, isWig, goal, value, onChange, onEdit }) {
  const accent = isWig ? '#e47727' : '#002f60'
  const tagBg = isWig ? '#e47727' : '#002f60'
  const approvedDate = goal?.approved_at
    ? new Date(goal.approved_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : null
  const fromText = approvedDate
    ? `From Goals · approved ${approvedDate}`
    : `From Goals · ${goal?.status || 'pending approval'}`
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: 14,
      boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10,
      borderLeft: `4px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, color: '#fff', background: tagBg,
          padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '.05em',
        }}>{label}</span>
        <span style={{ fontSize: 10, color: '#9ca3af', flex: 1, textAlign: 'right' }}>{fromText}</span>
        <a
          onClick={onEdit}
          style={{ color: '#e47727', fontSize: 11, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
        >Edit</a>
      </div>
      <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.55, marginBottom: 10 }}>
        {goal?.goal_text || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>(no goal text)</span>}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
        Status this cycle{isWig ? ' *' : ''}
      </div>
      <GoalStatusButtons value={value} onChange={onChange} />
    </div>
  )
}

// PreK Cycle Information block (students/adults/start/end + content + format checkboxes).
function CycleInfoCard({ cycleNum, info, onChange }) {
  function set(field, val) { onChange({ ...info, [field]: val }) }
  function toggle(field, opt) {
    const arr = Array.isArray(info[field]) ? info[field] : []
    const next = arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt]
    onChange({ ...info, [field]: next })
  }
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#002f60', margin: '20px 0 4px' }}>
        Cycle {cycleNum}: Information
      </div>
      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={FIELD_LABEL}>Students</div>
            <input type="number" value={info.students || ''} onChange={e => set('students', e.target.value)} placeholder="0" style={INPUT} />
          </div>
          <div>
            <div style={FIELD_LABEL}>Adults</div>
            <input type="number" value={info.adults || ''} onChange={e => set('adults', e.target.value)} placeholder="0" style={INPUT} />
          </div>
          <div>
            <div style={FIELD_LABEL}>Start Time</div>
            <input type="time" value={info.start || ''} onChange={e => set('start', e.target.value)} style={INPUT} />
          </div>
          <div>
            <div style={FIELD_LABEL}>End Time</div>
            <input type="time" value={info.end || ''} onChange={e => set('end', e.target.value)} style={INPUT} />
          </div>
        </div>
        <div style={FIELD_LABEL}>Academic Content</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PREK_CONTENT_OPTIONS.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '6px 10px', background: '#f5f7fa', borderRadius: 6, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={Array.isArray(info.content) && info.content.includes(opt)}
                onChange={() => toggle('content', opt)}
                style={{ width: 16, height: 16, accentColor: '#002f60' }} />
              {opt}
            </label>
          ))}
        </div>
        <div style={FIELD_LABEL}>Format</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PREK_FORMAT_OPTIONS.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '6px 10px', background: '#f5f7fa', borderRadius: 6, cursor: 'pointer' }}>
              <input type="checkbox"
                checked={Array.isArray(info.format) && info.format.includes(opt)}
                onChange={() => toggle('format', opt)}
                style={{ width: 16, height: 16, accentColor: '#002f60' }} />
              {opt}
            </label>
          ))}
        </div>
      </div>
    </>
  )
}

// Single PreK CLASS dimension card with 1-7 buttons.
function PrekDimCard({ code, name, value, onChange }) {
  const accent = prekColor(value) || '#e5e7eb'
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
      boxShadow: '0 1px 3px rgba(0,0,0,.05)',
      borderLeft: `4px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#002f60', background: 'rgba(0,47,96,.04)', padding: '2px 6px', borderRadius: 4 }}>{code}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 }}>{name}</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5, 6, 7].map(n => {
          const isSel = value === n
          const c = prekColor(n)
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(isSel ? null : n)}
              style={{
                flex: 1, minWidth: 0, height: 40, borderRadius: 8,
                border: `1.5px solid ${isSel ? c : '#e5e7eb'}`,
                background: isSel ? c : '#fff',
                color: isSel ? '#fff' : '#9ca3af',
                fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{n}</button>
          )
        })}
      </div>
    </div>
  )
}

// One full PreK cycle — Information + CLASS scoring (3 domains).
function PrekCycle({ cycleNum, info, onInfoChange, scores, onScoreChange }) {
  return (
    <>
      <CycleInfoCard cycleNum={cycleNum} info={info} onChange={onInfoChange} />
      <div style={{ fontSize: 16, fontWeight: 800, color: '#002f60', margin: '20px 0 4px' }}>
        Cycle {cycleNum}: CLASS Scoring
      </div>
      {PREK_DOMAINS.map(domain => (
        <div key={domain.domain}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', margin: '16px 0 8px' }}>
            {domain.domain}
          </div>
          {domain.dims.map(d => (
            <PrekDimCard
              key={`${d.code}_C${cycleNum}`}
              code={d.code}
              name={d.name}
              value={scores[`${d.code}_C${cycleNum}`] || null}
              onChange={v => onScoreChange(`${d.code}_C${cycleNum}`, v)}
            />
          ))}
        </div>
      ))}
    </>
  )
}

// ----------------------------------------------------------------------------
// PMAP — main component
// ----------------------------------------------------------------------------
export default function PMAP() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)

  // Meeting Checklist
  const [jobDescReviewed, setJobDescReviewed] = useState('')

  // Goals (pulled from /api/goals/for-teacher)
  // Shape: { WIG: {id, goal_text, status, approved_at, ...}, AG1: ..., AG2: ..., AG3: ... }
  const [loadedGoals, setLoadedGoals] = useState({})
  const [goalsLoaded, setGoalsLoaded] = useState(false)

  // Goal status (per-cycle on/off) — same state as before.
  const [wigTrack, setWigTrack] = useState(null)
  const [ag1Track, setAg1Track] = useState(null)
  const [ag2Track, setAg2Track] = useState(null)
  const [ag3Track, setAg3Track] = useState(null)
  const [progressNotes, setProgressNotes] = useState('')

  // Whirlwind
  const [whirlwind, setWhirlwind] = useState('')

  // Rubric scores (T1-T5 / L1-L5 / PreK PK*_C1..C3)
  const [scores, setScores] = useState({})
  const [rubricComments, setRubricComments] = useState('')

  // Rubric Review (Teacher / PreK)
  const [strengthAreas, setStrengthAreas] = useState('')
  const [growthAreas, setGrowthAreas] = useState('')

  // Personal Leadership (Leader / Network)
  const [personalLeadershipStrength, setPersonalLeadershipStrength] = useState('')
  const [personalLeadershipGrowth, setPersonalLeadershipGrowth] = useState('')

  // FLS Commitments (all variants)
  const [commitStrength, setCommitStrength] = useState('')
  const [commitGrowth, setCommitGrowth] = useState('')

  // Career
  const [careerGoals, setCareerGoals] = useState('')
  const [licenses, setLicenses] = useState('')

  // Concerns
  const [concerns, setConcerns] = useState([])
  const [concernComments, setConcernComments] = useState('')

  // PreK cycle info — three blocks of {students, adults, start, end, content[], format[]}
  const [cycle1Info, setCycle1Info] = useState({})
  const [cycle2Info, setCycle2Info] = useState({})
  const [cycle3Info, setCycle3Info] = useState({})

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
  const isTeacher = currentFormType === 'pmap_teacher'
  const isPrek = currentFormType === 'pmap_prek'
  const isLeader = currentFormType === 'pmap_leader'
  const isNetwork = currentFormType === 'pmap_network'
  const isSupport = currentFormType === 'pmap_support'

  // Active rubric for Teacher / Leader. PreK uses its own renderer; Network/Support skip.
  const activeRubric = isTeacher ? TEACHER_RUBRIC : isLeader ? LEADER_RUBRIC : null
  const showStandardRubric = !!activeRubric  // T or L
  const showPersonalLeadership = isLeader || isNetwork
  const showRubricReview = isTeacher || isPrek

  const roleLabel = ({
    pmap_teacher: 'Teacher',
    pmap_prek: 'PreK',
    pmap_leader: 'Leader',
    pmap_network: 'Network',
    pmap_support: 'Support',
  })[currentFormType] || 'Teacher'

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  // Resume existing draft + load goals when teacher selected
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

        if (existing.scores && typeof existing.scores === 'object') {
          setScores(existing.scores)
        }
        if (existing.notes) setRubricComments(existing.notes)

        const fb = (() => {
          try { return existing.feedback ? JSON.parse(existing.feedback) : {} } catch { return {} }
        })()
        if (fb.job_desc_reviewed) setJobDescReviewed(fb.job_desc_reviewed)
        if (fb.wig_track !== undefined) setWigTrack(fb.wig_track)
        if (fb.ag1_track !== undefined) setAg1Track(fb.ag1_track)
        if (fb.ag2_track !== undefined) setAg2Track(fb.ag2_track)
        if (fb.ag3_track !== undefined) setAg3Track(fb.ag3_track)
        if (fb.progress_notes) setProgressNotes(fb.progress_notes)
        if (fb.whirlwind) setWhirlwind(fb.whirlwind)
        if (fb.strength_areas) setStrengthAreas(fb.strength_areas)
        if (fb.growth_areas) setGrowthAreas(fb.growth_areas)
        if (fb.personal_leadership_strength) setPersonalLeadershipStrength(fb.personal_leadership_strength)
        if (fb.personal_leadership_growth) setPersonalLeadershipGrowth(fb.personal_leadership_growth)
        if (fb.commit_strength) setCommitStrength(fb.commit_strength)
        if (fb.commit_growth) setCommitGrowth(fb.commit_growth)
        if (fb.career_goals) setCareerGoals(fb.career_goals)
        if (fb.licenses) setLicenses(fb.licenses)
        if (Array.isArray(fb.concerns)) setConcerns(fb.concerns)
        if (fb.concern_comments) setConcernComments(fb.concern_comments)
        if (fb.cycle1_info && typeof fb.cycle1_info === 'object') setCycle1Info(fb.cycle1_info)
        if (fb.cycle2_info && typeof fb.cycle2_info === 'object') setCycle2Info(fb.cycle2_info)
        if (fb.cycle3_info && typeof fb.cycle3_info === 'object') setCycle3Info(fb.cycle3_info)
      } catch (e) {
        // 404 = no draft, silent
      } finally {
        setTimeout(() => { hydratingRef.current = false }, 100)
      }
    }

    async function loadGoals() {
      setGoalsLoaded(false)
      try {
        const res = await api.get(
          `/api/goals/for-teacher?teacher_email=${encodeURIComponent(teacher.email)}&school_year=${encodeURIComponent(SCHOOL_YEAR_FOR_GOALS)}`
        )
        if (cancelled) return
        const map = {}
          ; (res?.goals || []).forEach(g => {
            if (g.goal_type) map[g.goal_type] = g
          })
        setLoadedGoals(map)
      } catch (e) {
        if (!cancelled) setLoadedGoals({})
      } finally {
        if (!cancelled) setGoalsLoaded(true)
      }
    }

    loadDraft()
    loadGoals()
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
    teacher, jobDescReviewed, wigTrack, ag1Track, ag2Track, ag3Track,
    progressNotes, whirlwind, scores, rubricComments,
    strengthAreas, growthAreas,
    personalLeadershipStrength, personalLeadershipGrowth,
    commitStrength, commitGrowth,
    careerGoals, licenses, concerns, concernComments,
    cycle1Info, cycle2Info, cycle3Info,
  ])

  // Rubric is wired for: Teacher (T1-T5), Leader (L1-L5), PreK (PK*_C1..C3).
  // Network/Support send empty scores.
  const sendsScores = isTeacher || isLeader || isPrek

  function buildBody(status, isPublished) {
    return {
      form_type: currentFormType,
      teacher_email: teacher.email,
      school: teacher.school || '',
      school_year: '2026-2027',
      is_test: true,
      status,
      is_published: isPublished,
      scores: sendsScores ? scores : {},
      notes: rubricComments,
      feedback: JSON.stringify({
        job_desc_reviewed: jobDescReviewed,
        wig_track: wigTrack,
        ag1_track: ag1Track,
        ag2_track: ag2Track,
        ag3_track: ag3Track,
        progress_notes: progressNotes,
        whirlwind,
        strength_areas: strengthAreas,
        growth_areas: growthAreas,
        personal_leadership_strength: personalLeadershipStrength,
        personal_leadership_growth: personalLeadershipGrowth,
        commit_strength: commitStrength,
        commit_growth: commitGrowth,
        career_goals: careerGoals,
        licenses,
        concerns,
        concern_comments: concernComments,
        cycle1_info: cycle1Info,
        cycle2_info: cycle2Info,
        cycle3_info: cycle3Info,
        // Goal IDs the supervisor was rating against (auditing aid).
        goal_ids: {
          WIG: loadedGoals.WIG?.id || null,
          AG1: loadedGoals.AG1?.id || null,
          AG2: loadedGoals.AG2?.id || null,
          AG3: loadedGoals.AG3?.id || null,
        },
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
      setWigTrack(null); setAg1Track(null); setAg2Track(null); setAg3Track(null)
      setProgressNotes(''); setWhirlwind('')
      setScores({}); setRubricComments('')
      setStrengthAreas(''); setGrowthAreas('')
      setPersonalLeadershipStrength(''); setPersonalLeadershipGrowth('')
      setCommitStrength(''); setCommitGrowth('')
      setCareerGoals(''); setLicenses('')
      setConcerns([]); setConcernComments('')
      setCycle1Info({}); setCycle2Info({}); setCycle3Info({})
      setSaveStatus('idle')
    } catch (e) {
      alert('Abandon failed: ' + e.message)
    }
  }

  function gotoEditGoals() {
    if (!teacher) return
    navigate(`/app/goals?teacher=${encodeURIComponent(teacher.email)}`)
  }

  // ---- Goal-aware section bookkeeping ----
  const presentGoalSlots = ['WIG', 'AG1', 'AG2', 'AG3'].filter(k => loadedGoals[k])
  const noGoalsOnFile = goalsLoaded && presentGoalSlots.length === 0
  const goalActiveCount = presentGoalSlots.length

  // Status state per goal slot for validation.
  const trackByKey = { WIG: wigTrack, AG1: ag1Track, AG2: ag2Track, AG3: ag3Track }
  const setTrackByKey = { WIG: setWigTrack, AG1: setAg1Track, AG2: setAg2Track, AG3: setAg3Track }

  // ---- Validation ----
  // Standard rubric (T or L): all dims must have a score.
  const standardRubricFilled = !showStandardRubric || (activeRubric || []).every(d => scores[d.code] != null)
  // PreK rubric: every PK1-PK10 across all 3 cycles must be scored.
  const prekRubricFilled = !isPrek || (
    [1, 2, 3].every(c => PREK_DIMS_FLAT.every(d => scores[`${d.code}_C${c}`] != null))
  )
  // Goals: WIG status required (if WIG goal exists). For AGs, status required only if the AG goal exists.
  const goalsStatusFilled = (
    !goalsLoaded ||
    (presentGoalSlots.length > 0 && presentGoalSlots.every(k => trackByKey[k]))
  )
  // Whirlwind required for Leader.
  const whirlwindFilled = !isLeader || whirlwind.trim().length > 0
  // Rubric Review (strength + growth) required for Teacher + PreK.
  const rubricReviewFilled = !showRubricReview || (strengthAreas.trim() && growthAreas.trim())
  // Personal Leadership (strength + growth) required for Leader + Network.
  const personalLeadershipFilled = !showPersonalLeadership || (
    personalLeadershipStrength.trim() && personalLeadershipGrowth.trim()
  )
  const commonNarrativeFilled = (
    jobDescReviewed &&
    commitStrength.trim() &&
    commitGrowth.trim() &&
    careerGoals.trim() &&
    licenses.trim()
  )
  const concernsFilled = concerns.length === 0 || concernComments.trim()

  const canPublish = !!teacher && !saving && !noGoalsOnFile &&
    standardRubricFilled && prekRubricFilled && goalsStatusFilled &&
    whirlwindFilled && rubricReviewFilled && personalLeadershipFilled &&
    commonNarrativeFilled && concernsFilled

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
            ) : <>new PMAP</>}</div>
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
              <div style={SECTION_TITLE}>Meeting Checklist</div>
              <div style={CARD}>
                <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
                  Has the job description been reviewed? <span style={{ color: '#dc2626' }}>*</span>
                </div>
                <select value={jobDescReviewed} onChange={e => setJobDescReviewed(e.target.value)} style={SELECT}>
                  <option value="">Choose one...</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              {/* 2. WIG + Annual Goals — goal-pulled cards */}
              <div style={SECTION_TITLE}>WIG + Annual Goals Review</div>
              <div style={SECTION_SUB}>
                {goalsLoaded
                  ? (noGoalsOnFile
                    ? `No goals on file for ${SCHOOL_YEAR_FOR_GOALS}`
                    : `Pulled from Goals · ${SCHOOL_YEAR_FOR_GOALS} · ${goalActiveCount} of 4 active`)
                  : `Loading goals for ${SCHOOL_YEAR_FOR_GOALS}…`}
              </div>

              {noGoalsOnFile ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 13, color: '#991b1b' }}>
                  <b>No goals on file for {SCHOOL_YEAR_FOR_GOALS}.</b> Goals must be set before this PMAP can be completed.{' '}
                  <a onClick={gotoEditGoals} style={{ color: '#dc2626', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>
                    Set goals for this teacher →
                  </a>
                </div>
              ) : (
                <>
                  {[
                    { key: 'WIG', label: 'WIG', isWig: true, value: wigTrack, set: setWigTrack },
                    { key: 'AG1', label: 'AG 1', isWig: false, value: ag1Track, set: setAg1Track },
                    { key: 'AG2', label: 'AG 2', isWig: false, value: ag2Track, set: setAg2Track },
                    { key: 'AG3', label: 'AG 3', isWig: false, value: ag3Track, set: setAg3Track },
                  ].map(slot => loadedGoals[slot.key] ? (
                    <GoalCard
                      key={slot.key}
                      slotKey={slot.key}
                      label={slot.label}
                      isWig={slot.isWig}
                      goal={loadedGoals[slot.key]}
                      value={slot.value}
                      onChange={slot.set}
                      onEdit={gotoEditGoals}
                    />
                  ) : null)}

                  <div style={CARD}>
                    <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
                      Progress Toward Goal <span style={{ color: '#dc2626' }}>*</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
                      Free-form narrative — data and context behind the On/Off Track ratings above.
                    </div>
                    <textarea value={progressNotes} onChange={e => setProgressNotes(e.target.value)}
                      placeholder="Provide data and context to support your status ratings above."
                      style={{ ...TEXTAREA, minHeight: 70 }} />
                  </div>
                </>
              )}

              {/* 3. Whirlwind */}
              <div style={SECTION_TITLE}>Whirlwind Work Review</div>
              <div style={SECTION_SUB}>Other responsibilities not defined by your WIG or Annual Goals.</div>
              <div style={CARD}>
                <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
                  Whirlwind Workstream List{isLeader && <span style={{ color: '#dc2626' }}> *</span>}
                </div>
                <textarea value={whirlwind} onChange={e => setWhirlwind(e.target.value)}
                  placeholder="List the 3-5 most important aspects of whirlwind work and how those responsibilities are handled effectively."
                  style={TEXTAREA} />
              </div>

              {/* 4. Rubric — variant-driven */}
              {showStandardRubric && (
                <>
                  <div style={SECTION_TITLE}>
                    {isLeader ? 'FirstLine Leadership Competencies' : 'FLS Teacher Rubric'}
                  </div>
                  <div style={SECTION_SUB}>Score each area.</div>
                  <div style={CARD}>
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
                </>
              )}

              {isPrek && (
                <>
                  <div style={SECTION_TITLE}>FLS PreK CLASS Observation — 3 Cycles</div>
                  <div style={SECTION_SUB}>Score PK1–PK10 (1–7) across three CLASS cycles.</div>
                  <PrekCycle
                    cycleNum={1}
                    info={cycle1Info}
                    onInfoChange={setCycle1Info}
                    scores={scores}
                    onScoreChange={setScore}
                  />
                  <PrekCycle
                    cycleNum={2}
                    info={cycle2Info}
                    onInfoChange={setCycle2Info}
                    scores={scores}
                    onScoreChange={setScore}
                  />
                  <PrekCycle
                    cycleNum={3}
                    info={cycle3Info}
                    onInfoChange={setCycle3Info}
                    scores={scores}
                    onScoreChange={setScore}
                  />
                  <div style={CARD}>
                    <div style={{ ...FIELD_LABEL, marginTop: 0 }}>Additional Comments</div>
                    <textarea value={rubricComments} onChange={e => setRubricComments(e.target.value)}
                      placeholder="Any additional notes or context here."
                      style={{ ...TEXTAREA, minHeight: 56 }} />
                  </div>
                </>
              )}

              {/* 5a. Rubric Review — Teacher / PreK */}
              {showRubricReview && (
                <>
                  <div style={SECTION_TITLE}>
                    {isPrek ? 'FLS PreK Rubric Review' : 'FLS Teacher Rubric Review'}
                  </div>
                  <div style={SECTION_SUB}>Provide input on strength and growth areas.</div>
                  <div style={CARD}>
                    <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
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
                </>
              )}

              {/* 5b. Personal Leadership — Leader / Network */}
              {showPersonalLeadership && (
                <>
                  <div style={SECTION_TITLE}>FLS Personal Leadership</div>
                  <div style={CARD}>
                    <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
                      Personal Leadership Strength <span style={{ color: '#dc2626' }}>*</span>
                    </div>
                    <textarea value={personalLeadershipStrength} onChange={e => setPersonalLeadershipStrength(e.target.value)}
                      placeholder="Identify strengths and provide supporting rationale"
                      style={{ ...TEXTAREA, minHeight: 56 }} />
                    <div style={FIELD_LABEL}>
                      Personal Leadership Growth Area <span style={{ color: '#dc2626' }}>*</span>
                    </div>
                    <textarea value={personalLeadershipGrowth} onChange={e => setPersonalLeadershipGrowth(e.target.value)}
                      placeholder="Identify growth areas and provide supporting rationale"
                      style={{ ...TEXTAREA, minHeight: 56 }} />
                  </div>
                </>
              )}

              {/* 6. FLS Commitments — all variants */}
              <div style={SECTION_TITLE}>FLS Commitments</div>
              <div style={CARD}>
                <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
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

              {/* 7. Career — all variants */}
              <div style={SECTION_TITLE}>Professional Development & Career Growth</div>
              <div style={CARD}>
                <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
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

              {/* 8. Concerns — all variants */}
              <div style={SECTION_TITLE}>Area(s) of Concern</div>
              <div style={SECTION_SUB}>
                Indicate if there is an issue that could lead to a PIP (formerly IAP) or corrective action.
              </div>
              <div style={CARD}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {['Professionalism', 'Performance', 'Commitment', 'None'].map(item => (
                    <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500, color: '#374151', cursor: 'pointer', padding: '4px 0' }}>
                      <input type="checkbox" checked={concerns.includes(item)} onChange={() => toggleConcern(item)}
                        style={{ width: 16, height: 16, accentColor: '#002f60' }} />
                      {item}
                    </label>
                  ))}
                </div>
                <div style={{ ...FIELD_LABEL, marginTop: 0 }}>
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
              title={!teacher ? 'Pick a teacher first' : noGoalsOnFile ? 'Set goals for this teacher first' : !canPublish ? 'Fill in all required fields (*) to publish' : 'Publish — teacher NOT notified yet'}
              style={{ flex: 1, padding: '13px 8px', border: '1.5px solid #002f60', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: '#002f60', opacity: !canPublish ? 0.5 : 1 }}
            >{saving ? '…' : 'Publish'}</button>
            <button onClick={() => submit('publish_and_send')} disabled={!canPublish}
              title={!teacher ? 'Pick a teacher first' : noGoalsOnFile ? 'Set goals for this teacher first' : !canPublish ? 'Fill in all required fields (*) to publish' : 'Publish AND email the teacher now'}
              style={{ flex: 1.3, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: !canPublish ? 0.5 : 1 }}
            >{saving ? 'Saving…' : 'Publish & Send'}</button>
          </div>
        </div>
      </div>
    </FormShell>
  )
}
