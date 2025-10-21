import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import MediaRow from "@/components/MediaRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SlidersHorizontal } from "lucide-react";
import { getTVFeed, MediaItem } from "@/lib/api";
import { toast } from "sonner";
import LoadingLogo from "@/components/LoadingLogo";

const TVShows = () => {
  const [collection, setCollection] = useState<MediaItem[]>([])
  const [watchlist, setWatchlist] = useState<MediaItem[]>([])
  const [recent, setRecent] = useState<MediaItem[]>([])
  const [lists, setLists] = useState<{ name: string; id: string; items: MediaItem[] }[]>([])
  const navigate = useNavigate()
  const [refreshing, setRefreshing] = useState(false)
  const [withPostersOnly, setWithPostersOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filterQuery, setFilterQuery] = useState("")
  const [yearFrom, setYearFrom] = useState("")
  const [yearTo, setYearTo] = useState("")
  const load = (refresh=false)=> getTVFeed(refresh).then(d => {
    const col = d.collection || []
    const wl = d.watchlist || []
    const rc = d.recent || []
    const ls = d.lists || []
    // Aggregate into collection to guarantee visible content
    const aggregated = [...col, ...wl, ...ls.flatMap(l => l.items || []), ...rc]
      .filter((s)=> s && (s.title || s.imdbId || s.id))
      .filter((s, idx, arr)=> {
        const key = (s.imdbId || String(s.id) || '').toLowerCase()
        return key ? arr.findIndex(t => (t.imdbId || String(t.id) || '').toLowerCase() === key) === idx : idx === arr.findIndex(t => String(t.id) === String(s.id))
      })
    console.log('[TVShows] feed counts', { col: col.length, wl: wl.length, rc: rc.length, lists: ls.length, agg: aggregated.length })
    setCollection(aggregated.length ? aggregated : col)
    setWatchlist(wl)
    setRecent(rc)
    setLists(ls)
  }).finally(()=> setLoading(false))
  useEffect(() => { load(false).catch(()=> setLoading(false)) }, [])

  const genres = ["All", "Drama", "Sci-Fi", "Crime", "Thriller", "Horror", "Fantasy"];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {loading && <LoadingLogo text="Loading TV shows…" />}
      
      {/* Page Header */}
      <section className="container mx-auto px-4 py-12 border-b border-border/50">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="animate-fade-in">
            <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              TV Shows
            </h1>
            <p className="text-muted-foreground">
              Binge-worthy series and new episodes
            </p>
          </div>

          <div className="flex items-center gap-3 animate-fade-in">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="glass" size="sm" className="gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Filters
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Title contains</div>
                  <Input value={filterQuery} onChange={e=> setFilterQuery(e.target.value)} placeholder="e.g. Dexter" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">Year from</div>
                    <Input value={yearFrom} onChange={e=> setYearFrom(e.target.value.replace(/[^0-9]/g,''))} placeholder="e.g. 2010" />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-1">Year to</div>
                    <Input value={yearTo} onChange={e=> setYearTo(e.target.value.replace(/[^0-9]/g,''))} placeholder="e.g. 2024" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withPostersOnly} onChange={e=> setWithPostersOnly(e.target.checked)} />
                  With posters only
                </label>
                <div className="flex gap-2 justify-end">
                  <Button variant="glass" size="sm" onClick={()=>{ setFilterQuery(''); setYearFrom(''); setYearTo(''); setWithPostersOnly(false) }}>Clear</Button>
                </div>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="glass" size="sm" className="gap-2" disabled={refreshing}>Refresh</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={()=>{ setRefreshing(true); toast('Syncing TV shows…'); load(true).then(()=> toast.success('TV shows synced')).catch(()=> toast.error('Failed to sync TV shows')).finally(()=> setRefreshing(false)) }}>Refresh Library</DropdownMenuItem>
                <DropdownMenuItem onClick={async ()=>{ setRefreshing(true); await fetch('/api/maintenance/clear', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ images: true, transcoded: false, metadata: false }) }); await load(true); setRefreshing(false) }}>Refresh Posters</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Optional filters can be added here */}
      </section>

      <div className="container mx-auto py-12">
        <div className="text-xs text-muted-foreground mb-4">
          Debug: collection={collection.length} watchlist={watchlist.length} recent={recent.length} lists={lists.reduce((a,b)=> a + (b.items?.length||0), 0)}
        </div>
        {/* All Shows (aggregated) */}
        {(!loading) && (
          <MediaRow
            title="All Shows"
            items={[
              ...collection,
              ...watchlist,
              ...lists.flatMap(l => l.items || []),
              ...recent,
            ]
              .filter((s, idx, arr) => {
                const key = (s.imdbId || String(s.id) || '').toLowerCase();
                return key ? arr.findIndex(t => (t.imdbId || String(t.id) || '').toLowerCase() === key) === idx : idx === arr.findIndex(t => String(t.id) === String(s.id));
              })
              .filter(s => {
                const y = Number((s as any).year || 0);
                if (withPostersOnly && !(s as any).poster) return false;
                if (filterQuery && !(s as any).title?.toLowerCase().includes(filterQuery.toLowerCase())) return false;
                if (yearFrom && !(y >= Number(yearFrom))) return false;
                if (yearTo && !(y <= Number(yearTo))) return false;
                return true;
              })
              .map(s => ({
                id: (s as any).imdbId || String((s as any).id),
                title: (s as any).title,
                year: String((s as any).year || ''),
                rating: typeof (s as any).rating === 'string' ? Number((s as any).rating) : (s as any).rating,
                image: (s as any).poster || ''
              }))}
            playLabel="Episodes"
            onPlay={(id)=>navigate(`/tv/${id}/episodes`)}
            onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')}
          />
        )}
        <MediaRow title="Collection" items={collection.filter(s => {
          const y = Number(s.year || 0);
          if (withPostersOnly && !s.poster) return false;
          if (filterQuery && !s.title.toLowerCase().includes(filterQuery.toLowerCase())) return false;
          if (yearFrom && !(y >= Number(yearFrom))) return false;
          if (yearTo && !(y <= Number(yearTo))) return false;
          return true;
        }).map(s => ({ id: s.imdbId || String(s.id), title: s.title, year: String(s.year || ''), rating: typeof (s as any).rating === 'string' ? Number((s as any).rating) : (s as any).rating, image: s.poster || '' }))} playLabel="Episodes" onPlay={(id)=>navigate(`/tv/${id}/episodes`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        {lists.length > 0 && (
          <MediaRow
            title="Your Lists"
            items={lists.flatMap(l => l.items).filter(s => {
              const y = Number(s.year || 0);
              if (withPostersOnly && !s.poster) return false;
              if (filterQuery && !s.title.toLowerCase().includes(filterQuery.toLowerCase())) return false;
              if (yearFrom && !(y >= Number(yearFrom))) return false;
              if (yearTo && !(y <= Number(yearTo))) return false;
              return true;
            }).map(s => ({ id: s.imdbId || String(s.id), title: s.title, year: String(s.year || ''), rating: typeof (s as any).rating === 'string' ? Number((s as any).rating) : (s as any).rating, image: s.poster || '' }))}
            playLabel="Episodes"
            onPlay={(id)=>navigate(`/tv/${id}/episodes`)}
            onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')}
          />
        )}
        <MediaRow title="Watchlist" items={watchlist.filter(s => {
          const y = Number(s.year || 0);
          if (withPostersOnly && !s.poster) return false;
          if (filterQuery && !s.title.toLowerCase().includes(filterQuery.toLowerCase())) return false;
          if (yearFrom && !(y >= Number(yearFrom))) return false;
          if (yearTo && !(y <= Number(yearTo))) return false;
          return true;
        }).map(s => ({ id: s.imdbId || String(s.id), title: s.title, year: String(s.year || ''), rating: typeof (s as any).rating === 'string' ? Number((s as any).rating) : (s as any).rating, image: s.poster || '' }))} playLabel="Episodes" onPlay={(id)=>navigate(`/tv/${id}/episodes`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        {lists.map(l => (
          <MediaRow key={l.id} title={`List: ${l.name}`} items={l.items.filter(s => {
            const y = Number(s.year || 0);
            if (withPostersOnly && !s.poster) return false;
            if (filterQuery && !s.title.toLowerCase().includes(filterQuery.toLowerCase())) return false;
            if (yearFrom && !(y >= Number(yearFrom))) return false;
            if (yearTo && !(y <= Number(yearTo))) return false;
            return true;
          }).map(s => ({ id: s.imdbId || String(s.id), title: s.title, year: String(s.year || ''), rating: typeof (s as any).rating === 'string' ? Number((s as any).rating) : (s as any).rating, image: s.poster || '' }))} playLabel="Episodes" onPlay={(id)=>navigate(`/tv/${id}/episodes`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        ))}
        {recent.length > 0 && (
          <MediaRow title="Recently Watched" items={recent.filter(s => {
            const y = Number(s.year || 0);
            if (withPostersOnly && !s.poster) return false;
            if (filterQuery && !s.title.toLowerCase().includes(filterQuery.toLowerCase())) return false;
            if (yearFrom && !(y >= Number(yearFrom))) return false;
            if (yearTo && !(y <= Number(yearTo))) return false;
            return true;
          }).map(s => ({ id: s.imdbId || String(s.id), title: s.title, year: String(s.year || ''), rating: typeof (s as any).rating === 'string' ? Number((s as any).rating) : (s as any).rating, image: s.poster || '' }))} playLabel="Episodes" onPlay={(id)=>navigate(`/tv/${id}/episodes`)} onInfo={(id)=> window.open(`https://www.imdb.com/title/${id}`,'_blank')} />
        )}
      </div>
    </div>
  );
};

export default TVShows;
