import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * Goals v2 — set + approve Annual Goals (WIG + AG1/AG2/AG3) for a staff member.
 *
 * v2 changes:
 *   - DROPPED the recommended_goals library lookup. Last year's goals ARE the
 *     recommendations now (we have history).
 *   - Added carry-over panel: prior year's goals shown with Use / Edit / Replace
 *   - "Start fresh — new role this year" toggle for seat-changers
 *
 * Permission: subject themselves OR their supervisor OR an admin can edit.
 * Only supervisor/admin can approve.
 */

const GOAL_SLOTS = [
  { type: 'WIG', label: 'Wildly Important Goal', desc: 'Your single most important outcome for the year.' },
  { type: 'AG1', label: 'Annual Goal 1', desc: '' },
  { type: 'AG2', label: 'Annual Goal 2', desc: '' },
  { type: 'AG3', label: 'Annual Goal 3', desc: '' },
]

const SCHOOL_YEAR = '2026-2027'
const PRIOR_YEAR = '2025-2026'

const STATUS_STYLE = {
  draft:     { label: 'Draft',      bg: '#f3f4f6', color: '#6b7280' },
  submitted: { label: 'Submitted',  bg: '#fef3c7', color: '#92400e' },
  approved:  { label: 'Approved',   bg: '#dcfce7', color: '#059669' },
}

export default function Goals() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [user, setUser] = useState(null)
  const [teacher, setTeacher] = useState(null)
  const [goals, setGoals] = useState({})           // this year's
  const [priorGoals, setPriorGoals] = useState({}) // last year's, by goal_type
  const [startFresh, setStartFresh] = useState(false)  // user opted "new role this year"
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [focusType, setFocusType] = useState(null)  // slot to focus after Edit click

  useEffect(() => {
    api.get('/api/auth/status').then(r => setUser(r?.user || null)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!teacher) {
      setGoals({}); setPriorGoals({}); setStartFresh(false)
      return
    }
    // This year's goals
    api.get(`/api/goals/for-teacher?teacher_email=${encodeURIComponent(teacher.email)}&school_year=${SCHOOL_YEAR}`)
      .then(r => {
        const map = {}
        ;(r?.goals || []).forEach(g => { map[g.goal_type] = g })
        setGoals(map)
      }).catch(() => setGoals({}))
    // Prior year's goals (carry-over candidates)
    api.get(`/api/goals/for-teacher?teacher_email=${encodeURIComponent(teacher.email)}&school_year=${PRIOR_YEAR}`)
      .then(r => {
        const map = {}
        ;(r?.goals || []).forEach(g => { map[g.goal_type] = g })
        setPriorGoals(map)
      }).catch(() => setPriorGoals({}))
  }, [teacher])

  function setGoalText(type, text) {
    setGoals(prev => ({
      ...prev,
      [type]: { ...(prev[type] || {}), goal_type: type, goal_text: text }
    }))
    setJustSaved(false)
  }

  function carryOver(type, mode) {
    const prior = priorGoals[type]
    if (!prior?.goal_text) return
    setGoalText(type, prior.goal_text)
    if (mode === 'edit') {
      setFocusType(type)
      setTimeout(() => {
        const el = document.getElementById(`goal-textarea-${type}`)
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
      }, 50)
    }
  }

  function replaceGoal(type) {
    setGoalText(type, '')
    setFocusType(type)
    setTimeout(() => {
      const el = document.getElementById(`goal-textarea-${type}`)
      if (el) el.focus()
    }, 50)
  }

  async function save(newStatus) {
    if (!teacher) return
    setSaving(true)
    try {
      const body = {
        teacher_email: teacher.email,
        school_year: SCHOOL_YEAR,
        status: newStatus,
        goals: GOAL_SLOTS.map(s => ({ goal_type: s.type, goal_text: (goals[s.type]?.goal_text || '').trim() }))
                         .filter(g => g.goal_text),
      }
      const res = await api.post('/api/goals', body)
      if (res?.authorized === false) {
        alert('You are not authorized to edit these goals.')
        setSaving(false); return
      }
      const map = {}
      ;(res?.saved || []).forEach(g => { map[g.goal_type] = g })
      setGoals(prev => ({ ...prev, ...map }))
      setJustSaved(true)
    } catch (e) {
      alert('Save failed: ' + (e?.message || 'unknown error'))
    }
    setSaving(false)
  }

  async function approveGoal(goalId) {
    if (!goalId) return
    try {
      const res = await api.post(`/api/goals/${goalId}/approve`, {})
      if (res?.authorized === false) {
        alert('Only the subject\'s supervisor or an admin can approve.')
        return
      }
      if (res?.goal) {
        setGoals(prev => ({ ...prev, [res.goal.goal_type]: res.goal }))
      }
    } catch (e) {
      alert('Approve failed: ' + (e?.message || 'unknown error'))
    }
  }

  const canSubmit = !!teacher && GOAL_SLOTS.every(s => (goals[s.type]?.goal_text || '').trim().length > 0)
  const allApproved = !!teacher && GOAL_SLOTS.every(s => goals[s.type]?.status === 'approved')
  const isSupervisorOrAdmin = !!user && teacher && (
    user.is_admin ||
    (user.email && user.email.toLowerCase() === (teacher.supervisor_email || '').toLowerCase())
  )
  const hasPrior = Object.keys(priorGoals).length > 0
  const showCarryOver = hasPrior && !startFresh

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
          {teacher ? <>{teacher.first_name} {teacher.last_name} · Annual Goals</> : 'Annual Goals'}</div>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', padding: '6px 12px', background: '#f5f7fa' }}>
        <span>School year: {SCHOOL_YEAR}</span>
        {justSaved && <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>}
      </div>

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>

        <SubjectBlock
          selected={teacher}
          onSelect={setTeacher}
          initialEmail={teacherParam}
          roleLabel="Goals"
        />

        {teacher && hasPrior && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              <b>{Object.keys(priorGoals).length} prior-year goal{Object.keys(priorGoals).length === 1 ? '' : 's'}</b> on file from {PRIOR_YEAR}.
              {!startFresh && ' Use the buttons below to carry over, edit, or replace.'}
            </span>
            <a
              onClick={() => setStartFresh(!startFresh)}
              style={{ color: '#e47727', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontSize: 11, whiteSpace: 'nowrap' }}
            >{startFresh ? 'Show carry-over' : 'Start fresh — new role'}</a>
          </div>
        )}

        {teacher && (
          <>
            {GOAL_SLOTS.map(slot => {
              const g = goals[slot.type] || {}
              const status = g.status || 'draft'
              const statusVis = STATUS_STYLE[status] || STATUS_STYLE.draft
              const isApproved = status === 'approved'
              const prior = priorGoals[slot.type]
              const showPriorCard = showCarryOver && prior?.goal_text && !(g.goal_text || '').trim()
              return (
                <div key={slot.type} style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12, borderLeft: `4px solid ${statusVis.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em', flex: 1 }}>
                      {slot.type} · {slot.label}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, background: statusVis.bg, color: statusVis.color, padding: '2px 8px', borderRadius: 10 }}>{statusVis.label}</span>
                  </div>
                  {slot.desc && <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>{slot.desc}</div>}

                  {showPriorCard && (
                    <div style={{ background: '#eff6ff', border: '1px dashed #bfdbfe', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                        Last year's {slot.type} ({PRIOR_YEAR})
                      </div>
                      <div style={{ fontSize: 13, color: '#1e3a8a', lineHeight: 1.5, marginBottom: 8 }}>{prior.goal_text}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => carryOver(slot.type, 'use')}
                          style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Use as-is
                        </button>
                        <button onClick={() => carryOver(slot.type, 'edit')}
                          style={{ background: '#fff', color: '#1e40af', border: '1.5px solid #bfdbfe', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Edit
                        </button>
                        <button onClick={() => replaceGoal(slot.type)}
                          style={{ background: '#fff', color: '#6b7280', border: '1.5px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Replace
                        </button>
                      </div>
                    </div>
                  )}

                  <textarea
                    id={`goal-textarea-${slot.type}`}
                    value={g.goal_text || ''}
                    onChange={e => setGoalText(slot.type, e.target.value)}
                    placeholder={`Write your ${slot.label.toLowerCase()}...`}
                    disabled={isApproved && !isSupervisorOrAdmin}
                    style={{ width: '100%', minHeight: 80, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', lineHeight: 1.5, background: (isApproved && !isSupervisorOrAdmin) ? '#f9fafb' : '#fff', boxSizing: 'border-box' }}
                  />

                  {status === 'submitted' && isSupervisorOrAdmin && g.id && (
                    <button onClick={() => approveGoal(g.id)}
                      style={{ marginTop: 10, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✓ Approve this goal
                    </button>
                  )}
                </div>
              )
            })}

            {allApproved && (
              <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 14, padding: 14, marginBottom: 12, fontSize: 13, color: '#166534', textAlign: 'center', fontWeight: 600 }}>
                ✓ All 4 goals approved for {SCHOOL_YEAR}
              </div>
            )}
          </>
        )}
      </div>

      {teacher && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 6 }}>
            <button onClick={() => save('draft')} disabled={saving || !teacher}
              style={{ flex: 1, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#f3f4f6', color: '#4b5563', opacity: (saving || !teacher) ? 0.5 : 1 }}
            >Save draft</button>
            <button onClick={() => save('submitted')} disabled={!canSubmit || saving}
              title={!canSubmit ? 'Fill in all 4 goals before submitting' : 'Submit for supervisor approval'}
              style={{ flex: 1.4, padding: '13px 8px', border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: '#002f60', color: '#fff', opacity: (!canSubmit || saving) ? 0.5 : 1 }}
            >{saving ? 'Saving…' : 'Submit for Approval'}</button>
          </div>
        </div>
      )}
    </div>
    </FormShell>
  )
}
