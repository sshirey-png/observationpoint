import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Nav from '../components/Nav'
import StaffPicker from '../components/StaffPicker'
import { api } from '../lib/api'

/**
 * Meeting — Data Meeting (Relay) form.
 * Port of prototypes/meeting-data.html.
 * Standard, initial mastery, know/show, see it/name it, do it (reteach cycle), notes.
 */
export default function Meeting() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')
  const [teacher, setTeacher] = useState(null)
  const [standard, setStandard] = useState('')
  const [initialMastery, setInitialMastery] = useState('')
  const [knowShow, setKnowShow] = useState('')
  const [seeItSuccess, setSeeItSuccess] = useState('')
  const [seeItGrowth, setSeeItGrowth] = useState('')
  const [reteachPlan, setReteachPlan] = useState('')
  const [reteachPrep, setReteachPrep] = useState('')
  const [reteachDate, setReteachDate] = useState('')
  const [reteachMastery, setReteachMastery] = useState('')
  const [reteachReflection, setReteachReflection] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!teacher) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'meeting_data_meeting_(relay)',
        teacher_email: teacher.email,
        school: teacher.school || '',
        notes,
        feedback: JSON.stringify({
          standard,
          initial_mastery: initialMastery,
          know_show_summary: knowShow,
          see_it_success: seeItSuccess,
          see_it_growth: seeItGrowth,
          reteach_plan: reteachPlan,
          reteach_prep: reteachPrep,
          reteach_date: reteachDate,
          reteach_mastery: reteachMastery,
          reteach_reflection: reteachReflection,
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
          <div className="text-xl font-bold mb-1">Meeting Completed!</div>
          <div className="text-sm text-gray-500 mb-5">{teacher?.first_name} {teacher?.last_name} has been notified</div>
          <button onClick={() => navigate('/')} className="bg-fls-orange text-white px-8 py-3 rounded-xl font-semibold">Done</button>
        </div>
      </div>
    )
  }

  function Field({ label, children }) {
    return (
      <div className="mb-3.5 last:mb-0">
        <div className="text-[13px] font-semibold mb-1.5">{label}</div>
        {children}
      </div>
    )
  }

  const inputClass = "w-full px-3 py-3 border border-gray-200 rounded-[10px] text-sm outline-none focus:border-fls-orange placeholder:text-gray-400"
  const textareaClass = `${inputClass} resize-y`

  return (
    <div className="pb-24">
      <Nav title="Data Meeting (Relay)" />
      <StaffPicker selected={teacher} onSelect={setTeacher} initialEmail={teacherParam} />

      <div className="px-4 pt-4">

        {/* Meeting Details */}
        <div className="text-base font-bold mb-2">Data Meeting (Relay)</div>
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <Field label="Standard">
            <input type="text" value={standard} onChange={e => setStandard(e.target.value)} placeholder="Enter standard" className={inputClass} />
          </Field>
          <Field label="Initial Mastery">
            <input type="number" value={initialMastery} onChange={e => setInitialMastery(e.target.value)} placeholder="Enter number" className={inputClass} />
          </Field>
        </div>

        {/* Know/Show */}
        <div className="text-base font-bold mb-2">Know/Show Summary</div>
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <textarea value={knowShow} onChange={e => setKnowShow(e.target.value)} placeholder="Summary of student understanding..." rows={3} className={textareaClass} />
        </div>

        {/* See It / Name It */}
        <div className="text-base font-bold mb-2">See It / Name It</div>
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <Field label="Success">
            <textarea value={seeItSuccess} onChange={e => setSeeItSuccess(e.target.value)} placeholder="What's working?" rows={2} className={textareaClass} />
          </Field>
          <Field label="Area of Growth (Gap)">
            <textarea value={seeItGrowth} onChange={e => setSeeItGrowth(e.target.value)} placeholder="Where is the gap?" rows={2} className={textareaClass} />
          </Field>
        </div>

        {/* Do It */}
        <div className="text-base font-bold mb-2">Do It</div>
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <Field label="Reteach Plan">
            <textarea value={reteachPlan} onChange={e => setReteachPlan(e.target.value)} placeholder="Plan for reteaching..." rows={2} className={textareaClass} />
          </Field>
          <Field label="Reteach Prep">
            <textarea value={reteachPrep} onChange={e => setReteachPrep(e.target.value)} placeholder="Preparation for reteach..." rows={2} className={textareaClass} />
          </Field>
          <Field label="Reteach Date">
            <input type="date" value={reteachDate} onChange={e => setReteachDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Reteach Mastery">
            <input type="number" value={reteachMastery} onChange={e => setReteachMastery(e.target.value)} placeholder="Enter number" className={inputClass} />
          </Field>
          <Field label="Reteach Reflection">
            <textarea value={reteachReflection} onChange={e => setReteachReflection(e.target.value)} placeholder="Reflection on reteach outcomes..." rows={2} className={textareaClass} />
          </Field>
        </div>

        <div className="h-px bg-gray-200 my-5" />

        {/* Notes */}
        <div className="text-base font-bold mb-2">Notes</div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." rows={3} className={textareaClass} />
        </div>
      </div>

      {/* Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] flex gap-2 z-50">
        <button onClick={() => alert('Draft saved')} className="flex-1 py-3.5 rounded-xl text-sm font-semibold border border-gray-200">Save Draft</button>
        <button onClick={submit} disabled={!teacher || saving} className="flex-1 py-3.5 rounded-xl text-sm font-semibold bg-fls-orange text-white disabled:opacity-50">
          {saving ? 'Saving...' : 'Complete'}
        </button>
      </div>
    </div>
  )
}
