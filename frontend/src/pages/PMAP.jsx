import { useState } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import RubricCard from '../components/RubricCard'
import { api } from '../lib/api'
import { TEACHER_RUBRIC } from '../lib/rubric-descriptors'
import FormShell from '../components/FormShell'

/**
 * PMAP — Performance Map. Role-aware: we pick the right form_type
 * (pmap_teacher / pmap_leader / pmap_network / pmap_support / pmap_prek)
 * based on the teacher's job_function + job_title. The teacher rubric
 * (T1-T5) is only shown and saved for teacher/prek roles — leader/network/
 * support PMAPs go through the narrative sections only until we wire their
 * rubrics up.
 */

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

// Which PMAP variants use the teacher (T1-T5) rubric that this form renders.
// Others: rubric section hidden until their dims are defined.
const ROLES_WITH_TEACHER_RUBRIC = new Set(['pmap_teacher'])

function TrackButton({ label, value, onChange }) {
  return (
    <div className="mb-2">
      <div className="text-xs font-semibold text-gray-600 mb-1.5">{label}</div>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(value === 'off' ? null : 'off')}
          className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold border-2 transition-all active:scale-95 ${
            value === 'off' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 text-gray-400'
          }`}
        >Off Track</button>
        <button
          onClick={() => onChange(value === 'on' ? null : 'on')}
          className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold border-2 transition-all active:scale-95 ${
            value === 'on' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 text-gray-400'
          }`}
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

  function setScore(code, value) {
    setScores(prev => ({ ...prev, [code]: value }))
  }

  function toggleConcern(item) {
    setConcerns(prev => prev.includes(item) ? prev.filter(c => c !== item) : [...prev, item])
  }

  async function publish() {
    if (!teacher) return
    setSaving(true)
    const formType = pmapFormTypeFor(teacher)
    try {
      await api.post('/api/touchpoints', {
        form_type: formType,
        teacher_email: teacher.email,
        school: teacher.school || '',
        // Only send teacher-rubric scores for variants that use them
        scores: ROLES_WITH_TEACHER_RUBRIC.has(formType) ? scores : {},
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
      })
      setDone(true)
    } catch (e) {
      alert('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  if (done) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-9 text-center mx-4 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3.5">
            <svg width="28" height="28" fill="none" stroke="#059669" strokeWidth="3"><path d="M7 14l5 5 10-10" /></svg>
          </div>
          <div className="text-xl font-bold mb-1">PMAP Published!</div>
          <div className="text-sm text-gray-500 mb-5">{teacher?.first_name} {teacher?.last_name} has been notified</div>
          <button onClick={() => navigate('/')} className="bg-fls-orange text-white px-8 py-3 rounded-xl font-semibold">Done</button>
        </div>
      </div>
    )
  }

  const inputClass = "w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange placeholder:text-gray-400"

  const currentFormType = pmapFormTypeFor(teacher)
  const showTeacherRubric = ROLES_WITH_TEACHER_RUBRIC.has(currentFormType)
  const roleLabel = ({
    pmap_teacher: 'Teacher',
    pmap_prek: 'PreK',
    pmap_leader: 'Leader',
    pmap_network: 'Network',
    pmap_support: 'Support',
  })[currentFormType] || 'Teacher'

  // Validation: every required * field must be non-empty.
  // Rubric cards are required only for the teacher variant.
  const rubricFilled = !showTeacherRubric ||
    TEACHER_RUBRIC.every(d => scores[d.code] != null)
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

  return (
    <FormShell>
    <div className="pb-24">
      <Nav title={`PMAP — ${roleLabel}`} />
      <StaffPicker selected={teacher} onSelect={setTeacher} initialEmail={teacherParam} />
      {teacher && (
        <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
          <Link to={`/app/staff/${teacher.email}`} target="_blank"
            className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-[11px] font-semibold text-fls-navy no-underline">
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16"><path d="M3 8h10m-4-4 4 4-4 4" /></svg>
            History
          </Link>
          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-green-100 text-green-600">PMAP · {roleLabel}</span>
        </div>
      )}

      <div className="px-4">

        {/* 1. Meeting Checklist */}
        <div className="mt-4">
          <div className="text-base font-bold mb-2">Meeting Checklist</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              Has the job description been reviewed? <span className="text-red-500">*</span>
            </div>
            <select value={jobDescReviewed} onChange={e => setJobDescReviewed(e.target.value)}
              className={inputClass + ' bg-white appearance-none'}>
              <option value="">Choose one...</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        {/* 2. WIG + Annual Goals */}
        <div className="mt-4">
          <div className="text-base font-bold mb-2">WIG + Annual Goals Review</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              WIG + Annual Goals <span className="text-red-500">*</span>
            </div>
            <textarea value={goalsNotes} onChange={e => setGoalsNotes(e.target.value)}
              placeholder='Refer to the goals. Note any updates or changes, or write "N/A" if unchanged.'
              rows={3} className={inputClass + ' resize-y'} />

            <div className="mt-3.5 space-y-2">
              <TrackButton label="Wildly Important Goal (WIG) *" value={wigTrack} onChange={setWigTrack} />
              <TrackButton label="Annual Goal 1 (AG1)" value={ag1Track} onChange={setAg1Track} />
              <TrackButton label="Annual Goal 2 (AG2)" value={ag2Track} onChange={setAg2Track} />
              <TrackButton label="Annual Goal 3 (AG3)" value={ag3Track} onChange={setAg3Track} />
            </div>

            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Progress Toward Goal</div>
              <textarea value={progressNotes} onChange={e => setProgressNotes(e.target.value)}
                placeholder="Please provide data to support your ratings above." rows={2} className={inputClass + ' resize-y'} />
            </div>
          </div>
        </div>

        {/* 3. Whirlwind */}
        <div className="mt-4">
          <div className="text-base font-bold mb-1">Whirlwind Work Review</div>
          <div className="text-xs text-gray-400 mb-2">Other responsibilities not defined by your WIG or Annual Goals.</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <textarea value={whirlwind} onChange={e => setWhirlwind(e.target.value)}
              placeholder="List the 3-5 most important aspects of whirlwind work and how those responsibilities are handled effectively."
              rows={3} className={inputClass + ' resize-y'} />
          </div>
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* 4. FLS Teacher Rubric — only for teacher PMAP variants.
            Leader / Network / Support rubrics aren't wired yet; narrative sections below cover them. */}
        {showTeacherRubric ? (
          <>
            <div className="text-base font-bold mb-1">FLS Teacher Rubric</div>
            <div className="text-xs text-gray-400 mb-3">Score each area.</div>

            {TEACHER_RUBRIC.map(dim => (
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

            <div className="bg-white rounded-xl shadow-sm p-4 mt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Additional Comments</div>
              <textarea value={rubricComments} onChange={e => setRubricComments(e.target.value)}
                placeholder="Any additional notes or context here." rows={2} className={inputClass + ' resize-y'} />
            </div>
          </>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            <b>{roleLabel} rubric not yet wired.</b> Teacher dimensions (T1–T5) don't apply here — use the strength / growth / commitment narrative sections below to document performance. Dimension scores won't be saved on this form.
          </div>
        )}

        <div className="h-px bg-gray-200 my-5" />

        {/* 5. Rubric Review */}
        <div className="text-base font-bold mb-1">Rubric Review</div>
        <div className="text-xs text-gray-400 mb-2">Provide input on strength and growth areas.</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              Strength Areas <span className="text-red-500">*</span>
            </div>
            <textarea value={strengthAreas} onChange={e => setStrengthAreas(e.target.value)}
              placeholder="Identify strengths and provide rationale" rows={2} className={inputClass + ' resize-y'} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              Growth Areas <span className="text-red-500">*</span>
            </div>
            <textarea value={growthAreas} onChange={e => setGrowthAreas(e.target.value)}
              placeholder="Identify areas for growth and provide rationale" rows={2} className={inputClass + ' resize-y'} />
          </div>
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* 6. Commitments */}
        <div className="text-base font-bold mb-2">FLS Commitments</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              FLS Commitment Strength <span className="text-red-500">*</span>
            </div>
            <textarea value={commitStrength} onChange={e => setCommitStrength(e.target.value)}
              placeholder="Identify strengths and provide supporting rationale." rows={2} className={inputClass + ' resize-y'} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              FLS Commitment Growth Area <span className="text-red-500">*</span>
            </div>
            <textarea value={commitGrowth} onChange={e => setCommitGrowth(e.target.value)}
              placeholder="Identify growth areas and provide supporting rationale." rows={2} className={inputClass + ' resize-y'} />
          </div>
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* 7. Career */}
        <div className="text-base font-bold mb-2">Professional Development & Career Growth</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="mb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              Career Goals <span className="text-red-500">*</span>
            </div>
            <textarea value={careerGoals} onChange={e => setCareerGoals(e.target.value)}
              placeholder="Reflect on long-term career goals and identify skills, experiences, or opportunities that would help close the gap."
              rows={2} className={inputClass + ' resize-y'} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              Licenses, Certifications, and Trainings <span className="text-red-500">*</span>
            </div>
            <textarea value={licenses} onChange={e => setLicenses(e.target.value)}
              placeholder="Discuss progress towards required licenses, certifications, and trainings. Write N/A if not applicable."
              rows={2} className={inputClass + ' resize-y'} />
          </div>
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* 8. Concerns */}
        <div className="text-base font-bold mb-1">Area(s) of Concern</div>
        <div className="text-xs text-gray-400 mb-2">Indicate if there is an issue that could lead to an IAP or corrective action.</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Area(s) of Concern</div>
          <div className="space-y-1.5 mb-3">
            {['Professionalism', 'Performance', 'Commitment', 'None'].map(item => (
              <label key={item} className="flex items-center gap-2 text-[13px] font-medium cursor-pointer">
                <input type="checkbox" checked={concerns.includes(item)} onChange={() => toggleConcern(item)}
                  className="w-4 h-4 accent-fls-navy" />
                {item}
              </label>
            ))}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Area of Concern Comments <span className="text-red-500">*</span>
          </div>
          <textarea value={concernComments} onChange={e => setConcernComments(e.target.value)}
            placeholder="Include any action steps and non-negotiable indicators of success."
            rows={2} className={inputClass + ' resize-y'} />
        </div>
      </div>

      {/* Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 z-50">
        <button
          onClick={async () => {
            if (!teacher) return
            // Save as draft — bypass validation
            setSaving(true)
            try {
              await api.post('/api/touchpoints', {
                form_type: currentFormType,
                teacher_email: teacher.email,
                school: teacher.school || '',
                status: 'draft',
                is_published: false,
                scores: ROLES_WITH_TEACHER_RUBRIC.has(currentFormType) ? scores : {},
                notes: rubricComments,
                feedback: JSON.stringify({
                  job_desc_reviewed: jobDescReviewed, goals_notes: goalsNotes,
                  wig_track: wigTrack, ag1_track: ag1Track, ag2_track: ag2Track, ag3_track: ag3Track,
                  progress_notes: progressNotes, whirlwind,
                  strength_areas: strengthAreas, growth_areas: growthAreas,
                  commit_strength: commitStrength, commit_growth: commitGrowth,
                  career_goals: careerGoals, licenses, concerns, concern_comments: concernComments,
                }),
              })
              alert('Draft saved')
            } catch (e) { alert('Draft save failed: ' + e.message) }
            setSaving(false)
          }}
          disabled={!teacher || saving}
          className="flex-1 py-3.5 rounded-xl text-sm font-semibold border border-gray-200 disabled:opacity-50">
          Save Draft
        </button>
        <button onClick={publish} disabled={!canPublish}
          title={!canPublish && teacher ? 'Fill in all required fields (*) to publish' : ''}
          className={`flex-1 py-3.5 rounded-xl text-sm font-semibold text-white transition ${canPublish ? 'bg-fls-orange active:scale-95' : 'bg-gray-300 cursor-not-allowed'}`}>
          {saving ? 'Saving…' : 'Publish'}
        </button>
      </div>
    </div>
    </FormShell>
  )
}
