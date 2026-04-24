import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

const QUESTIONS = [
  'How is your workload right now?',
  'How are you feeling about your goals?',
  'What support do you need from me?',
  'How is the team culture feeling?',
  'Custom question',
]

function PulseScale({ label, sub, lowLabel, midLabel, highLabel, value, onChange }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>{sub}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => {
          const on = value === n
          const labels = { 1: lowLabel, 3: midLabel, 5: highLabel }
          return (
            <button
              key={n}
              onClick={() => onChange(value === n ? null : n)}
              style={{ flex: 1, padding: '10px 0', border: `2px solid ${on ? '#e47727' : '#e5e7eb'}`, borderRadius: 10, background: on ? '#e47727' : '#fff', textAlign: 'center', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span style={{ display: 'block', fontSize: 16, fontWeight: 800, color: on ? '#fff' : '#9ca3af' }}>{n}</span>
              {labels[n] && (
                <span style={{ display: 'block', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: on ? '#fff' : '#9ca3af', marginTop: 2 }}>{labels[n]}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function SolicitFeedback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [teacher, setTeacher] = useState(null)
  const [selectedQuestion, setSelectedQuestion] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [context, setContext] = useState('')
  const [sustainability, setSustainability] = useState(null)
  const [flightRisk, setFlightRisk] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const isCustom = selectedQuestion === 'Custom question'
  const canSubmit = !!teacher && !!selectedQuestion && (!isCustom || !!customQuestion.trim()) && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      await api.post('/api/touchpoints', {
        form_type: 'solicited_feedback',
        teacher_email: teacher.email,
        school: teacher.school || '',
        school_year: '2026-2027',
        is_test: true,
        status: 'published',
        is_published: true,
        notes: isCustom ? customQuestion : selectedQuestion,
        feedback: JSON.stringify({
          question: isCustom ? customQuestion : selectedQuestion,
          context,
          sustainability,
          flight_risk: flightRisk,
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
      <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 24px rgba(0,0,0,.1)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#2563eb', fontSize: 28, fontWeight: 800 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Feedback request sent</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>{teacher?.first_name} will see this in ObservationPoint</div>
          <button
            onClick={() => navigate('/')}
            style={{ marginTop: 18, background: '#002f60', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >Done</button>
        </div>
      </div>
    )
  }

  return (
    <FormShell>
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '6px 12px', letterSpacing: '.05em' }}>
        DESIGN MOCK · Solicit Feedback form
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
          {teacher ? <>{teacher.first_name} {teacher.last_name} · Solicit Feedback</> : 'Solicit Feedback'}
          <span style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>TEST MODE</span>
        </div>
      </nav>

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>

        <SubjectBlock
          selected={teacher}
          onSelect={setTeacher}
          initialEmail={teacherParam}
          roleLabel="Solicit"
        />

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>What are you asking about?</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Pick a template, or choose "Custom" to write your own.</div>
          {QUESTIONS.map(q => {
            const on = selectedQuestion === q
            return (
              <div
                key={q}
                onClick={() => setSelectedQuestion(q)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: on ? '#fff7ed' : 'transparent', color: on ? '#e47727' : '#374151', fontWeight: on ? 700 : 400 }}
              >
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${on ? '#e47727' : '#d1d5db'}`, background: on ? '#e47727' : 'transparent', flexShrink: 0 }} />
                {q}
              </div>
            )
          })}
        </div>

        {isCustom && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Your Question</div>
            <textarea
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="Type your question for the teacher..."
              autoFocus
              style={{ width: '100%', minHeight: 70, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical', marginTop: 8 }}
            />
          </div>
        )}

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }}>Additional Context (optional)</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }}>Background the teacher will see alongside the question.</div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Any background or context for the teacher..."
            style={{ width: '100%', minHeight: 70, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'vertical' }}
          />
        </div>

        <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', margin: '18px 4px 4px' }}>Quick Pulse (optional)</div>
        <div style={{ fontSize: 11, color: '#6b7280', margin: '0 4px 10px' }}>How would you rate this teacher's current engagement?</div>

        <PulseScale
          label="Sustainability"
          sub="Is this teacher's workload sustainable?"
          lowLabel="Not at all" midLabel="Neutral" highLabel="Very"
          value={sustainability} onChange={setSustainability}
        />
        <PulseScale
          label="Flight Risk"
          sub="How likely is this teacher to stay next year?"
          lowLabel="Leaving" midLabel="50/50" highLabel="Locked in"
          value={flightRisk} onChange={setFlightRisk}
        />
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <button
            onClick={submit}
            disabled={!canSubmit}
            style={{ width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#002f60', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', opacity: !canSubmit ? 0.5 : 1 }}
          >{saving ? 'Sending…' : 'Send to Teacher'}</button>
        </div>
      </div>
    </div>
    </FormShell>
  )
}
