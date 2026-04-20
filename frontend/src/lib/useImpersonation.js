import { useState, useEffect } from 'react'
import { api } from './api'

/**
 * useImpersonation — source of truth is the Flask session cookie.
 * Reads /api/auth/status on mount to hydrate. Start/stop call real
 * admin endpoints and reload the page so every component refetches
 * with the new effective user.
 *
 * Non-admins: isAdmin=false, impersonating=null. Admin UI is gated on
 * isAdmin, so non-admins never see the picker.
 */

// Module-level cache so multiple components sharing the hook don't
// trigger N parallel auth/status calls on the same page load.
let _cache = null
let _inFlight = null

async function fetchStatus() {
  if (_cache) return _cache
  if (_inFlight) return _inFlight
  _inFlight = api.get('/api/auth/status')
    .then(r => { _cache = r || {}; _inFlight = null; return _cache })
    .catch(() => { _inFlight = null; return {} })
  return _inFlight
}

export function useImpersonation() {
  const [status, setStatus] = useState(_cache)

  useEffect(() => {
    if (_cache) return
    let cancelled = false
    fetchStatus().then(r => { if (!cancelled) setStatus(r) })
    return () => { cancelled = true }
  }, [])

  const impersonating = status?.impersonating || null
  const isAdmin = !!(status?.real_user?.is_admin || status?.user?.is_admin)

  async function start(user) {
    await api.post('/api/admin/impersonate', { email: user.email })
    _cache = null
    window.location.reload()
  }

  async function stop() {
    await api.post('/api/admin/stop-impersonating', {})
    _cache = null
    window.location.reload()
  }

  return { loading: status === null, isAdmin, impersonating, start, stop }
}
