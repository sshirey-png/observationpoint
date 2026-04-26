import { useState } from 'react'
import { api } from '../lib/api'

/**
 * FeedbackButton — small floating "Report issue" link in the corner of every
 * page. Mounted once in App.jsx outside <Routes>. Sends to /api/feedback
 * which emails Scott + talent@.
 */
export default function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function send() {
    if (!subject.trim() && !body.trim()) return
    setSending(true)
    try {
      await api.post('/api/feedback', {
        subject: subject.trim() || '(no subject)',
        body: body.trim(),
        url: window.location.href,
        user_agent: navigator.userAgent,
      })
      setSent(true)
      setTimeout(() => {
        setOpen(false); setSent(false); setSubject(''); setBody('')
      }, 1500)
    } catch (e) {
      alert('Couldn\'t send: ' + (e?.message || 'unknown error'))
    }
    setSending(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Report issue or send feedback"
        style={{
          position: 'fixed', bottom: 'max(80px, calc(80px + env(safe-area-inset-bottom)))', right: 12, zIndex: 9999,
          width: 44, height: 44, borderRadius: '50%',
          background: '#002f60', color: '#fff', border: 'none',
          fontSize: 20, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 4px 12px rgba(0,0,0,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >?</button>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Inter, sans-serif',
    }} onClick={() => !sending && !sent && setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,.3)' }}>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dcfce7', color: '#059669', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#002f60' }}>Sent — thanks</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Scott will see this shortly.</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: '#002f60' }}>Report issue / feedback</div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#9ca3af', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>What you saw, what you expected, anything broken. We'll auto-include this page's URL.</div>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Short subject (e.g., 'PIP timeline boxes')"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', marginBottom: 8, boxSizing: 'border-box' }}
            />
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="What happened? What did you expect?"
              style={{ width: '100%', minHeight: 120, padding: 12, border: '1.5px solid #e5e7eb', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setOpen(false)} disabled={sending}
                style={{ flex: 1, padding: '11px', border: '1.5px solid #e5e7eb', borderRadius: 10, background: '#fff', color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={send} disabled={sending || (!subject.trim() && !body.trim())}
                style={{ flex: 1.4, padding: '11px', border: 'none', borderRadius: 10, background: '#002f60', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: (sending || (!subject.trim() && !body.trim())) ? 0.5 : 1 }}>
                {sending ? 'Sending…' : 'Send to Scott'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
