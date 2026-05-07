import { Link, useNavigate } from 'react-router-dom'

/**
 * Friendly403 — shown when an API returns { authorized: false, reason }.
 *
 * Variants by reason:
 *   'school'     — school leader hit another school's data
 *   'capability' — content lead hit personnel-review (PMAP/PIP/etc.)
 *   'role'       — wrong tier entirely (teacher, etc. hit Network)
 *   default      — generic
 *
 * Renders friendly screen + a path forward. Never shows raw 403 text.
 */
export default function Friendly403({ reason, message, ownSchool, attemptedSchool, redirectTo, redirectLabel }) {
  const navigate = useNavigate()

  const VARIANTS = {
    school: {
      icon: '🏫', iconBg: '#dbeafe', iconFg: '#1e40af',
      title: "That's not your school",
      body: (
        <>
          You can see <b>network-wide comparison numbers</b> for all schools, but you can only drill into <b>{ownSchool || 'your school'}</b>.
          {attemptedSchool && <> You tried to view <i>{attemptedSchool}</i>.</>}
        </>
      ),
      primary: redirectTo
        ? { label: redirectLabel || `Go to ${ownSchool || 'your school'}'s view →`, href: redirectTo }
        : { label: 'Back to Network', href: '/app/network' },
    },
    capability: {
      icon: '🔒', iconBg: '#fef3c7', iconFg: '#a16207',
      title: 'This section is HR-only',
      body: <>{message || 'This page contains personnel review records that are restricted to direct supervisors and HR.'}</>,
      primary: { label: 'Back to Network', href: '/app/network' },
    },
    role: {
      icon: '🔒', iconBg: '#fef3c7', iconFg: '#a16207',
      title: "This page isn't for your role",
      body: <>{message || 'The Network page is for school leaders, content leads, and HR. Your role does not have access to this section.'}</>,
      primary: { label: 'Go to your home', href: '/' },
    },
  }

  const v = VARIANTS[reason] || {
    icon: '🤔', iconBg: '#fee2e2', iconFg: '#b91c1c',
    title: "You don't have access here",
    body: <>{message || "We couldn't load this page for you. You might be signed in as the wrong account, or this section isn't part of your role yet."}</>,
    primary: { label: 'Back to home', href: '/' },
  }

  return (
    <div style={{ minHeight: '100svh', background: '#f5f7fa', padding: '40px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '32px 24px', boxShadow: '0 1px 3px rgba(0,0,0,.08)', textAlign: 'center', maxWidth: 420, width: '100%' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: v.iconBg, color: v.iconFg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 16px' }}>{v.icon}</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#002f60', marginBottom: 10 }}>{v.title}</h1>
        <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.55, marginBottom: 22 }}>{v.body}</div>
        <button
          onClick={() => navigate(v.primary.href)}
          style={{ display: 'inline-block', padding: '11px 20px', borderRadius: 8, fontSize: 14, fontWeight: 700, background: '#002f60', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >{v.primary.label}</button>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 18 }}>
          Think this is wrong? Email <a href="mailto:talent@firstlineschools.org" style={{ color: '#002f60', fontWeight: 600 }}>talent@firstlineschools.org</a>.
        </div>
      </div>
    </div>
  )
}
