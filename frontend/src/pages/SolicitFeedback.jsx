import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import SubjectBlock from '../components/SubjectBlock'
import FormShell from '../components/FormShell'
import { api } from '../lib/api'

/**
 * Solicit Feedback — redesigned per mock-solicit-feedback-redesign.html.
 *
 * Two delivery modes:
 *   - email: subject gets a secure response link, fills it out async
 *   - in_person: requestor records the conversation inline
 *
 * Multi-select question bank from solicit_questions.yaml (loaded via
 * /api/solicit-questions). Cap = 3.
 *
 * Two standardized Likert scales (sustainability, flight risk) — always
 * asked. In email mode, subject rates them on the response page. In
 * in-person mode, requestor records the values inline.
 */
export default function SolicitFeedback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const teacherParam = searchParams.get('teacher')

  const [config, setConfig] = useState(null)
  const [teacher, setTeacher] = useState(null)
  const [mode, setMode] = useState('email')  // 'email' | 'in_person'
  const [pickedQuestions, setPickedQuestions] = useState([])  // ordered, max 3
  const [customQuestion, setCustomQuestion] = useState('')
  const [context, setContext] = useState('')
  const [responses, setResponses] = useState({})  // {questionText: response}
  const [likertAnswers, setLikertAnswers] = useState({})  // {scale_id: 1-5}
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api.get('/api/solicit-questions').then(setConfig).catch(() => setConfig({ questions: [], allow_custom: true, max_questions: 3, likert_scales: [] }))
  }, [])

  const cap = config?.max_questions ?? 3
  const allQuestions = [...(config?.questions || [])]
  if (config?.allow_custom) allQuestions.push('__custom__')
  const finalQuestions = pickedQuestions.map(q => q === '__custom__' ? (customQuestion || 'Custom question') : q)

  function toggleQuestion(q) {
    setPickedQuestions(prev => {
      if (prev.includes(q)) return prev.filter(x => x !== q)
      if (prev.length >= cap) return prev  // cap hit
      return [...prev, q]
    })
  }

  const canSubmit = !!teacher
    && pickedQuestions.length > 0
    && (!pickedQuestions.includes('__custom__') || customQuestion.trim().length > 0)
    && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    try {
      const payloadResponses = mode === 'in_person'
        ? finalQuestions.map(q => responses[q] || '')
        : []
      const res = await api.post('/api/touchpoints', {
        form_type: 'solicited_feedback',
        teacher_email: teacher.email,
        school: teacher.school || '',
        school_year: '2026-2027',
        is_test: true,
        status: 'published',
        is_published: true,
        notes: finalQuestions.join(' · '),
        feedback: JSON.stringify({
          mode,
          questions: finalQuestions,
          context: context.trim(),
          // In-person: capture responses + likert here.
          // Email: these stay null until subject submits the response page.
          responses: payloadResponses,
          likert_answers: mode === 'in_person' ? likertAnswers : {},
          // Echo the scale config so the response page (and notify endpoint)
          // doesn't have to re-load the YAML.
          likert_scales: config?.likert_scales || [],
        }),
      })
      if (res?.id) {
        try { await api.post(`/api/touchpoints/${res.id}/notify`, {}) } catch (e) {}
      }
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
          <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>
            {mode === 'email' ? 'Feedback request sent' : 'Recorded'}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
            {mode === 'email'
              ? `Email sent to ${teacher?.first_name} with the questions and a link to share their answers.`
              : `${teacher?.first_name}'s feedback is on their record. They'll receive a thank-you email.`}
          </div>
          <button
            onClick={() => navigate('/')}
            style={{ marginTop: 18, background: '#002f60', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >Done</button>
        </div>
      </div>
    )
  }

  const cardStyle = { background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }
  const cardH = { fontSize: 12, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '.05em' }
  const cardSub = { fontSize: 11, color: '#6b7280', marginTop: 4, marginBottom: 10 }

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
            {teacher ? <>{teacher.first_name} {teacher.last_name} · Solicit Feedback</> : 'Solicit Feedback'}
          </div>
        </nav>

        <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>

          <SubjectBlock
            selected={teacher}
            onSelect={setTeacher}
            initialEmail={teacherParam}
            roleLabel="Solicit"
          />

          {/* Mode toggle */}
          <div style={cardStyle}>
            <div style={cardH}>Delivery</div>
            <div style={cardSub}>How will you collect their feedback?</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { v: 'email', emoji: '📧', label: 'Email', sub: 'Send the questions to answer at their pace' },
                { v: 'in_person', emoji: '🤝', label: 'In Person', sub: 'Record responses live during a conversation' },
              ].map(m => {
                const on = mode === m.v
                return (
                  <button key={m.v}
                    onClick={() => setMode(m.v)}
                    style={{
                      padding: '14px 12px',
                      border: `2px solid ${on ? '#002f60' : '#e5e7eb'}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      textAlign: 'center',
                      background: on ? '#eef4ff' : '#fff',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: on ? '#002f60' : '#374151' }}>{m.emoji} {m.label}</div>
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, lineHeight: 1.3 }}>{m.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Multi-select questions (cap 3) */}
          <div style={cardStyle}>
            <div style={cardH}>Questions</div>
            <div style={cardSub}>Pick up to {cap}.</div>
            {allQuestions.map(q => {
              const on = pickedQuestions.includes(q)
              const disabled = !on && pickedQuestions.length >= cap
              const label = q === '__custom__' ? 'Custom question…' : q
              return (
                <div key={q}
                  onClick={() => !disabled && toggleQuestion(q)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 12px', borderRadius: 8,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    background: on ? '#fff7ed' : 'transparent',
                    color: on ? '#e47727' : '#374151',
                    fontWeight: on ? 700 : 400,
                    opacity: disabled ? 0.45 : 1,
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 5,
                    border: `2px solid ${on ? '#e47727' : '#d1d5db'}`,
                    background: on ? '#e47727' : 'transparent',
                    flexShrink: 0, marginTop: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 10, fontWeight: 800,
                  }}>{on ? '✓' : ''}</div>
                  {label}
                </div>
              )
            })}
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, textAlign: 'right' }}>
              <b style={{ color: '#e47727' }}>{pickedQuestions.length}</b> of {cap} selected
            </div>
          </div>

          {/* Custom question textarea */}
          {pickedQuestions.includes('__custom__') && (
            <div style={cardStyle}>
              <div style={cardH}>Your Question</div>
              <textarea
                value={customQuestion}
                onChange={e => setCustomQuestion(e.target.value)}
                placeholder="Type your question…"
                autoFocus
                style={{ width: '100%', minHeight: 60, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111', resize: 'vertical', marginTop: 8 }}
              />
            </div>
          )}

          {/* Optional context */}
          <div style={cardStyle}>
            <div style={cardH}>Additional Context (optional)</div>
            <div style={cardSub}>Background they'll see alongside the question.</div>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Any background or context…"
              style={{ width: '100%', minHeight: 70, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111', resize: 'vertical' }}
            />
          </div>

          {/* In-person: inline response capture under each picked question */}
          {mode === 'in_person' && finalQuestions.length > 0 && (
            <div style={cardStyle}>
              <div style={cardH}>{teacher?.first_name || 'Their'} responses</div>
              <div style={cardSub}>Capture what they said.</div>
              {finalQuestions.map((q, i) => (
                <div key={i} style={{ background: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{q}</div>
                  <textarea
                    value={responses[q] || ''}
                    onChange={e => setResponses({ ...responses, [q]: e.target.value })}
                    placeholder="Capture the key points of what they shared…"
                    style={{ width: '100%', minHeight: 50, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', resize: 'vertical', background: '#fff' }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Likert scales — preview in email mode, capture in in-person mode */}
          {(config?.likert_scales || []).length > 0 && (
            <div style={cardStyle}>
              <div style={cardH}>
                {mode === 'email'
                  ? <>Likert scales <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: '#9ca3af', fontSize: 10 }}>· always asked · {teacher?.first_name || 'they'} rates these</span></>
                  : <>{teacher?.first_name || 'Their'} Likert ratings</>}
              </div>
              <div style={cardSub}>
                {mode === 'email'
                  ? `Two standardized 1–5 scales ${teacher?.first_name || 'they'} will fill in alongside the open-ended questions.`
                  : 'Capture what they said.'}
              </div>

              {(config?.likert_scales || []).map(s => {
                if (mode === 'email') {
                  return (
                    <div key={s.id} style={{ display: 'flex', gap: 8, fontSize: 11, fontWeight: 700, color: '#374151', background: '#f9fafb', padding: '9px 12px', borderRadius: 8, marginBottom: 6, alignItems: 'center' }}>
                      <span style={{ flex: 1 }}><b>{s.label}</b> — "{s.prompt}"</span>
                      <span style={{ fontSize: 9, color: '#9ca3af' }}>1–5</span>
                    </div>
                  )
                }
                const val = likertAnswers[s.id] || null
                return (
                  <div key={s.id} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{s.label} — "{s.prompt}"</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1, 2, 3, 4, 5].map(n => {
                        const on = val === n
                        const subLabel = n === 1 ? s.low_label : n === 3 ? s.mid_label : n === 5 ? s.high_label : null
                        return (
                          <button
                            key={n}
                            onClick={() => setLikertAnswers({ ...likertAnswers, [s.id]: val === n ? null : n })}
                            style={{
                              flex: 1, padding: '8px 0', border: `2px solid ${on ? '#e47727' : '#e5e7eb'}`,
                              borderRadius: 6, background: on ? '#e47727' : '#fff', textAlign: 'center',
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 800, color: on ? '#fff' : '#9ca3af' }}>{n}</div>
                            {subLabel && (
                              <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: on ? '#fff' : '#9ca3af', marginTop: 2 }}>{subLabel}</div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>

        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{ width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, background: '#002f60', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', opacity: !canSubmit ? 0.5 : 1 }}
            >{saving ? 'Sending…' : (mode === 'email' ? `Send to ${teacher?.first_name || 'teacher'}` : `Save & send ${teacher?.first_name || 'teacher'} a thank-you`)}</button>
          </div>
        </div>

      </div>
    </FormShell>
  )
}
