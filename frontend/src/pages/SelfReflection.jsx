import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Nav from '../components/Nav'
import RubricCard from '../components/RubricCard'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'
import { TEACHER_RUBRIC, LEADER_RUBRIC } from '../lib/rubric-descriptors'

/**
 * SelfReflection — the teacher/leader/staff reflects on themselves.
 * form_type is self_reflection_* matching their role. No StaffPicker
 * because the user IS the subject. Prefills teacher_email from
 * /api/auth/status so the server-side save is just a POST.
 *
 * Ports prototypes/self-reflection-teacher.html into React.
 */

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
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/api/auth/status')
      .then(r => { setUser(r?.user || null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function setScore(code, value) {
    setScores(prev => ({ ...prev, [code]: value }))
  }

  const formType = selfReflectionFormType(user)
  const activeRubric = RUBRIC_FOR_ROLE[formType] || null
  const showRubric = !!activeRubric
  const roleLabel = ROLE_LABEL[formType] || 'Teacher'

  // Required fields — all PMAP-reflection narrative fields
  const requiredFilled = (
    strengthAreas.trim() &&
    growthAreas.trim() &&
    commitStrength.trim() &&
    commitGrowth.trim() &&
    careerGoals.trim() &&
    licenses.trim()
  )
  const rubricFilled = !showRubric ||
    activeRubric.every(d => scores[d.code] != null)
  const canPublish = requiredFilled && rubricFilled && !saving && user

  async function publish() {
    if (!canPublish) return
    setSaving(true)
    setError('')
    try {
      await api.post('/api/touchpoints', {
        form_type: formType,
        teacher_email: user.email,  // self-reflection: user IS the subject
        school: user.school || '',
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
      })
      setDone(true)
    } catch (e) {
      setError(e.message || 'Failed to save')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <FormShell>
        <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
      </FormShell>
    )
  }

  if (!user) {
    return (
      <FormShell>
        <div className="min-h-screen flex items-center justify-center p-6 text-center">
          <div>
            <div className="text-base font-bold mb-2">Sign in required</div>
            <div className="text-sm text-gray-500">Please sign in to submit a self-reflection.</div>
          </div>
        </div>
      </FormShell>
    )
  }

  if (done) {
    return (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-9 text-center mx-4 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-3.5">
            <svg width="28" height="28" fill="none" stroke="#7c3aed" strokeWidth="3"><path d="M7 14l5 5 10-10" /></svg>
          </div>
          <div className="text-xl font-bold mb-1">Reflection Submitted!</div>
          <div className="text-sm text-gray-500 mb-5">Your leader will review this before your PMAP meeting.</div>
          <button onClick={() => navigate('/')} className="bg-fls-navy text-white px-8 py-3 rounded-xl font-semibold">Done</button>
        </div>
      </div>
    )
  }

  const inputClass = "w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange placeholder:text-gray-400"

  return (
    <FormShell>
      <div className="pb-24">
        <Nav title={`Self-Reflection — ${roleLabel}`} />

        {/* Who this is for */}
        <div className="px-4 py-4 bg-purple-50 border-b border-purple-100">
          <div className="text-[11px] font-bold uppercase tracking-wide text-purple-700">Self-Reflection</div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5">{user.name || user.email}</div>
          <div className="text-xs text-gray-600 mt-0.5">Be honest — this is for your growth. Your leader will see this alongside their own observations.</div>
        </div>

        <div className="px-4">

          {showRubric ? (
            <>
              <div className="mt-4 text-base font-bold mb-1">
                {formType === 'self_reflection_leader' ? 'FLS Leadership Competencies' : 'FLS Teacher Rubric'}
              </div>
              <div className="text-xs text-gray-400 mb-3">Score yourself honestly on each dimension.</div>
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
              <div className="bg-white rounded-xl shadow-sm p-4 mt-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Additional Comments</div>
                <textarea value={rubricComments} onChange={e => setRubricComments(e.target.value)}
                  placeholder="Any additional notes or context." rows={2} className={inputClass + ' resize-y'} />
              </div>
            </>
          ) : null}

          <div className="h-px bg-gray-200 my-5" />

          {/* Rubric Reflection */}
          <div className="text-base font-bold mb-1">Rubric Reflection</div>
          <div className="text-xs text-gray-400 mb-2">What are your strengths, and where do you want to grow?</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Strength Areas <span className="text-red-500">*</span>
              </div>
              <textarea value={strengthAreas} onChange={e => setStrengthAreas(e.target.value)}
                placeholder="What are you doing well? Provide specific examples."
                rows={2} className={inputClass + ' resize-y'} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Growth Areas <span className="text-red-500">*</span>
              </div>
              <textarea value={growthAreas} onChange={e => setGrowthAreas(e.target.value)}
                placeholder="Where do you want to improve? What support would help?"
                rows={2} className={inputClass + ' resize-y'} />
            </div>
          </div>

          <div className="h-px bg-gray-200 my-5" />

          {/* Commitments */}
          <div className="text-base font-bold mb-2">FLS Commitments</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Commitment Strength <span className="text-red-500">*</span>
              </div>
              <textarea value={commitStrength} onChange={e => setCommitStrength(e.target.value)}
                placeholder="Which commitment(s) do you model consistently? Provide examples."
                rows={2} className={inputClass + ' resize-y'} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Commitment Growth Area <span className="text-red-500">*</span>
              </div>
              <textarea value={commitGrowth} onChange={e => setCommitGrowth(e.target.value)}
                placeholder="Which commitment(s) do you want to grow in?"
                rows={2} className={inputClass + ' resize-y'} />
            </div>
          </div>

          <div className="h-px bg-gray-200 my-5" />

          {/* Career */}
          <div className="text-base font-bold mb-2">Professional Development & Career Growth</div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Career Goals <span className="text-red-500">*</span>
              </div>
              <textarea value={careerGoals} onChange={e => setCareerGoals(e.target.value)}
                placeholder="Where do you see yourself in 3-5 years? What skills or experiences would help you get there?"
                rows={2} className={inputClass + ' resize-y'} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Licenses, Certifications, and Trainings <span className="text-red-500">*</span>
              </div>
              <textarea value={licenses} onChange={e => setLicenses(e.target.value)}
                placeholder="Progress towards required certifications. Write N/A if not applicable."
                rows={2} className={inputClass + ' resize-y'} />
            </div>
          </div>

        </div>

        {/* Publish */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] flex gap-2 z-40">
          <button onClick={() => navigate('/')}
            className="flex-1 py-3.5 rounded-xl text-sm font-semibold border border-gray-200 bg-white text-gray-700">
            Cancel
          </button>
          <button onClick={publish} disabled={!canPublish}
            className={`flex-1 py-3.5 rounded-xl text-sm font-bold text-white transition ${canPublish ? 'bg-fls-navy active:scale-95' : 'bg-gray-300 cursor-not-allowed'}`}>
            {saving ? 'Publishing…' : 'Submit Reflection'}
          </button>
        </div>

        {error && (
          <div className="fixed bottom-20 left-4 right-4 bg-red-50 text-red-800 border border-red-200 rounded-lg px-3 py-2 text-xs z-50">
            {error}
          </div>
        )}
      </div>
    </FormShell>
  )
}
