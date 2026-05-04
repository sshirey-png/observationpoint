import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import BottomNav from '../components/BottomNav'
import { api } from '../lib/api'

/**
 * ActionStepsPage — /app/me/action-steps
 * Three states: Assigned · In Progress · Mastered (read-only for the teacher).
 * Only the supervisor (assigner) can change state. Teacher can ping their
 * supervisor to come take a look via "Request review".
 */

const STATES = [
  { key: 'assigned',    label: 'Assigned',    pct: 0,   bg: '#f3f4f6', fg: '#6b7280', border: '#9ca3af' },
  { key: 'in_progress', label: 'In Progress', pct: 50,  bg: '#fff7ed', fg: '#9a3412', border: '#e47727' },
  { key: 'mastered',    label: 'Mastered',    pct: 100, bg: '#dcfce7', fg: '#166534', border: '#22c55e' },
]

function stateForPct(pct) {
  if (pct >= 100) return 'mastered'
  if (pct >= 25) return 'in_progress'
  return 'assigned'
}

function ReviewModal({ step, onClose, onSent }) {
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      const res = await api.post(`/api/me/action-steps/${step.id}/request-review`, { note })
      if (res?.authorized === false) {
        alert(res.error || 'Not authorized')
      } else {
        onSent()
      }
    } catch (e) {
      alert('Send failed: ' + (e?.message || ''))
    }
    setSending(false)
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Inter, sans-serif' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#002f60', marginBottom: 4 }}>Ask {step.assigned_by_name?.split(' ')[0] || 'your supervisor'} to review</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>They'll get an email with this note + a link to open your profile and update progress.</div>
        <div style={{ background: '#f9fafb', borderLeft: '3px solid #e47727', padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#374151', marginBottom: 12, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{step.text}</div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional: what you've tried, what you noticed, why you think they should come look."
          style={{ width: '100%', minHeight: 90, padding: 10, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} disabled={sending}
            style={{ flex: 1, padding: '11px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button onClick={send} disabled={sending}
            style={{ flex: 1.5, padding: '11px', border: 'none', borderRadius: 10, background: '#002f60', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: sending ? 0.5 : 1 }}>
            {sending ? 'Sending…' : 'Send to supervisor'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionStepCard({ step, onReview }) {
  const pct = step.progress_pct || 0
  const currentState = stateForPct(pct)
  const stateMeta = STATES.find(s => s.key === currentState)

  const dateAssigned = step.assigned_at ? new Date(step.assigned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const daysSinceAssigned = step.assigned_at ? Math.floor((Date.now() - new Date(step.assigned_at).getTime()) / (1000 * 60 * 60 * 24)) : null
  const isStale = daysSinceAssigned != null && daysSinceAssigned > 30 && pct < 100

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 10, borderLeft: `4px solid ${stateMeta.border}` }}>
      {/* Header: state badge + meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 9,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          padding: '3px 8px',
          borderRadius: 4,
          background: stateMeta.bg,
          color: stateMeta.fg,
          flexShrink: 0,
        }}>{stateMeta.label}</span>
        <div style={{ flex: 1, fontSize: 10, color: '#6b7280', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          From <b style={{ color: '#374151' }}>{step.assigned_by_name || 'unknown'}</b>
          {dateAssigned && <> · {dateAssigned}</>}
        </div>
      </div>

      {/* Body: action step text */}
      <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{step.text}</div>

      {/* Footer: stale flag + review button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
        <div style={{ flex: 1, fontSize: 10, color: isStale ? '#dc2626' : '#9ca3af', fontWeight: isStale ? 700 : 500 }}>
          {daysSinceAssigned != null && daysSinceAssigned > 0
            ? (isStale ? `Stale · ${daysSinceAssigned}d ago` : `${daysSinceAssigned}d ago`)
            : ''}
        </div>
        <button
          onClick={() => onReview(step)}
          style={{ padding: '8px 14px', border: 'none', borderRadius: 10, fontSize: 11, fontWeight: 800, background: '#002f60', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
        >📩 Request review</button>
      </div>
    </div>
  )
}

export default function ActionStepsPage() {
  const navigate = useNavigate()
  const [steps, setSteps] = useState(null)
  const [reviewStep, setReviewStep] = useState(null)
  const [reviewSent, setReviewSent] = useState(false)

  useEffect(() => {
    api.get('/api/me/action-steps')
      .then(r => setSteps(r?.action_steps || []))
      .catch(() => setSteps([]))
  }, [])

  const counts = (steps || []).reduce((acc, s) => {
    const k = stateForPct(s.progress_pct || 0)
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  return (
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 80, fontFamily: 'Inter, sans-serif' }}>
      <nav style={{ background: '#002f60', padding: '14px 16px', textAlign: 'center', position: 'relative' }}>
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="Back"
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', borderRadius: 8, background: 'rgba(255,255,255,.08)', border: 'none', fontFamily: 'inherit' }}
        >←</button>
        <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', cursor: 'pointer' }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
        </Link>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>My action steps</div>
      </nav>

      <div style={{ padding: 14, maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '8px 4px 4px' }}>My action steps</div>
        <div style={{ fontSize: 12, color: '#6b7280', margin: '0 4px 14px', lineHeight: 1.5 }}>
          Your supervisor sets progress. When you've made progress, tap "Request review" to invite them to come take a look.
        </div>

        {steps === null && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
        )}

        {steps && steps.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 14, padding: '12px 14px', marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {STATES.map(s => (
                <div key={s.key} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.fg }}>{counts[s.key] || 0}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, marginTop: 1 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {steps && steps.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            No open action steps. When your supervisor assigns one (during an observation or PMAP), it'll show up here.
          </div>
        )}

        {steps && steps.map(step => (
          <ActionStepCard key={step.id} step={step} onReview={setReviewStep} />
        ))}
      </div>

      {reviewStep && !reviewSent && (
        <ReviewModal
          step={reviewStep}
          onClose={() => setReviewStep(null)}
          onSent={() => { setReviewSent(true); setTimeout(() => { setReviewStep(null); setReviewSent(false) }, 1800) }}
        />
      )}

      {reviewSent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Inter, sans-serif' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, textAlign: 'center', maxWidth: 320 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#002f60' }}>Sent</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Your supervisor will see this shortly.</div>
          </div>
        </div>
      )}

      <BottomNav active="home" />
    </div>
  )
}
