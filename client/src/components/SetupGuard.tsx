import { useEffect, useState } from 'react'
import { Outlet, useLocation, Navigate } from 'react-router-dom'

const allowed = new Set(['/onboarding', '/auth/trakt/callback'])

const SetupGuard = () => {
  const loc = useLocation()
  const [ready, setReady] = useState(false)
  const [needs, setNeeds] = useState(false)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const [t, a] = await Promise.all([
          fetch('/api/auth/oauth/trakt/status'),
          fetch('/api/auth/oauth/alldebrid/status')
        ])
        const ts = t.ok ? await t.json() : { configured:false }
        const as = a.ok ? await a.json() : { configured:false }
        const om = await fetch('/api/public/api-keys/omdb')
        const fa = await fetch('/api/public/api-keys/fanarttv')
        if (!mounted) return
        setNeeds(!(ts.configured && as.configured && om.ok && fa.ok))
        setReady(true)
      } catch {
        if (!mounted) return
        setReady(true)
        setNeeds(true)
      }
    }
    check()
    return () => { mounted = false }
  }, [loc.pathname])

  if (!ready) return null
  if (needs && !allowed.has(loc.pathname)) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

export default SetupGuard

