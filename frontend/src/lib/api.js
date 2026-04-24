/**
 * ObservationPoint — Shared API client
 *
 * Every API call goes through apiFetch(). Handles:
 * - 401 (not authenticated) → redirect to /login
 * - 403 (access denied) → redirect to /login (stale session)
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

  if (r.status === 401 || r.status === 403) {
    window.location.href = '/login'
    return null
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
