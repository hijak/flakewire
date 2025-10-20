import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import MediaRow from "@/components/MediaRow";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SlidersHorizontal } from "lucide-react";
import { getMoviesFeed, MediaItem } from "@/lib/api";
import { toast } from "sonner";
import LoadingLogo from "@/components/LoadingLogo";

const Movies = () => {
  const [collection, setCollection] = useState<MediaItem[]>([])
  const [watchlist, setWatchlist] = useState<MediaItem[]>([])
  const [recent, setRecent] = useState<MediaItem[]>([])
  const [lists, setLists] = useState<{ name: string; id: string; items: MediaItem[] }[]>([])
  const navigate = useNavigate()
  const [refreshing, setRefreshing] = useState(false)
  const [withPostersOnly, setWithPostersOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = (refresh=false)=> getMoviesFeed(refresh).then(d => { setCollection(d.collection||[]); setWatchlist(d.watchlist||[]); setRecent(d.recent||[]); setLists(d.lists||[]) }).finally(()=> setLoading(false))
  useEffect(() => { load(false).catch(()=> setLoading(false)) }, [])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {loading && <LoadingLogo text="Loading movies…" />}
      
      {/* Page Header */}
      <section className="container mx-auto px-4 py-12 border-b border-border/50">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="animate-fade-in">
            <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Movies
            </h1>
            <p className="text-muted-foreground">Discover the latest and greatest in cinema</p>
          </div>

          <div className="flex items-center gap-3 animate-fade-in">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="glass" size="sm" className="gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withPostersOnly} onChange={e=> setWithPostersOnly(e.target.checked)} />
                  With posters only
                </label>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="glass" size="sm" className="gap-2" disabled={refreshing}>Refresh</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={()=>{ setRefreshing(true); toast('Syncing movies…'); load(true).then(()=> toast.success('Movies synced')).catch(()=> toast.error('Failed to sync movies')).finally(()=> setRefreshing(false)) }}>Refresh Library</DropdownMenuItem>
                <DropdownMenuItem onClick={async ()=>{ setRefreshing(true); await fetch('/api/maintenance/clear', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ images: true, transcoded: false, metadata: false }) }); await load(true); setRefreshing(false) }}>Refresh Posters</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      <div className="container mx-auto py-12">
        {recent.length > 0 && (
          <MediaRow title="Recently Watched" items={recent.filter(m => withPostersOnly ? !!m.poster : true).map(m => ({ id: m.imdbId || String(m.id), title: m.title, year: String(m.year || ''), rating: typeof (m as any).rating === 'string' ? Number((m as any).rating) : (m as any).rating, image: m.poster || '' }))} onPlay={(id)=>navigate(`/watch/movie/${id}`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        )}
        <MediaRow title="Collection" items={collection.filter(m => withPostersOnly ? !!m.poster : true).map(m => ({ id: m.imdbId || String(m.id), title: m.title, year: String(m.year || ''), rating: typeof (m as any).rating === 'string' ? Number((m as any).rating) : (m as any).rating, image: m.poster || '' }))} onPlay={(id)=>navigate(`/watch/movie/${id}`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        <MediaRow title="Watchlist" items={watchlist.filter(m => withPostersOnly ? !!m.poster : true).map(m => ({ id: m.imdbId || String(m.id), title: m.title, year: String(m.year || ''), rating: typeof (m as any).rating === 'string' ? Number((m as any).rating) : (m as any).rating, image: m.poster || '' }))} onPlay={(id)=>navigate(`/watch/movie/${id}`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        {lists.map(l => (
          <MediaRow key={l.id} title={`List: ${l.name}`} items={l.items.map(m => ({ id: m.imdbId || String(m.id), title: m.title, year: String(m.year || ''), rating: typeof (m as any).rating === 'string' ? Number((m as any).rating) : (m as any).rating, image: m.poster || '' }))} onPlay={(id)=>navigate(`/watch/movie/${id}`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        ))}
      </div>
    </div>
  );
};

export default Movies;
