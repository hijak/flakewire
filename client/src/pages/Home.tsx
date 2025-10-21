import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import MediaRow from "@/components/MediaRow";
import { getHomeFeed, MediaItem } from "@/lib/api";
import { toast } from "sonner";
import { useMemo } from "react";
import LoadingLogo from "@/components/LoadingLogo";

const Home = () => {
  const [movies, setMovies] = useState<MediaItem[]>([])
  const [shows, setShows] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const [featured, setFeatured] = useState<{ imdbId?: string|null; title: string; year?: string|number|null; poster?: string; background?: string; plot?: string; rating?: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const refresh = new URLSearchParams(window.location.search).get('refresh') === '1'
    getHomeFeed(refresh)
      .then(async (d) => {
        setMovies(d.movies || []); setShows(d.tvShows || [])
        const first = (d.movies || [])[0]
        if (first?.imdbId) {
          try {
            const r = await fetch(`/api/movie/${first.imdbId}`)
            if (r.ok) {
              const det = await r.json()
              setFeatured({ imdbId: det.imdbId, title: det.title, year: det.year, poster: det.poster, background: det.background || det.poster, plot: det.plot, rating: det.rating })
            } else {
              setFeatured({ imdbId: first.imdbId, title: first.title, year: first.year, poster: first.poster, background: first.poster })
            }
          } catch {
            setFeatured({ imdbId: first.imdbId, title: first.title, year: first.year, poster: first.poster, background: first.poster })
          }
        }
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {loading && <LoadingLogo text="Loading home feed…" />}
      {featured && (
        <Hero
          background={featured.background || featured.poster || undefined}
          title={featured.title}
          year={featured.year || undefined}
          rating={featured.rating || undefined}
          plot={featured.plot || undefined}
          imdbId={featured.imdbId || undefined}
          type={'movie'}
          overlay={<button
            className="text-sm text-primary hover:underline disabled:opacity-50"
            disabled={refreshing}
            onClick={()=>{
              setRefreshing(true);
              toast('Syncing home feed…');
              getHomeFeed(true)
                .then((d)=>{ setMovies(d.movies||[]); setShows(d.tvShows||[]); toast.success('Home feed synced'); })
                .catch(()=> toast.error('Failed to sync home feed'))
                .finally(()=> setRefreshing(false))
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>}
        />
      )}

      <div className="container mx-auto py-12">
        <MediaRow
          title="Movies"
          items={movies.map(m => ({ id: m.imdbId || String(m.id), title: m.title, year: String(m.year || ''), rating: typeof m.rating === 'string' ? Number(m.rating) : (m.rating as any), image: m.poster || '', genre: '' }))}
          onPlay={(id) => navigate(`/watch/movie/${id}`)}
        />
        <MediaRow
          title="TV Shows"
          items={shows.map(s => ({ id: s.imdbId || String(s.id), title: s.title, year: String(s.year || ''), rating: typeof s.rating === 'string' ? Number(s.rating) : (s.rating as any), image: s.poster || '', genre: '' }))}
          playLabel="Episodes"
          onPlay={(id) => navigate(`/tv/${id}/episodes`)}
        />
      </div>
    </div>
  );
};

export default Home;
