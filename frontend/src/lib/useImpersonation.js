import { useState, useEffect } from 'react'

/**
 * useImpersonation — demo hook. Tracks who the admin is "viewing as" and
 * persists the choice in localStorage so it survives page navigation.
 *
 * NOTE: this is UI-only right now. The backend doesn't yet respect
 * impersonation — it's here so Scott can react to the flow before we
 * touch every authz check. The real build adds a Flask session field,
 * an /api/admin/impersonate endpoint, and an audit-log table.
 */

const KEY = 'op:impersonating'

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function useImpersonation() {
  const [impersonating, setState] = useState(read)

  // Sync across tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key === KEY) setState(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function set(user) {
    if (user) {
      localStorage.setItem(KEY, JSON.stringify(user))
    } else {
      localStorage.removeItem(KEY)
    }
    setState(user)
  }

  return { impersonating, set, stop: () => set(null) }
}
