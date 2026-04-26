/**
 * ObservationPoint — Shared API client
 *
 * Every API call goes through apiFetch(). Handles:
 * - 401 (not authenticated) → redirect to /login (you're logged out)
 * - 403 (forbidden — wrong permissions) → return { authorized: false }
 *   so callers can render a friendly "Access restricted" panel instead
 *   of yeeting the user to /login (which they're already past).
 * - Network errors → throw with clear message
 *
 * This is the ONE place fetch logic lives. No page should call fetch() directly.
 */

export async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  })

  if (r.status === 401) {
    window.location.href = '/login'
    return null
  }

  if (r.status === 403) {
    // Soft-authz: don't redirect. Give callers a flag so they can render
    // their own "Access restricted" UI. Pages already handling this pattern
    // (PIP, WriteUp) check `if (res?.authorized === false)`.
    let body = {}
    try { body = await r.json() } catch {}
    return { authorized: false, error: body.error || 'Forbidden' }
  }

  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${r.status}`)
  }

  return r.json()
}

// Convenience methods
export const api = {
  get: (url) => apiFetch(url),
  post: (url, data) => apiFetch(url, { method: 'POST', body: JSON.stringify(data) }),
  put: (url, data) => apiFetch(url, { method: 'PUT', body: JSON.stringify(data) }),
  del: (url) => apiFetch(url, { method: 'DELETE' }),
}
