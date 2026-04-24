import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'

/**
 * Acknowledge — public page (no auth) for employees to acknowledge a PIP or Write-Up.
 * Reads token from URL, fetches the document, employee types full name to acknowledge.
 * Captures timestamp + IP server-side.
 */
export default function Acknowledge() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [doc, setDoc] = useState(null)
  const [typedName, setTypedName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) { setError('Missing token'); setLoading(false); return }
    api.get(`/api/ack/${token}`)
      .then(r => {
        if (r?.already_acknowledged) {
          setDoc(r); setDone(true)
        } else {
          setDoc(r)
        }
        setLoading(false)
      })
      .catch(e => {
        setError(e?.message || 'Could not load document')
        setLoading(false)
      })
  }, [token])

  async function submit() {
    if (!typedName.trim()) return
    setSubmitting(true)
    try {
      await api.post(`/api/ack/${token}`, { typed_name: typedName.trim() })
      setDone(true)
    } catch (e) {
      alert('Acknowledgment failed: ' + (e?.message || 'unknown error'))
    }
    setSubmitting(false)
  }

  const wrap = { minHeight: '100svh', background: '#f5f7fa', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', fontFamily: 'Inter, sans-serif', color: '#111827' }
  const nav = { background: '#002f60', padding: '14px 16px', textAlign: 'center' }
  const navTitle = { fontSize: 17, fontWeight: 800, color: '#fff' }
  const navSub = { fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }
  const body = { padding: 16, maxWidth: 720, margin: '0 auto' }

  if (loading) {
    return (
      <div style={wrap}>
        <nav style={nav}><div style={navTitle}>Observation<span style={{ color: '#e47727' }}>Point</span></div></nav>
        <div style={{ ...body, textAlign: 'center', paddingTop: 40, color: '#6b7280' }}>Loading…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={wrap}>
        <nav style={nav}><div style={navTitle}>Observation<span style={{ color: '#e47727' }}>Point</span></div></nav>
        <div style={{ ...body, textAlign: 'center', paddingTop: 40 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>Unable to load document</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>{error}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 16 }}>If this persists, contact your supervisor or talent@firstlineschools.org.</div>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={wrap}>
        <nav style={nav}>
          <div style={navTitle}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
          <div style={navSub}>Acknowledgment received</div>
        </nav>
        <div style={{ ...body, paddingTop: 30 }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 28, textAlign: 'center', boxShadow: '0 4px 14px rgba(0,0,0,.08)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#059669', fontSize: 28, fontWeight: 800 }}>✓</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#002f60' }}>Acknowledgment recorded</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>
              Thank you{doc?.employee_first ? `, ${doc.employee_first}` : ''}. Your acknowledgment was captured{doc?.acknowledged_at ? ` on ${new Date(doc.acknowledged_at).toLocaleDateString()}` : ''}. A copy has been emailed to you and your supervisor.
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 14 }}>
              Acknowledgment does not imply agreement with the document's content — only receipt.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const docType = doc?.form_type === 'write_up' ? 'Write-Up' : 'Performance Improvement Plan'
  const tag = doc?.form_type === 'write_up' ? 'Write-Up' : 'Performance Improvement Plan'
  const summary = doc?.summary_lines || []

  return (
    <div style={wrap}>
      <nav style={nav}>
        <div style={navTitle}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
        <div style={navSub}>Document acknowledgment</div>
      </nav>

      <div style={body}>
        <div style={{ background: 'linear-gradient(135deg,#002f60,#003b7a)', borderRadius: 14, padding: 20, color: '#fff', marginBottom: 14, boxShadow: '0 3px 10px rgba(0,47,96,.2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#fed7aa' }}>{tag}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>Please review &amp; acknowledge</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.8)', marginTop: 6, lineHeight: 1.5 }}>
            This {docType.toLowerCase()} was issued to you by your supervisor. Review the document below, then type your full name to acknowledge receipt.
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#111827', marginBottom: 10 }}>Document</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13 }}>
            <div style={{ color: '#6b7280', fontWeight: 600 }}>Employee</div>
            <div style={{ color: '#111827', fontWeight: 700 }}>{doc?.employee_name || '—'}</div>
            <div style={{ color: '#6b7280', fontWeight: 600 }}>Issued by</div>
            <div style={{ color: '#111827', fontWeight: 700 }}>{doc?.observer_name || '—'}</div>
            <div style={{ color: '#6b7280', fontWeight: 600 }}>Date issued</div>
            <div style={{ color: '#111827', fontWeight: 700 }}>{doc?.issued_date ? new Date(doc.issued_date).toLocaleDateString() : '—'}</div>
            {doc?.review_date && (
              <>
                <div style={{ color: '#6b7280', fontWeight: 600 }}>Review date</div>
                <div style={{ color: '#111827', fontWeight: 700 }}>{new Date(doc.review_date).toLocaleDateString()}</div>
              </>
            )}
          </div>
        </div>

        {summary.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#111827', marginBottom: 10 }}>Summary</div>
            <div style={{ maxHeight: 280, overflowY: 'auto', fontSize: 12, color: '#374151', lineHeight: 1.6, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
              {summary.map((line, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <b style={{ color: '#111827' }}>{line.label}:</b> {line.value}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#92400e', marginBottom: 4 }}>Acknowledge receipt</div>
          <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5, marginBottom: 12 }}>
            Type your full legal name to confirm you've received this {docType.toLowerCase()}. Acknowledgment does not imply agreement with the content — only receipt.
          </div>
          <input
            type="text"
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder="Your full name"
            autoFocus
            style={{ width: '100%', padding: 14, border: '1.5px solid #fde68a', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', lineHeight: 1.6, marginTop: 14 }}>
          Timestamp, IP address, and browser will be recorded with your acknowledgment.<br />
          A copy will be emailed to you and your supervisor.
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', padding: '12px 14px', paddingBottom: 'max(14px, env(safe-area-inset-bottom))', zIndex: 50 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <button
            onClick={submit}
            disabled={!typedName.trim() || submitting}
            style={{ width: '100%', padding: 14, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, background: '#002f60', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', opacity: (!typedName.trim() || submitting) ? 0.5 : 1 }}
          >{submitting ? 'Submitting…' : 'Acknowledge Receipt'}</button>
        </div>
      </div>
    </div>
  )
}
