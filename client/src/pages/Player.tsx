import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import Header from '@/components/Header'
import { getSources, resolveLink, SourceItem, getHealth, ResolveResponse, getVideoFormats } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Hls from 'hls.js'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import LoadingLogo from '@/components/LoadingLogo'

const Player = () => {
  const { type, imdbId } = useParams()
  const [sources, setSources] = useState<SourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [hasDebrid, setHasDebrid] = useState<boolean>(true)
  const [compatibilityInfo, setCompatibilityInfo] = useState<ResolveResponse | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [showCompatibilityAlert, setShowCompatibilityAlert] = useState(false)
  const [mkvPlayerMode, setMkvPlayerMode] = useState<'native' | 'enhanced' | 'fallback' | 'mp4_fallback'>('native')
  const [codecInfo, setCodecInfo] = useState<any>(null)
  const [retryingWithMp4, setRetryingWithMp4] = useState(false)
  const [externalOpening, setExternalOpening] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!type || !imdbId) return
    const sp = new URLSearchParams(location.search)
    const season = sp.get('season') ? Number(sp.get('season')) : undefined
    const episode = sp.get('episode') ? Number(sp.get('episode')) : undefined
    setLoading(true)
    getSources(type as any, imdbId, season, episode)
      .then(d => setSources(d.sources || []))
      .finally(()=>setLoading(false))
    // Robust debrid detection: health providers OR OAuth status OR stored API key
    Promise.all([
      getHealth().catch(() => null),
      fetch('/api/auth/oauth/alldebrid/status').then(r=> r.ok ? r.json() : null).catch(() => null),
      fetch('/api/public/api-keys/alldebrid').then(r=> r.ok).catch(() => false)
    ]).then(([h, oauthStatus, hasKey]) => {
      const list = Array.isArray(h?.debridProviders) ? h.debridProviders.map((x:any)=> String(x).toLowerCase()) : []
      const configured = Boolean(oauthStatus?.configured) || Boolean(hasKey) || list.includes('alldebrid')
      setHasDebrid(configured)
    }).catch(()=> setHasDebrid(false))
  }, [type, imdbId, location.search])

  
  
  const pickSource = async (s: SourceItem) => {
    try {
      setResolvingId(s.id)
      setLoading(true)
      setVideoError(null)
      setCompatibilityInfo(null)
      setShowCompatibilityAlert(false)

      if (s.requiresDebrid || s.url.startsWith('magnet:')) {
        const r = await resolveLink(s.url)

        if (r.status === 'ok' && r.directUrl) {
          setCompatibilityInfo(r)

          // Handle MKV externally via system player (mpv/vlc)
          if (r.format === 'mkv_native' && r.directUrl.includes('/api/stream/')) {
            const abs = r.directUrl.startsWith('/') ? `${window.location.origin}${r.directUrl}` : r.directUrl
            // Ask main process to open the external player
            try { await (window as any).electronAPI?.openExternalPlayer(abs) } catch {}
            // Show overlay briefly before navigating home
            setExternalOpening(true)
            setTimeout(() => { navigate('/') }, 1500)
            return
          } else {
            setSelectedUrl(r.directUrl)
            setFallbackUrl(null)

            // Show compatibility warning for other limited formats
            if (r.compatibility && r.compatibility.browserSupport === 'limited') {
              setShowCompatibilityAlert(true)
            }
          }
        } else {
          // Handle non-streamable response
          setVideoError(r.message || r.reason || 'This source cannot be streamed')
          setCompatibilityInfo(r)
        }
      } else {
        // Non-debrid direct link; if MKV, open externally
        if (s.url.toLowerCase().includes('.mkv')) {
          const abs = s.url.startsWith('/') ? `${window.location.origin}${s.url}` : s.url
          try { await (window as any).electronAPI?.openExternalPlayer(abs) } catch {}
          setExternalOpening(true)
          setTimeout(() => { navigate('/') }, 1500)
          return
        }
        setSelectedUrl(s.url)
      }
    } catch (e) {
      console.error('resolve failed', e)
      setVideoError('Failed to resolve streaming link')
    } finally {
      setResolvingId(null)
      setLoading(false)
    }
  }

  // Enhanced video player for MKV files and common formats
  useEffect(() => {
    const url = selectedUrl
    const video = videoRef.current
    if (!url || !video) return

    // Decode original path for extension checks (handles /api/stream/<encoded>)
    const getDecodedPath = (u: string) => {
      try {
        if (u.startsWith('/api/stream/')) {
          const enc = u.slice('/api/stream/'.length)
          const original = decodeURIComponent(enc)
          const p = new URL(original)
          return p.pathname.toLowerCase()
        }
        const p = new URL(u, window.location.origin)
        return p.pathname.toLowerCase()
      } catch { return u.toLowerCase() }
    }
    const path = getDecodedPath(url)

    if (path.endsWith('.mkv')) {
      // Try multiple MKV playback strategies
      const canPlayMkv = video.canPlayType('video/x-matroska')
      console.log(`MKV: Browser canPlayType for video/x-matroska: ${canPlayMkv}`)

      if (canPlayMkv === 'probably' || canPlayMkv === 'maybe') {
        console.log('MKV: Native playback supported')
        video.src = url
        setMkvPlayerMode('native')
      } else {
        console.log('MKV: Native playback not supported, trying enhanced approach')
        // Try MSE (Media Source Extensions) if available
        if ('MediaSource' in window && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) {
          console.log('MKV: Attempting MSE-based playback')
          tryMsePlayback(url, video)
        } else {
          console.log('MKV: MSE not available, using direct streaming')
          video.src = url
          setMkvPlayerMode('fallback')
        }
      }
    } else if (path.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource(url)
        hls.attachMedia(video)
        const onDestroy = () => hls.destroy()
        video.addEventListener('emptied', onDestroy, { once: true })
        return () => { hls.destroy(); video.removeEventListener('emptied', onDestroy) }
      } else if ((video as any).canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
      } else {
        video.src = url
      }
    } else if (path.endsWith('.mp4') || path.endsWith('.m4v') || path.endsWith('.webm')) {
      // Common browser-supported formats
      video.src = url
      try { video.load() } catch {}
    } else {
      video.src = url
    }
  }, [selectedUrl])

  // MSE-based MKV playback attempt
  const tryMsePlayback = async (url: string, video: HTMLVideoElement) => {
    try {
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()

      // Try to detect video codecs from the MKV data
      const videoCodec = detectVideoCodec(arrayBuffer)
      const audioCodec = detectAudioCodec(arrayBuffer)

      if (videoCodec && audioCodec) {
        const mimeType = `video/mp4; codecs="${videoCodec},${audioCodec}"`
        if (MediaSource.isTypeSupported(mimeType)) {
          console.log(`MKV: MSE supported with codecs: ${mimeType}`)
          // This would require demuxing the MKV container - complex implementation
          // For now, fall back to direct streaming
          video.src = url
          setMkvPlayerMode('fallback')
        }
      }
    } catch (error) {
      console.error('MKV: MSE playback failed:', error)
      video.src = url
      setMkvPlayerMode('fallback')
    }
  }

  // Detect video codec from file data (simplified)
  const detectVideoCodec = (arrayBuffer: ArrayBuffer): string | null => {
    const data = new Uint8Array(arrayBuffer)
    // Look for H.264 (AVC) signature
    if (data.includes(0x00, 0x00, 0x00, 0x01, 0x67)) {
      return 'avc1.42E01E' // H.264 baseline
    }
    return null
  }

  // Detect audio codec from file data (simplified)
  const detectAudioCodec = (arrayBuffer: ArrayBuffer): string | null => {
    const data = new Uint8Array(arrayBuffer)
    // Look for AAC signature
    if (data.includes(0xFF, 0xF1)) {
      return 'mp4a.40.2' // AAC
    }
    return null
  }

  // Handle successful video loading
  const handleVideoLoaded = () => {
    // Clear any previous errors when video loads successfully
    if (videoError) {
      setVideoError(null)
    }

    // If we're retrying with MP4 and it loaded successfully, update status
    if (retryingWithMp4 && mkvPlayerMode === 'mp4_fallback') {
      console.log('MKV: MP4 fallback loaded successfully')
      setVideoError(null)
      setShowCompatibilityAlert(false)
    }
  }

  // Handle video can play event
  const handleVideoCanPlay = () => {
    // Video can start playing, clear any loading states
    if (retryingWithMp4 && mkvPlayerMode === 'mp4_fallback') {
      console.log('MKV: MP4 fallback is ready to play')
    }
  }

  // Handle video errors with MKV-specific handling
  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget
    const error = video.error

    if (error) {
      let errorMessage = 'Video playback failed'
      const url = video.src || ''

      switch (error.code) {
        case error.MEDIA_ERR_ABORTED:
          errorMessage = 'Video playback was aborted'
          break
        case error.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error occurred during video playback'
          break
        case error.MEDIA_ERR_DECODE:
          errorMessage = 'Video codec not supported or file corrupted'
          break
        case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
          if (url.includes('.mkv')) {
            errorMessage = 'MKV format not supported by this browser. Try downloading or using a different player.'
          } else {
            errorMessage = 'Video format not supported by your browser'
          }
          break
        default:
          errorMessage = `Video error: ${error.message || 'Unknown error'}`
      }

      setVideoError(errorMessage)

      // Enhanced MKV error handling with fallback (HLS or MP4)
      if (url.includes('.mkv') && (error.code === error.MEDIA_ERR_DECODE || error.code === error.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
        // If we haven't tried MP4 fallback yet and it's available
        if (!retryingWithMp4 && fallbackUrl) {
          console.log('MKV: Direct playback failed, retrying with fallback')
          setRetryingWithMp4(true)
          setMkvPlayerMode(fallbackUrl.endsWith('.m3u8') ? 'enhanced' : 'mp4_fallback')
          setVideoError(fallbackUrl.endsWith('.m3u8') ? 'Switching to HLS fallback for compatibility…' : 'Switching to MP4 format for better compatibility...')
          setShowCompatibilityAlert(true)

          // Retry with fallback by updating selectedUrl, allowing HLS to attach if needed
          setTimeout(() => {
            setSelectedUrl(fallbackUrl)
          }, 1000)
        } else {
          // No fallback available or already tried
          setMkvPlayerMode('fallback')
          setVideoError(errorMessage + ' ' + (fallbackUrl ? '(MP4 fallback also failed)' : '(No MP4 fallback available)'))
          setShowCompatibilityAlert(true)

          // Try alternative playback methods as last resort
          if (!retryingWithMp4) {
            setTimeout(() => {
              tryAlternativeMkvPlayback(url)
            }, 1000)
          }
        }
      }
    }
  }

  // Try alternative MKV playback methods
  const tryAlternativeMkvPlayback = (url: string) => {
    const video = videoRef.current
    if (!video) return

    console.log('MKV: Trying alternative playback methods...')

    // Method 1: Try with different MIME type
    video.src = ''
    setTimeout(() => {
      video.src = url
      console.log('MKV: Retrying with direct URL...')
    }, 100)

    // Method 2: Check if we can provide download link
    const isDownloadable = url.includes('/api/stream/')
    if (isDownloadable) {
      console.log('MKV: Direct download available')
      setCodecInfo({
        canDownload: true,
        directUrl: url.replace('/api/stream/', ''),
        message: 'Your browser cannot play MKV files. You can download the file or use a media player that supports MKV.'
      })
    }
  }

  const qualityScore = (q?: string) => {
    const v = String(q||'').toLowerCase()
    if (v.includes('2160') || v.includes('4k')) return 100
    if (v.includes('1080')) return 80
    if (v.includes('720')) return 60
    if (v.includes('480')) return 40
    return 0
  }

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '—'
    const units = ['B','KB','MB','GB','TB'] as const
    let v = bytes; let i = 0
    while (v >= 1024 && i < units.length-1) { v/=1024; i++ }
    return `${v.toFixed(1)} ${units[i]}`
  }

  const getFileFormat = (filename?: string) => {
    if (!filename) return null
    const name = filename.toLowerCase()
    if (name.endsWith('.mp4')) return { format: 'MP4', supported: true, color: 'default' }
    if (name.endsWith('.webm')) return { format: 'WebM', supported: true, color: 'default' }
    if (name.endsWith('.m4v')) return { format: 'M4V', supported: true, color: 'default' }
    if (name.endsWith('.mkv')) return { format: 'MKV', supported: false, color: 'destructive' }
    if (name.endsWith('.avi')) return { format: 'AVI', supported: false, color: 'destructive' }
    if (name.endsWith('.mov')) return { format: 'MOV', supported: true, color: 'secondary' }
    return null
  }

  const displaySources = useMemo(() => {
    const sorted = [...sources].sort((a,b)=>{
      const qd = qualityScore(b.quality) - qualityScore(a.quality)
      if (qd !== 0) return qd
      const sd = (b.seeders||0) - (a.seeders||0)
      if (sd !== 0) return sd
      return (b.size||0) - (a.size||0)
    })
    return sorted.slice(0,20)
  }, [sources])

  const overlay = useMemo(() => (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl bg-card p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Select a Source</h2>
          <Button variant="glass" size="sm" onClick={()=>navigate(-1)}>Close</Button>
        </div>
        {!hasDebrid && sources.some(s=>s.requiresDebrid) && (
          <Alert className="mb-4" variant="destructive">
            <AlertTitle>Debrid not configured</AlertTitle>
            <AlertDescription>
              Some sources require an AllDebrid account to unlock streaming links. Configure a debrid provider to enable instant playback of these sources.
            </AlertDescription>
          </Alert>
        )}

        {showCompatibilityAlert && compatibilityInfo && (
          <Alert className="mb-4">
            <AlertTitle>
              {compatibilityInfo?.compatibility?.format === 'mkv' ? (
                <span>🎬 MKV Direct Streaming</span>
              ) : (
                <span>⚠️ Limited Browser Compatibility</span>
              )}
            </AlertTitle>
            <AlertDescription>
              {compatibilityInfo?.compatibility?.format === 'mkv' ? (
                <div className="space-y-2">
                  <p><strong>Format:</strong> MKV (Matroska)</p>
                  <p><strong>Streaming:</strong> Direct streaming enabled</p>
                  <p><strong>Player Mode:</strong> {mkvPlayerMode === 'native' ? 'Native' : mkvPlayerMode === 'enhanced' ? 'Enhanced' : 'Fallback'}</p>
                  <p className="text-sm text-muted-foreground">
                    {compatibilityInfo.compatibility.notes}
                  </p>
                  {mkvPlayerMode === 'fallback' && (
                    <div className="mt-2 p-2 bg-yellow-50 rounded text-sm">
                      <p><strong>Note:</strong> Your browser may not support MKV natively. The player will attempt multiple playback methods.</p>
                    </div>
                  )}
                  {codecInfo?.canDownload && (
                    <div className="mt-2 p-2 bg-blue-50 rounded text-sm">
                      <p><strong>Alternative:</strong> If playback fails, you can download the MKV file to play with VLC, MPC-HC, or other MKV-compatible players.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => window.open(codecInfo.directUrl, '_blank')}
                      >
                        Download MKV File
                      </Button>
                    </div>
                  )}
                </div>
              ) : compatibilityInfo.compatibility ? (
                <div className="space-y-2">
                  <p><strong>Format:</strong> {compatibilityInfo.compatibility.format.toUpperCase()}</p>
                  <p><strong>Support:</strong> {compatibilityInfo.compatibility.browserSupport}</p>
                  <p><strong>Recommended Action:</strong> {compatibilityInfo.compatibility.recommendedAction}</p>
                  <p className="text-sm text-muted-foreground">{compatibilityInfo.compatibility.notes}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>This format may not be supported by your browser.</p>
                  <p>Try selecting a different source, preferably one with MP4 format.</p>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {videoError && (
          <Alert className="mb-4" variant="destructive">
            <AlertTitle>Playback Error</AlertTitle>
            <AlertDescription>
              <div className="space-y-2">
                <p>{videoError}</p>
                {compatibilityInfo?.suggestion && (
                  <p><strong>Suggestion:</strong> {compatibilityInfo.suggestion}</p>
                )}
                <Button variant="outline" size="sm" onClick={() => {
                  setSelectedUrl(null)
                  setVideoError(null)
                  setShowCompatibilityAlert(false)
                  setCompatibilityInfo(null)
                }}>
                  Try Another Source
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <ul className="space-y-2">
            {displaySources.map(s => (
              <li key={s.id}>
                <div className="glass rounded-md p-3 flex items-start justify-between gap-3">
                  <dl className="grid grid-cols-1 md:grid-cols-5 w-full gap-2 text-sm">
                    <div className="md:col-span-2">
                      <dt className="text-muted-foreground">Filename</dt>
                      <dd className="font-medium break-all flex items-center gap-2">
                        {s.name || '—'}
                        {(() => {
                          const formatInfo = getFileFormat(s.name)
                          if (formatInfo) {
                            return (
                              <Badge variant={formatInfo.color as any} className="text-xs">
                                {formatInfo.format}
                                {!formatInfo.supported && ' ⚠️'}
                              </Badge>
                            )
                          }
                          return null
                        })()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source</dt>
                      <dd className="flex items-center gap-2">
                        <span className="font-medium">{s.provider}</span>
                        {s.instant && (<Badge variant="default">Instant</Badge>)}
                        {s.requiresDebrid ? (<Badge variant="secondary">Debrid</Badge>) : (<Badge variant="secondary">Direct</Badge>)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Quality</dt>
                      <dd><Badge variant="outline">{s.quality || 'Unknown'}</Badge></dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Size</dt>
                      <dd>{formatBytes(s.size)}</dd>
                    </div>
                  </dl>
                  <div className="shrink-0">
                    <Button variant="hero" size="sm" onClick={() => pickSource(s)} disabled={!!resolvingId}>Select</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {sources.length === 0 && !loading && (
          <div className="text-muted-foreground mt-3 flex items-center justify-between">
            <span>No sources found.</span>
            <Button variant="secondary" size="sm" onClick={()=>navigate(-1)}>Go Back</Button>
          </div>
        )}
      </Card>
    </div>
  ), [displaySources, resolvingId, loading, hasDebrid])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {(loading || resolvingId) && (
        <LoadingLogo text={resolvingId ? 'Finding a playable stream…' : 'Loading sources…'} />
      )}
      {externalOpening && <LoadingLogo text="Opening in external player…" />}
      {(loading || resolvingId) && (
        <LoadingLogo text={resolvingId ? 'Finding a playable stream…' : 'Loading sources…'} />
      )}
      <div className="container mx-auto p-4">
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          {selectedUrl ? (
            <div className="relative w-full h-full">
              <video
                ref={videoRef}
                controls
                autoPlay
                className="w-full h-full"
                onError={handleVideoError}
                onLoadedData={handleVideoLoaded}
                onCanPlay={handleVideoCanPlay}
              />
              {compatibilityInfo?.compatibility && (
                <div className="absolute top-2 right-2 bg-black/80 text-white px-2 py-1 rounded text-xs">
                  {compatibilityInfo.compatibility.format === 'mkv' ? (
                    <span>
                      🎬 {mkvPlayerMode === 'mp4_fallback' ? 'MP4' : 'MKV'} • {mkvPlayerMode.replace('_', ' ')}
                      {retryingWithMp4 && ' ⏳'}
                    </span>
                  ) : (
                    <span>{compatibilityInfo.compatibility.format.toUpperCase()} • {compatibilityInfo.compatibility.browserSupport}</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">Waiting for source selection…</div>
          )}
          {videoError && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
              <div className="text-center text-white">
                <div className="text-red-400 mb-2">⚠️</div>
                <div className="mb-4">{videoError}</div>
                <Button variant="outline" onClick={() => {
                  setSelectedUrl(null)
                  setVideoError(null)
                  setShowCompatibilityAlert(false)
                  setCompatibilityInfo(null)
                }}>
                  Back to Sources
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {!selectedUrl && overlay}
    </div>
  )
}

export default Player
