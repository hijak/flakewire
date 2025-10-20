import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/contexts/auth'

type OAuthStatus = { configured: boolean; expired: boolean; metadata?: any }

const fetchStatus = async (provider: string): Promise<OAuthStatus> => {
  const r = await fetch(`/api/auth/oauth/${provider}/status`)
  if (!r.ok) throw new Error('status error')
  return r.json()
}

const getAuth = async (provider: string) => {
  const r = await fetch(`/api/auth/oauth/${provider}/auth`)
  if (!r.ok) throw new Error('auth init failed')
  return r.json()
}

const revokeAuth = async (provider: string) => {
  const r = await fetch(`/api/auth/oauth/${provider}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('revoke failed')
  return r.json()
}

const checkPin = async (pin: string, check: string) => {
  const r = await fetch('/api/auth/oauth/alldebrid/check', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ pin, check }) })
  if (!r.ok) throw new Error('pin check failed')
  return r.json()
}

const Settings = () => {
  const [trakt, setTrakt] = useState<OAuthStatus>({ configured: false, expired: false })
  const [alldebrid, setAlldebrid] = useState<OAuthStatus>({ configured: false, expired: false })
  const [traktDevice, setTraktDevice] = useState<{ device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number } | null>(null)
  const [traktPolling, setTraktPolling] = useState(false)
  const [pinData, setPinData] = useState<{ pin: string; check: string; user_url: string } | null>(null)
  const [pinStatus, setPinStatus] = useState<'idle'|'waiting'|'activated'|'error'>('idle')
  const [omdbConfigured, setOmdbConfigured] = useState<'env'|'storage'|'none'>('none')
  const [fanartConfigured, setFanartConfigured] = useState<'env'|'storage'|'none'>('none')
  const [omdbKey, setOmdbKey] = useState('')
  const [fanartKey, setFanartKey] = useState('')
  const { token } = useAuth()

  const load = async () => {
    try {
      const [t, a] = await Promise.all([fetchStatus('trakt'), fetchStatus('alldebrid')])
      setTrakt(t); setAlldebrid(a)
      // API keys status
      try {
        const r1 = token
          ? await fetch('/api/config/api-keys/omdb', { headers: { Authorization: `Bearer ${token}` } })
          : await fetch('/api/public/api-keys/omdb')
        if (r1.ok) { const j = await r1.json(); setOmdbConfigured(j.source==='env'?'env':'storage') } else setOmdbConfigured('none')
      } catch { setOmdbConfigured('none') }
      try {
        const r2 = token
          ? await fetch('/api/config/api-keys/fanarttv', { headers: { Authorization: `Bearer ${token}` } })
          : await fetch('/api/public/api-keys/fanarttv')
        if (r2.ok) { const j = await r2.json(); setFanartConfigured(j.source==='env'?'env':'storage') } else setFanartConfigured('none')
      } catch { setFanartConfigured('none') }
    } catch {}
  }

  useEffect(() => { load() }, [])

  const connectTrakt = async () => {
    try {
      const d = await (async () => {
        const r = await fetch('/api/auth/oauth/trakt/auth', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!r.ok) throw new Error('auth init failed')
        return r.json()
      })()
      if (d?.authUrl) {
        // Open in external browser; Electron will intercept and open externally
        window.open(d.authUrl, '_blank')
        // Poll status so UI flips to Connected when callback completes
        let attempts = 0
        const iv = setInterval(async () => {
          attempts++
          try {
            const s = await fetchStatus('trakt')
            setTrakt(s)
            if (s.configured) { clearInterval(iv) }
          } catch {}
          if (attempts > 180) clearInterval(iv)
        }, 1000)
      }
    } catch {}
  }

  const startTraktDevice = async () => {
    try {
      const r = await fetch('/api/auth/oauth/trakt/device/start', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to start device auth')
      setTraktDevice(data)
      setTraktPolling(true)
      // Copy code to clipboard for convenience
      try { await navigator.clipboard.writeText(data.user_code) } catch {}
      // Try to open verification URL with code prefilled (Trakt may ignore the param, but clipboard helps)
      const urlWithCode = `${data.verification_url}?code=${encodeURIComponent(data.user_code)}`
      window.open(urlWithCode, '_blank')
      let attempts = 0
      const maxAttempts = Math.ceil((data.expires_in || 600) / (data.interval || 5))
      const iv = setInterval(async () => {
        attempts++
        try {
          const headers:any = { 'Content-Type':'application/json' }
          if (token) headers.Authorization = `Bearer ${token}`
          const p = await fetch('/api/auth/oauth/trakt/device/poll', { method:'POST', headers, body: JSON.stringify({ device_code: data.device_code }) })
          const j = await p.json()
          if (j && j.success) {
            clearInterval(iv)
            setTraktPolling(false)
            setTraktDevice(null)
            await load()
          }
        } catch {}
        if (attempts > maxAttempts) { clearInterval(iv); setTraktPolling(false) }
      }, (data.interval || 5) * 1000)
    } catch {}
  }

  const connectAllDebrid = async () => {
    try {
      const d = await getAuth('alldebrid')
      if (d?.pinData) {
        setPinData({ pin: d.pinData.pin, check: d.pinData.check, user_url: d.pinData.user_url })
        setPinStatus('waiting')
        // Copy pin and open user URL with prefilled code if supported
        try { await navigator.clipboard.writeText(d.pinData.pin) } catch {}
        try { window.open(`${d.pinData.user_url}?pin=${encodeURIComponent(d.pinData.pin)}`, '_blank') } catch {}
        // start polling
        const start = Date.now()
        const poll = async () => {
          try {
            const r = await checkPin(d.pinData.pin, d.pinData.check)
            if (r?.activated) {
              setPinStatus('activated')
              setPinData(null)
              await load()
              return
            }
          } catch {
            setPinStatus('error')
            return
          }
          if (Date.now() - start < 120000) {
            setTimeout(poll, 3000)
          } else {
            setPinStatus('error')
          }
        }
        setTimeout(poll, 3000)
      }
    } catch {
      setPinStatus('error')
    }
  }

  const disconnect = async (provider: 'trakt'|'alldebrid') => {
    try { await revokeAuth(provider); await load() } catch {}
  }

  const saveApiKey = async (provider: 'omdb'|'fanarttv', key: string) => {
    try {
      const body = JSON.stringify({ apiKey: key })
      if (token) {
        const r = await fetch(`/api/config/api-keys/${provider}`, { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body })
        if (r.ok) { await load(); return }
      }
      const r2 = await fetch(`/api/public/api-keys/${provider}`, { method:'POST', headers: { 'Content-Type':'application/json' }, body })
      if (r2.ok) await load()
    } catch {}
  }

  // Maintenance / Clear cache and optionally remove configuration
  const [clearAll, setClearAll] = useState({ images: true, transcoded: true, metadata: true, trakt: false, alldebrid: false, omdb: false, fanarttv: false })
  const clearCaches = async () => {
    try {
      const body:any = { images: clearAll.images, transcoded: clearAll.transcoded, metadata: clearAll.metadata, remove: {} as any }
      if (clearAll.trakt) body.remove.trakt = true
      if (clearAll.alldebrid) body.remove.alldebrid = true
      if (clearAll.omdb) body.remove.omdb = true
      if (clearAll.fanarttv) body.remove.fanarttv = true
      const r = await fetch('/api/maintenance/clear', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
      if (r.ok) {
        await load()
        alert('Cleared. You may need to reconfigure if you removed configuration.')
      } else {
        alert('Failed to clear')
      }
    } catch { alert('Failed to clear') }
  }

  const StatusBadge = ({ s }: { s: OAuthStatus }) => s.configured ? (
    <Badge variant={s.expired ? 'destructive' : 'default'}>{s.expired ? 'Expired' : 'Connected'}</Badge>
  ) : (<Badge variant="outline">Not connected</Badge>)

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-10 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <Card className="p-4 lg:col-span-1 glass">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Account</div>
            <div className="font-semibold">Overview</div>
            <Separator className="my-3" />
            <div className="text-sm text-muted-foreground">Connections</div>
            <div className="text-foreground">Trakt</div>
            <div className="text-foreground">AllDebrid</div>
            <Separator className="my-3" />
            <div className="text-sm text-muted-foreground">Security</div>
            <div className="text-foreground">Sessions</div>
          </div>
        </Card>

        {/* Content */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="p-6 glass">
            <h2 className="text-xl font-semibold mb-2">Connected Services</h2>
            <p className="text-sm text-muted-foreground mb-4">Link third-party services for personalized content and seamless playback.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2"><div className="font-medium">Trakt</div><StatusBadge s={trakt} /></div>
                <p className="text-sm text-muted-foreground mb-3">Sync watchlist and recommendations from your Trakt account.</p>
                {trakt.configured ? (
                  <Button variant="destructive" onClick={()=>disconnect('trakt')}>Disconnect</Button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="hero" onClick={startTraktDevice}>Connect Trakt</Button>
                    </div>
                    {traktDevice && (
                      <Alert>
                        <AlertTitle>Authorize Trakt</AlertTitle>
                        <AlertDescription>
                          We copied your code to the clipboard. If not, the code is <span className="font-semibold">{traktDevice.user_code}</span>.
                          Open <a href={`${traktDevice.verification_url}?code=${encodeURIComponent(traktDevice.user_code)}`} className="underline" target="_blank" rel="noreferrer">{traktDevice.verification_url}</a> and paste the code if needed.
                          {traktPolling ? <span className="ml-2">Waiting for approval…</span> : null}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2"><div className="font-medium">AllDebrid</div><StatusBadge s={alldebrid} /></div>
                <p className="text-sm text-muted-foreground mb-3">Unlock torrents and filehosts for instant streaming.</p>
                {alldebrid.configured ? (
                  <Button variant="destructive" onClick={()=>disconnect('alldebrid')}>Disconnect</Button>
                ) : (
                  <Button variant="hero" onClick={connectAllDebrid}>Connect AllDebrid</Button>
                )}
                {pinData && (
                  <Alert className="mt-3">
                    <AlertTitle>Authorize AllDebrid</AlertTitle>
                    <AlertDescription>
                      Open <a href={pinData.user_url} target="_blank" rel="noreferrer" className="underline">alldebrid.com/pin</a> and enter PIN <span className="font-semibold">{pinData.pin}</span>.
                      {pinStatus === 'waiting' && <span className="ml-2">Waiting for activation…</span>}
                      {pinStatus === 'activated' && <span className="ml-2">Activated!</span>}
                      {pinStatus === 'error' && <span className="ml-2 text-destructive">Failed or timeout.</span>}
                    </AlertDescription>
                  </Alert>
                )}
              </Card>
            </div>
          </Card>
        <Card className="p-6 glass">
          <h2 className="text-xl font-semibold mb-2">API Keys</h2>
          <p className="text-sm text-muted-foreground mb-4">Configure metadata providers. Keys provided via environment variables are managed by the server.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2"><div className="font-medium">OMDb</div>{omdbConfigured!=='none'?<Badge variant={omdbConfigured==='env'?'secondary':'default'}>{omdbConfigured==='env'?'From Env':'Configured'}</Badge>:<Badge variant="outline">Not configured</Badge>}</div>
                <p className="text-sm text-muted-foreground mb-3">Used as a fallback for title/year and posters.</p>
                <div className="flex gap-2">
                  <input disabled={omdbConfigured==='env'} value={omdbKey} onChange={(e)=> setOmdbKey(e.target.value)} placeholder="OMDb API Key" className="flex-1 bg-transparent border border-border rounded px-3 py-2 text-sm" />
                  <Button disabled={omdbConfigured==='env' || !omdbKey} onClick={()=> saveApiKey('omdb', omdbKey)}>Save</Button>
          </div>
        </Card>

        <Card className="p-6 glass">
          <h2 className="text-xl font-semibold mb-2">Maintenance</h2>
          <p className="text-sm text-muted-foreground mb-4">Clear caches or remove stored configuration.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="font-medium">Caches</div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="images-cache"
                    aria-describedby="images-cache-text"
                    type="checkbox"
                    checked={clearAll.images}
                    onChange={e=> setClearAll(v=>({ ...v, images: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="images-cache" className="font-medium text-gray-900 dark:text-gray-300">Artwork/Background Cache</label>
                  <p id="images-cache-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Clear cached artwork images and backgrounds to free up disk space</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="transcoded-cache"
                    aria-describedby="transcoded-cache-text"
                    type="checkbox"
                    checked={clearAll.transcoded}
                    onChange={e=> setClearAll(v=>({ ...v, transcoded: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="transcoded-cache" className="font-medium text-gray-900 dark:text-gray-300">Transcoded/Remux Cache</label>
                  <p id="transcoded-cache-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Remove transcoded video files and remuxed content cache</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="metadata-cache"
                    aria-describedby="metadata-cache-text"
                    type="checkbox"
                    checked={clearAll.metadata}
                    onChange={e=> setClearAll(v=>({ ...v, metadata: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="metadata-cache" className="font-medium text-gray-900 dark:text-gray-300">TV Metadata Cache</label>
                  <p id="metadata-cache-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Clear cached TV show metadata including episode information</p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="font-medium">Remove Configuration</div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="trakt-config"
                    aria-describedby="trakt-config-text"
                    type="checkbox"
                    checked={clearAll.trakt}
                    onChange={e=> setClearAll(v=>({ ...v, trakt: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="trakt-config" className="font-medium text-gray-900 dark:text-gray-300">Trakt OAuth</label>
                  <p id="trakt-config-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Remove Trakt authentication and reset connection</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="alldebrid-config"
                    aria-describedby="alldebrid-config-text"
                    type="checkbox"
                    checked={clearAll.alldebrid}
                    onChange={e=> setClearAll(v=>({ ...v, alldebrid: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="alldebrid-config" className="font-medium text-gray-900 dark:text-gray-300">AllDebrid OAuth + API</label>
                  <p id="alldebrid-config-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Remove AllDebrid authentication and API configuration</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="omdb-config"
                    aria-describedby="omdb-config-text"
                    type="checkbox"
                    checked={clearAll.omdb}
                    onChange={e=> setClearAll(v=>({ ...v, omdb: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="omdb-config" className="font-medium text-gray-900 dark:text-gray-300">OMDb API Key</label>
                  <p id="omdb-config-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Remove stored OMDb API key configuration</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="fanarttv-config"
                    aria-describedby="fanarttv-config-text"
                    type="checkbox"
                    checked={clearAll.fanarttv}
                    onChange={e=> setClearAll(v=>({ ...v, fanarttv: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded-sm focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                </div>
                <div className="ms-2 text-sm">
                  <label htmlFor="fanarttv-config" className="font-medium text-gray-900 dark:text-gray-300">Fanart.tv API Key</label>
                  <p id="fanarttv-config-text" className="text-xs font-normal text-gray-500 dark:text-gray-300">Remove stored Fanart.tv API key configuration</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Button variant="destructive" onClick={clearCaches}>Clear Selected</Button>
          </div>
        </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2"><div className="font-medium">Fanart.tv</div>{fanartConfigured!=='none'?<Badge variant={fanartConfigured==='env'?'secondary':'default'}>{fanartConfigured==='env'?'From Env':'Configured'}</Badge>:<Badge variant="outline">Not configured</Badge>}</div>
                <p className="text-sm text-muted-foreground mb-3">Primary artwork source for posters.</p>
                <div className="flex gap-2">
                  <input disabled={fanartConfigured==='env'} value={fanartKey} onChange={(e)=> setFanartKey(e.target.value)} placeholder="Fanart.tv API Key" className="flex-1 bg-transparent border border-border rounded px-3 py-2 text-sm" />
                  <Button disabled={fanartConfigured==='env' || !fanartKey} onClick={()=> saveApiKey('fanarttv', fanartKey)}>Save</Button>
                </div>
              </Card>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Settings
