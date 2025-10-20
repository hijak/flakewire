import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import MediaCard from "@/components/MediaCard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { MediaItem, searchMedia } from "@/lib/api";
import LoadingLogo from "@/components/LoadingLogo";

const Search = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const trendingSearches = ["Oppenheimer", "Dune", "The Boys", "House of the Dragon"];
  const [resultsMovies, setResultsMovies] = useState<MediaItem[]>([])
  const [resultsTV, setResultsTV] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const STORAGE_KEY = 'fw_search_history'
  const [history, setHistory] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setHistory(arr.filter((s)=> typeof s === 'string'))
      }
    } catch {}
  }, [])

  const saveHistory = (q: string) => {
    const v = q.trim()
    if (!v) return
    const next = [v, ...history.filter(item => item.toLowerCase() !== v.toLowerCase())].slice(0, 10)
    setHistory(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  const doSearch = (q: string) => {
    const v = q.trim()
    setSearchQuery(v)
    if (!v) { setResultsMovies([]); setResultsTV([]); return }
    setLoading(true)
    Promise.all([
      searchMedia(v, 'movie').then((r) => setResultsMovies(r.results || [])),
      searchMedia(v, 'tv').then((r) => setResultsTV(r.results || []))
    ]).finally(()=> setLoading(false))
    saveHistory(v)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="container mx-auto px-4 py-12">
        {/* Search Header */}
        <div className="max-w-3xl mx-auto mb-12 animate-fade-in">
          <h1 className="text-4xl md:text-5xl font-bold mb-6 text-center bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Search
          </h1>
          
          {/* Search Input */}
          <div className="relative">
            <Input
              type="text"
              placeholder="Search for movies, TV shows..."
              value={searchQuery}
              onChange={(e) => {
                const v = e.target.value; setSearchQuery(v)
                if (v.length < 3) { setResultsMovies([]); setResultsTV([]) }
              }}
              onKeyDown={(e)=> { if (e.key === 'Enter') doSearch(searchQuery) }}
              className="pl-4 h-14 text-lg glass border-primary/20 focus:border-primary"
            />
          </div>

          {/* Trending Searches */}
          {!searchQuery && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Trending Searches
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {trendingSearches.map((search) => (
                  <Badge
                    key={search}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary/10 hover:border-primary transition-all duration-300"
                    onClick={() => doSearch(search)}
                  >
                    {search}
                  </Badge>
                ))}
              </div>
              {history.length > 0 && (
                <div className="mt-6">
                  <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Search History</div>
                  <div className="flex flex-wrap gap-2">
                    {history.map((h) => (
                      <Badge key={h} variant="secondary" className="cursor-pointer" onClick={()=> doSearch(h)}>{h}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {loading && <LoadingLogo text="Searching…" />}
        {/* Results */}
        {searchQuery ? (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-bold mb-6">Results for "{searchQuery}"</h2>
            {resultsMovies.length > 0 && (
              <>
                <h3 className="text-xl font-semibold mb-3">Movies</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {resultsMovies.map((item) => (
                    <MediaCard key={`${item.id}-m`}
                      title={item.title}
                      year={String(item.year || '')}
                      rating={typeof item.rating === 'string' ? Number(item.rating) : (item.rating as number | undefined)}
                      image={item.poster || ''}
                      onPlay={() => navigate(`/watch/movie/${item.imdbId || item.id}`)}
                      onInfo={() => window.open(`https://www.imdb.com/title/${item.imdbId || item.id}`, '_blank')}
                    />
                  ))}
                </div>
              </>
            )}
            {resultsTV.length > 0 && (
              <>
                <h3 className="text-xl font-semibold my-6">TV Shows</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {resultsTV.map((item) => (
                    <MediaCard key={`${item.id}-t`}
                      title={item.title}
                      year={String(item.year || '')}
                      rating={typeof item.rating === 'string' ? Number(item.rating) : (item.rating as number | undefined)}
                      image={item.poster || ''}
                      playLabel="Episodes"
                      onPlay={() => navigate(`/tv/${item.imdbId || item.id}/episodes`)}
                      onInfo={() => window.open(`https://www.imdb.com/title/${item.imdbId || item.id}`, '_blank')}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-bold mb-6">Search Results</h2>
            <p className="text-muted-foreground">Try a search to see results for both Movies and TV Shows.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Search;
