import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

/**
 * FeedbackResponse — public page reached from the email link a staff
 * member receives when their supervisor submits Solicit Feedback in
 * email mode. Token-gated, no login.
 *
 * Loads /api/feedback-respond/<token>, lets the subject answer the
 * open-ended questions + Likert scales, posts back to the same endpoint.
 */
export default function FeedbackResponse() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [responses, setResponses] = useState([])
  const [likert, setLikert] = useState({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) return
    api.get(`/api/feedback-respond/${token}`)
      .then(d => {
        if (d?.error) { setErr(d.error); setLoading(false); return }
        setData(d)
        setResponses(new Array((d.questions || []).length).fill(''))
        if (d.already_responded) setDone(true)
        setLoading(false)
      })
      .catch(e => { setErr(String(e)); setLoading(false) })
  }, [token])

  // Default Likert config if backend doesn't provide one
  const defaultLikertScales = [
    { id: 'sustainability', label: 'Sustainability', prompt: 'Is your workload sustainable?', low_label: 'Not at all', mid_label: 'Neutral', high_label: 'Very' },
    { id: 'flight_risk',    label: 'Flight risk',   prompt: 'How likely are you to stay at FirstLine next year?', low_label: 'Leaving', mid_label: '50/50', high_label: 'Locked in' },
  ]
  const scales = (data?.likert_scales && data.likert_scales.length) ? data.likert_scales : defaultLikertScales

  async function submit() {
    setSaving(true)
    try {
      const r = await api.post(`/api/feedback-respond/${token}`, {
        responses,
        likert_answers: likert,
      })
      if (r?.ok || r?.already_responded) setDone(true)
      else setErr(r?.error || 'submit failed')
    } catch (e) {
      setErr(String(e))
    }
    setSaving(false)
  }

  const navy = '#002f60'
  const wrap = { minHeight: '100svh', background: '#f5f7fa', fontFamily: 'Inter, sans-serif' }
  const nav = { background: navy, padding: '14px 16px', textAlign: 'center', color: '#fff' }
  const card = { background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }
  const cardH = { fontSize: 13, fontWeight: 800, color: '#111', marginBottom: 8, lineHeight: 1.4 }
  const ta = { width: '100%', minHeight: 80, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: '#111', resize: 'vertical', boxSizing: 'border-box' }

  if (loading) return <div style={{ ...wrap, padding: 60, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>

  if (err && !data) {
    return (
      <div style={{ ...wrap, padding: 40, textAlign: 'center' }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 24, maxWidth: 380, margin: '60px auto', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: navy, marginBottom: 6 }}>Link not found</div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>This feedback link may have expired or already been used. Check your email for the latest link, or reach out to the person who sent it.</div>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={{ ...wrap, padding: 40, textAlign: 'center' }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 28, maxWidth: 380, margin: '60px auto', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', color: '#15803d', fontSize: 28, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: navy }}>Thank you</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, lineHeight: 1.55 }}>
            Your feedback has been shared with {data?.requestor_first || 'your supervisor'}. We appreciate you taking the time.
          </div>
        </div>
      </div>
    )
  }

  const requestorName = `${data?.requestor_first || ''} ${data?.requestor_last || ''}`.trim() || 'your supervisor'
  const subjectFirst = data?.subject_first || 'there'
  const questions = data?.questions || []

  return (
    <div style={wrap}>
      <nav style={nav}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.65)', marginTop: 2 }}>Feedback request</div>
      </nav>

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto', paddingBottom: 110 }}>

        <div style={{ background: '#eef4ff', color: '#1e40af', padding: 14, borderRadius: 10, fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
          <b style={{ color: navy }}>Hi {subjectFirst} —</b><br />
          {requestorName} is asking for your feedback. Take a few minutes to share your honest answers below.
          {data?.context && (
            <div style={{ fontSize: 12, color: '#4338ca', marginTop: 8, fontStyle: 'italic', borderLeft: '3px solid #1e40af', paddingLeft: 10 }}>
              "{data.context}"
            </div>
          )}
        </div>

        {questions.map((q, i) => (
          <div key={i} style={card}>
            <div style={cardH}>{i + 1}. {q}</div>
            <textarea
              value={responses[i] || ''}
              onChange={e => {
                const next = responses.slice()
                next[i] = e.target.value
                setResponses(next)
              }}
              placeholder="Be honest. Your answer is shared only with the person who asked."
              style={ta}
            />
          </div>
        ))}

        {scales.map((s, i) => {
          const val = likert[s.id] || null
          return (
            <div key={s.id} style={card}>
              <div style={cardH}>{questions.length + i + 1}. {s.prompt}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map(n => {
                  const on = val === n
                  const subLabel = n === 1 ? s.low_label : n === 3 ? s.mid_label : n === 5 ? s.high_label : null
                  return (
                    <button
                      key={n}
                      onClick={() => setLikert({ ...likert, [s.id]: val === n ? null : n })}
                      style={{
                        flex: 1, padding: '10px 0', border: `2px solid ${on ? '#e47727' : '#e5e7eb'}`,
                        borderRadius: 8, background: on ? '#e47727' : '#fff', textAlign: 'center',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontSize: 16, fontWeight: 800, color: on ? '#fff' : '#9ca3af' }}>{n}</div>
                      {subLabel && (
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: on ? '#fff' : '#9ca3af', marginTop: 2 }}>{subLabel}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
          Your responses are saved as a touchpoint on your record. Only {requestorName} and admins can see what you wrote.
        </div>

      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <button
            onClick={submit}
            disabled={saving}
            style={{ width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, background: navy, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.5 : 1 }}
          >{saving ? 'Sharing…' : 'Share my feedback'}</button>
        </div>
      </div>
    </div>
  )
}
