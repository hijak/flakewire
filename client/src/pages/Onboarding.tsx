import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

type OAuthStatus = { configured: boolean; expired: boolean }

const fetchStatus = async (provider: string): Promise<OAuthStatus> => {
  const r = await fetch(`/api/auth/oauth/${provider}/status`)
  if (!r.ok) throw new Error('status error')
  return r.json()
}

const Onboarding = () => {
  const [trakt, setTrakt] = useState<OAuthStatus>({ configured: false, expired: false })
  const [alldebrid, setAlldebrid] = useState<OAuthStatus>({ configured: false, expired: false })
  const [omdbConfigured, setOmdbConfigured] = useState<'env'|'storage'|'none'>('none')
  const [fanartConfigured, setFanartConfigured] = useState<'env'|'storage'|'none'>('none')
  const [omdbKey, setOmdbKey] = useState('')
  const [fanartKey, setFanartKey] = useState('')
  const [tDevice, setTDevice] = useState<{ device_code:string; user_code:string; verification_url:string; expires_in:number; interval:number }|null>(null)
  const [tPolling, setTPolling] = useState(false)
  const [tError, setTError] = useState<string | null>(null)
  const [pinData, setPinData] = useState<{ pin: string; check: string; user_url: string } | null>(null)
  const [pinStatus, setPinStatus] = useState<'idle'|'waiting'|'activated'|'error'>('idle')

  const load = async () => {
    try {
      const [t, a] = await Promise.all([fetchStatus('trakt'), fetchStatus('alldebrid')])
      setTrakt(t); setAlldebrid(a)
      const r1 = await fetch('/api/public/api-keys/omdb')
      setOmdbConfigured(r1.ok ? ((await r1.json()).source==='env'?'env':'storage') : 'none')
      const r2 = await fetch('/api/public/api-keys/fanarttv')
      setFanartConfigured(r2.ok ? ((await r2.json()).source==='env'?'env':'storage') : 'none')
    } catch {}
  }

  useEffect(() => { load() }, [])

  const startTrakt = async () => {
    setTError(null)
    try {
      const r = await fetch('/api/auth/oauth/trakt/device/start', { method:'POST' })
      const data = await r.json()
      if (!r.ok) {
        if (data.error?.includes('Trakt client not configured')) {
          setTError('Trakt is not configured on the server. Please contact the administrator.')
        } else {
          setTError(data.error || 'Failed to start device auth')
        }
        return
      }
      setTDevice(data); setTPolling(true)
      try { await navigator.clipboard.writeText(data.user_code) } catch {}
      window.open(`${data.verification_url}?code=${encodeURIComponent(data.user_code)}`, '_blank')
      let attempts = 0
      const maxAttempts = Math.ceil((data.expires_in || 600) / (data.interval || 5))
      const iv = setInterval(async () => {
        attempts++
        try {
          const p = await fetch('/api/auth/oauth/trakt/device/poll', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ device_code: data.device_code }) })
          const j = await p.json()
          if (j && j.success) { clearInterval(iv); setTPolling(false); setTDevice(null); setTError(null); await load() }
        } catch {}
        if (attempts > maxAttempts) { clearInterval(iv); setTPolling(false); setTError('Authorization timed out. Please try again.') }
      }, (data.interval || 5) * 1000)
    } catch (error) {
      setTError('Failed to connect to Trakt. Please try again.')
    }
  }

  const connectAllDebrid = async () => {
    try {
      const d = await (await fetch('/api/auth/oauth/alldebrid/auth')).json()
      if (d?.pinData) {
        setPinData({ pin: d.pinData.pin, check: d.pinData.check, user_url: d.pinData.user_url })
        setPinStatus('waiting')
        try { await navigator.clipboard.writeText(d.pinData.pin) } catch {}
        window.open(`${d.pinData.user_url}?pin=${encodeURIComponent(d.pinData.pin)}`, '_blank')
        const start = Date.now()
        const poll = async () => {
          try {
            const r = await fetch('/api/auth/oauth/alldebrid/check', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ pin: d.pinData.pin, check: d.pinData.check }) })
            const j = await r.json()
            if (j?.activated) { setPinStatus('activated'); setPinData(null); await load(); return }
          } catch { setPinStatus('error'); return }
          if (Date.now() - start < 120000) {
            setTimeout(poll, 3000)
          } else {
            setPinStatus('error')
          }
        }
        setTimeout(poll, 3000)
      }
    } catch { setPinStatus('error') }
  }

  const saveKey = async (provider:'omdb'|'fanarttv', key:string) => {
    try {
      const r = await fetch(`/api/public/api-keys/${provider}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ apiKey: key }) })
      if (r.ok) await load()
    } catch {}
  }

  const allDone = trakt.configured && alldebrid.configured && omdbConfigured!=='none' && fanartConfigured!=='none'

  return (
    <div className="min-h-screen bg-background">
      {/* Simple logo-only header for onboarding */}
      <div className="sticky top-0 z-50 glass border-b border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex items-center h-16">
            <Link to="/" className="flex items-center gap-3 hover-scale">
              <img src={'/logo.png'} alt="Flake Wire" className="h-8 w-8" style={{ backgroundColor: 'transparent' }} />
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Flake Wire
              </span>
            </Link>
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
        <Card className="p-6 glass">
          <h1 className="text-xl font-semibold mb-2">Welcome to Flake Wire</h1>
          <p className="text-sm text-muted-foreground">Let’s get you set up. Connect your services and add API keys.</p>
        </Card>

        <Card className="p-6 glass">
          <h2 className="text-lg font-semibold mb-2">Step 1 · Connect Trakt</h2>
          {trakt.configured ? (
            <div className="text-green-500">Connected</div>
          ) : (
            <div className="space-y-2">
              <Button onClick={startTrakt} disabled={tPolling}>Connect Trakt</Button>
              {tError && (
                <Alert>
                  <AlertTitle>Connection Error</AlertTitle>
                  <AlertDescription className="text-destructive">
                    {tError}
                  </AlertDescription>
                </Alert>
              )}
              {tDevice && (
                <Alert>
                  <AlertTitle>Authorize Trakt</AlertTitle>
                  <AlertDescription>
                    Code <span className="font-semibold">{tDevice.user_code}</span> copied. Open {tDevice.verification_url} if not opened automatically.
                    {tPolling ? <span className="ml-2">Waiting for approval…</span> : null}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6 glass">
          <h2 className="text-lg font-semibold mb-2">Step 2 · Connect AllDebrid</h2>
          {alldebrid.configured ? (
            <div className="text-green-500">Connected</div>
          ) : (
            <div className="space-y-2">
              <Button onClick={connectAllDebrid}>Connect AllDebrid</Button>
              {pinData && (
                <Alert>
                  <AlertTitle>Authorize AllDebrid</AlertTitle>
                  <AlertDescription>
                    PIN <span className="font-semibold">{pinData.pin}</span> copied. Open {pinData.user_url} if not opened automatically.
                    {pinStatus==='waiting' ? <span className="ml-2">Waiting for activation…</span> : null}
                    {pinStatus==='activated' ? <span className="ml-2">Activated</span> : null}
                    {pinStatus==='error' ? <span className="ml-2 text-destructive">Failed or timeout</span> : null}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6 glass space-y-4">
          <h2 className="text-lg font-semibold">Step 3 · API Keys</h2>
          <div>
            <div className="mb-1">OMDb {omdbConfigured!=='none' ? <span className="text-green-500">({omdbConfigured})</span> : <span className="text-yellow-500">(not configured)</span>}</div>
            <div className="flex gap-2">
              <input value={omdbKey} onChange={(e)=> setOmdbKey(e.target.value)} placeholder="OMDb API Key" className="flex-1 bg-transparent border border-border rounded px-3 py-2 text-sm" />
              <Button disabled={!omdbKey} onClick={()=> saveKey('omdb', omdbKey)}>Save</Button>
            </div>
          </div>
          <div>
            <div className="mb-1">Fanart.tv {fanartConfigured!=='none' ? <span className="text-green-500">({fanartConfigured})</span> : <span className="text-yellow-500">(not configured)</span>}</div>
            <div className="flex gap-2">
              <input value={fanartKey} onChange={(e)=> setFanartKey(e.target.value)} placeholder="Fanart.tv API Key" className="flex-1 bg-transparent border border-border rounded px-3 py-2 text-sm" />
              <Button disabled={!fanartKey} onClick={()=> saveKey('fanarttv', fanartKey)}>Save</Button>
            </div>
          </div>
        </Card>

        <Card className="p-6 glass">
          <div className="flex items-center justify-between">
            <div>{allDone ? 'All set!' : 'Complete the steps above to continue'}</div>
            <Button disabled={!allDone} onClick={() => { try { localStorage.setItem('onboardingComplete','true') } catch {}; window.location.href='/' }}>Finish</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default Onboarding
