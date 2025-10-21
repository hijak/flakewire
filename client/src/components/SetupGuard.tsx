import { useEffect, useState } from 'react'
import { Outlet, useLocation, Navigate } from 'react-router-dom'

const allowed = new Set(['/onboarding'])

const SetupGuard = () => {
  const loc = useLocation()
  const [ready, setReady] = useState(false)
  const [needs, setNeeds] = useState(false)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      // If user completed onboarding once, never force it again
      try {
        if (localStorage.getItem('onboardingComplete') === 'true') {
          if (mounted) { setNeeds(false); setReady(true) }
          return
        }
      } catch {}
      try {
        const headers:any = undefined
        // Status: try without auth first (default scope), then with auth if needed
        const t = await fetch('/api/auth/oauth/trakt/status')
        const a = await fetch('/api/auth/oauth/alldebrid/status')
        const ts = t.ok ? await t.json() : { configured:false }
        const as = a.ok ? await a.json() : { configured:false }
        // API keys: public (default scope)
        const om = await fetch('/api/public/api-keys/omdb')
        const fa = await fetch('/api/public/api-keys/fanarttv')
        if (!mounted) return
        let needed = !(ts.configured && as.configured && om.ok && fa.ok)
        try { if (localStorage.getItem('onboardingComplete') === 'true') needed = false } catch {}
        setNeeds(needed)
        setReady(true)
      } catch {
        if (!mounted) return
        setReady(true)
        let needed = true
        try { if (localStorage.getItem('onboardingComplete') === 'true') needed = false } catch {}
        setNeeds(needed)
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
