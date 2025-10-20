import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Header from '@/components/Header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Hero from '@/components/Hero'
import LoadingLogo from '@/components/LoadingLogo'

type EpisodeItem = { episode: number; title: string; imdbID: string; plot?: string }

const TVEpisodes = () => {
  const { imdbId } = useParams()
  const [seasons, setSeasons] = useState<number[]>([])
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([])
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  // simple global cache so navigation away/back preserves cache
  const cacheRef = (globalThis as any).__fwEpCache || ((globalThis as any).__fwEpCache = new Map<string, Map<number, EpisodeItem[]>>())
  const [showTitle, setShowTitle] = useState('')
  const [showYear, setShowYear] = useState<string|number|undefined>(undefined)
  const [showPlot, setShowPlot] = useState('')
  const [showPoster, setShowPoster] = useState<string|undefined>(undefined)

  useEffect(() => {
    if (!imdbId) return
    fetch(`/api/tv/${imdbId}/seasons`).then(async r => {
      if (!r.ok) return
      const d = await r.json()
      const max = d.totalSeasons || 10
      const arr = Array.from({ length: max }, (_,i)=> i+1)
      setSeasons(arr)
      setShowTitle(d.title || '')
      setShowYear(d.year || undefined)
      setShowPlot(d.overview || '')
      setShowPoster(d.poster || undefined)
      if (arr.length) setSelectedSeason(arr[0])
    }).catch(()=>{})
  }, [imdbId])

  useEffect(() => {
    if (!imdbId || !selectedSeason) return
    const showKey = String(imdbId)
    if (cacheRef.has(showKey) && cacheRef.get(showKey)!.has(selectedSeason)) {
      setEpisodes(cacheRef.get(showKey)!.get(selectedSeason)!)
      return
    }
    setLoading(true)
    fetch(`/api/tv/${imdbId}/season/${selectedSeason}`).then(async r => {
      if (!r.ok) return
      const d = await r.json()
      const base = Array.isArray(d.episodes) ? d.episodes.map((ep:any)=> ({ episode: Number(ep.episode), title: ep.title, imdbID: ep.imdbID })) : []
      const detailed = await Promise.all(base.map(async (ep) => {
        try {
          const resp = await fetch(`/api/tv/${imdbId}/season/${selectedSeason}/episode/${ep.episode}`)
          if (resp.ok) { const det = await resp.json(); return { ...ep, plot: det.plot || '' } }
        } catch {}
        return ep
      }))
      setEpisodes(detailed)
      if (!cacheRef.has(showKey)) cacheRef.set(showKey, new Map())
      cacheRef.get(showKey)!.set(selectedSeason, detailed)
    }).catch(()=>{}).finally(()=> setLoading(false))
  }, [imdbId, selectedSeason])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {loading && <LoadingLogo text="Loading episodes…" />}
      {showTitle && (
        <Hero
          background={showPoster}
          title={showTitle}
          year={showYear as any}
          plot={showPlot}
          imdbId={imdbId}
          type="tv"
          overlay={<Button variant="glass" size="sm" onClick={()=> navigate(-1)}>Back</Button>}
        />
      )}
      <div className="container mx-auto p-4 space-y-4">
        <Card className="p-4">
          <div className="mb-4">
            <div className="text-sm text-muted-foreground mb-2">Season</div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {seasons.map(s => (
                <button key={s}
                  className={`px-3 py-1 rounded-full border text-sm whitespace-nowrap ${selectedSeason===s ? 'bg-primary text-primary-foreground border-primary' : 'glass border-border/60 hover:border-primary/60'}`}
                  onClick={()=> setSelectedSeason(s)}>
                  S{s}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-2">
            {episodes.map(ep => (
              <li key={ep.imdbID} className="glass rounded p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">E{ep.episode}: {ep.title}</div>
                  <div className="flex items-center gap-2">
                    <Button variant="hero" size="sm" onClick={()=> navigate(`/watch/tv/${imdbId}?season=${selectedSeason}&episode=${ep.episode}`)}>Play</Button>
                    <Button variant="glass" size="sm" onClick={()=> window.open(`https://www.imdb.com/title/${ep.imdbID}`, '_blank')}>IMDb</Button>
                  </div>
                </div>
                {ep.plot && (
                  <p className="text-sm text-muted-foreground mt-2">{ep.plot}</p>
                )}
              </li>
            ))}
            {loading && (<li className="text-sm text-muted-foreground">Loading episodes…</li>)}
          </ul>
        </Card>
      </div>
    </div>
  )
}

export default TVEpisodes
