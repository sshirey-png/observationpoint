import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ImpersonationBanner from '../components/ImpersonationBanner'
import { api } from '../lib/api'

/**
 * PermissionsAdmin — read-only matrix viewer for /app/admin/permissions.
 *
 * Renders the parsed permissions.yaml as a capability × tier table:
 * - Rows = capabilities
 * - Columns = tiers
 * - Cells = scope label (✓ all, 🟡 own school, 🟡 own downline, ⛔)
 *
 * Source of truth is permissions.yaml. To change permissions, edit that
 * file and redeploy — the matrix updates on the next request.
 */

const SCOPE_LABEL = {
  all_schools:  { icon: '✓',  label: 'All',         bg: '#ecfdf5', fg: '#15803d', border: '#bbf7d0' },
  own_school:   { icon: '🟡', label: 'Own school',  bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' },
  own_downline: { icon: '🟡', label: 'Own team',    bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' },
  self:         { icon: '🟡', label: 'Self only',   bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' },
}

function ScopeCell({ scope, note }) {
  const s = SCOPE_LABEL[scope]
  if (!s) {
    return (
      <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca',
                    borderRadius: 6, padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
        ⛔ <span style={{ fontSize: 9, fontWeight: 600, opacity: .7 }}>{scope}</span>
      </div>
    )
  }
  return (
    <div title={note || s.label}
         style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
                  borderRadius: 6, padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
      {s.icon} {s.label}
      {note && <div style={{ fontSize: 9, fontWeight: 500, marginTop: 2, opacity: .8 }}>note ⓘ</div>}
    </div>
  )
}

function BlockedCell({ explicit }) {
  return (
    <div style={{ background: explicit ? '#fef2f2' : '#f9fafb',
                  color: explicit ? '#b91c1c' : '#9ca3af',
                  border: `1px solid ${explicit ? '#fecaca' : '#e5e7eb'}`,
                  borderRadius: 6, padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
      ⛔
    </div>
  )
}

export default function PermissionsAdmin() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api.get('/api/permissions')
       .then(d => { setData(d); setLoading(false) })
       .catch(e => { setErr(String(e)); setLoading(false) })
  }, [])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
  if (err) return (
    <div style={{ padding: 30, background: '#fee2e2', color: '#b91c1c', borderRadius: 10, margin: 30, fontSize: 13 }}>
      Could not load permissions: {err}<br/>
      <span style={{ fontSize: 11, opacity: .8 }}>Likely cause: not signed in as admin.</span>
    </div>
  )

  const tiers = data?.tiers || []
  const capabilities = data?.capabilities || []

  return (
    <div style={{ minHeight: '100svh', background: '#f5f7fa', paddingBottom: 80, fontFamily: 'Inter, sans-serif' }}>
      <ImpersonationBanner />
      <nav className="sticky top-0 z-50 bg-fls-navy px-4 py-[14px] flex items-center gap-3">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="Back"
          className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border-0 cursor-pointer"
        >
          <svg width="18" height="18" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 9H3m0 0l5-5M3 9l5 5" />
          </svg>
        </button>
        <Link to="/" className="flex-1 text-center no-underline">
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Observation<span style={{ color: '#e47727' }}>Point</span></div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>Permissions Matrix</div>
        </Link>
        <div className="w-8" />
      </nav>

      <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>

        {/* Intro card */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Permissions</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#002f60', marginTop: 4 }}>Capability × Tier Matrix</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
            Read-only. Source of truth is <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>permissions.yaml</code> at the project root.
            To change access: edit that file, redeploy.
          </div>
        </div>

        {/* Tier definitions */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
            Tiers ({tiers.length})
          </div>
          {tiers.map(t => (
            <div key={t.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#002f60' }}>{t.label}</div>
                <code style={{ fontSize: 10, color: '#6b7280', background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>{t.id}</code>
              </div>
              <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {(t.description || '').trim()}
              </div>
              {(t.titles_keyword?.length > 0) && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  <b>Titles (keyword match):</b> {t.titles_keyword.join(', ')}
                </div>
              )}
              {(t.titles_exact?.length > 0) && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  <b>Titles (exact match):</b> {t.titles_exact.join(' · ')}
                </div>
              )}
              {t.rule && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  <b>Rule:</b> {t.rule}
                </div>
              )}
              {t.note && (
                <div style={{ fontSize: 11, color: '#9a3412', background: '#fff7ed', padding: '6px 8px', borderRadius: 6, marginTop: 6, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                  ⓘ {(t.note || '').trim()}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* The matrix */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflowX: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
            Capabilities ({capabilities.length})
          </div>

          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 8px', borderBottom: '2px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em', position: 'sticky', left: 0, background: '#fff' }}>
                  Capability
                </th>
                {tiers.map(t => (
                  <th key={t.id} style={{ padding: '10px 6px', borderBottom: '2px solid #e5e7eb', fontSize: 11, fontWeight: 700, color: '#002f60', textTransform: 'uppercase', letterSpacing: '.04em', minWidth: 110 }}>
                    {t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capabilities.map(cap => {
                const grantsByTier = {}
                for (const g of cap.grants || []) grantsByTier[g.tier] = g
                const excluded = new Set(cap.excluded_explicitly || [])
                return (
                  <tr key={cap.id}>
                    <td style={{ padding: '8px 8px', borderBottom: '1px solid #f3f4f6', position: 'sticky', left: 0, background: '#fff' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{cap.label}</div>
                      <code style={{ fontSize: 9, color: '#9ca3af' }}>{cap.id}</code>
                    </td>
                    {tiers.map(t => {
                      const g = grantsByTier[t.id]
                      const isExcluded = excluded.has(t.id)
                      return (
                        <td key={t.id} style={{ padding: '6px 4px', borderBottom: '1px solid #f3f4f6' }}>
                          {g
                            ? <ScopeCell scope={g.scope} note={g.note} />
                            : <BlockedCell explicit={isExcluded} />}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 14, fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
            <b style={{ color: '#15803d' }}>✓ All</b> = all schools/staff ·
            <b style={{ color: '#c2410c', marginLeft: 6 }}>🟡 Own school / Own team / Self</b> = scoped ·
            <b style={{ color: '#b91c1c', marginLeft: 6 }}>⛔</b> = no access (red background = explicitly excluded)
          </div>
        </div>
      </div>
    </div>
  )
}
