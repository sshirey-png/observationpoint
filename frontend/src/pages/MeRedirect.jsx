import { useState, useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

/**
 * /app/me — redirects to the current user's StaffProfile.
 */
export default function MeRedirect() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/auth/status')
      .then(r => {
        if (!r?.user) navigate('/login', { replace: true })
        setUser(r?.user || null)
        setLoading(false)
      })
      .catch(() => { setLoading(false) })
  }, [navigate])

  if (loading || !user) {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', color: '#9ca3af' }}>
        Loading…
      </div>
    )
  }

  return <Navigate to={`/app/staff/${user.email}`} replace />
}
