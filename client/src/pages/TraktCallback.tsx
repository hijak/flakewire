import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const TraktCallback = () => {
  const navigate = useNavigate()
  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const send = async () => {
      try {
        const r = await fetch('/api/auth/oauth/trakt/callback', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ code, state }) })
        if (r.ok) navigate('/?refresh=1')
        else navigate('/')
      } catch {
        navigate('/')
      }
    }
    if (code && state) send(); else navigate('/')
  }, [navigate])
  return null
}

export default TraktCallback
