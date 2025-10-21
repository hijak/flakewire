import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import Header from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarIcon, Tv, Star, AlertCircle } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface EpisodeItem {
  id: number;
  season: number;
  number: number;
  title: string;
  first_aired: string;
  overview?: string;
  runtime: number;
  rating?: number;
  show: { title: string; year: number; ids: { trakt: number; imdb: string; slug: string } };
  type: "episode";
}

interface MovieItem {
  title: string;
  year: number;
  released: string;
  overview?: string;
  runtime: number;
  rating?: number;
  ids: { trakt: number; imdb: string; slug: string };
  type: "movie";
}

type ScheduledItem = EpisodeItem | MovieItem;

interface CalendarData {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  episodesByDate: Record<string, ScheduledItem[]>;
}

const CalendarPage = () => {
  const navigate = useNavigate();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [monthDate, setMonthDate] = useState<Date>(new Date());
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth() + 1;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/calendar/schedule/${year}/${month}`);
        if (r.ok) {
          const data = await r.json();
          setCalendarData(data);
        } else {
          // Graceful fallback: treat as empty schedule (no error UI)
          const pad = (n:number)=> String(n).padStart(2,'0');
          setCalendarData({ year, month, startDate: `${year}-${pad(month)}-01`, endDate: `${year}-${pad(month)}-28`, episodesByDate: {} } as any);
        }
      } catch (e) {
        setCalendarData({ year, month, startDate: `${year}-${String(month).padStart(2,'0')}-01`, endDate: `${year}-${String(month).padStart(2,'0')}-28`, episodesByDate: {} } as any);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [year, month]);

  const episodeKey = (it: any) => {
    const ids = (it?.show?.ids) || {};
    const sid = (ids.imdb || ids.slug || ids.trakt || '').toString().toLowerCase();
    const season = (it.season ?? it.episode?.season ?? '').toString();
    const number = (it.number ?? it.episode?.number ?? '').toString();
    return `${sid}:${season}:${number}`;
  };

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const localDateKeyFromDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const localDateKeyFromISO = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return localDateKeyFromDate(d);
  };
  const localDateKeyFromItem = (it: any) => localDateKeyFromISO(it?.first_aired || it?.released || null);

  const allEpisodes = useMemo(() => {
    if (!calendarData) return [] as any[];
    const out: any[] = [];
    const map = calendarData.episodesByDate || {};
    Object.keys(map).forEach(k => {
      const arr = map[k] || [];
      arr.forEach((it: any) => { if (it && it.type === 'episode') out.push(it); });
    });
    return out;
  }, [calendarData]);

  const itemsForDate = (d: Date): ScheduledItem[] => {
    if (!calendarData) return [];
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split("T")[0];
    return calendarData.episodesByDate[key] || [];
  };

  const todayList = useMemo(() => {
    if (!date) return [] as (ScheduledItem & { first_aired?: string })[];
    const targetKey = localDateKeyFromDate(date);
    const raw = allEpisodes.filter((i:any) => localDateKeyFromItem(i) === targetKey);
    const seen = new Set<string>();
    const dedup = [] as any[];
    for (const it of raw) {
      const k = episodeKey(it);
      if (!seen.has(k)) { seen.add(k); dedup.push(it); }
    }
    dedup.sort((a:any,b:any)=> new Date(a.first_aired||0).getTime() - new Date(b.first_aired||0).getTime());
    return dedup as any;
  }, [calendarData, date]);

  const upcomingList = useMemo(() => {
    if (!calendarData) return [] as (ScheduledItem & { displayDate: string })[];
    const today = new Date();
    const out: (ScheduledItem & { displayDate: string })[] = [];
    for (let i = 1; i <= 7; i++) {
      const check = new Date(today);
      check.setDate(today.getDate() + i);
      const keyLocal = localDateKeyFromDate(check);
      const arr = allEpisodes.filter((i:any)=> localDateKeyFromItem(i) === keyLocal);
      arr.forEach((it:any) => out.push({ ...(it as any), displayDate: check.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) }));
    }
    // Deduplicate and sort
    const seen = new Set<string>();
    const dedup = [] as any[];
    for (const it of out) { const k = episodeKey(it); if (!seen.has(k)) { seen.add(k); dedup.push(it); } }
    dedup.sort((a:any,b:any)=> new Date(a.first_aired||0).getTime() - new Date(b.first_aired||0).getTime());
    return dedup.slice(0, 10) as any;
  }, [calendarData]);

  const weekStats = useMemo(() => {
    const items = upcomingList.filter((i) => i.type === "episode") as EpisodeItem[];
    const episodeCount = items.length;
    const shows = new Set(items.map((e) => e.show.title)).size;
    const totalMinutes = items.reduce((sum, e) => sum + (e.runtime || 0), 0);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return { episodeCount, shows, watch: `${hours}h ${mins}m` };
  }, [upcomingList]);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-2">
            <CalendarIcon className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">TV Schedule</h1>
          </div>
          <p className="text-muted-foreground">Track your favorite shows and never miss an episode</p>
        </div>

        {error && (
          <Card className="mb-6 glass border-destructive/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span>{error}</span>
              </div>
              {error.includes("Trakt") && (
                <div className="mt-4">
                  <Link to="/onboarding">
                    <Button variant="hero">Connect to Trakt</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Widget */}
          <div className="lg:col-span-1">
            <Card className="glass border-border/50 shadow-[var(--shadow-elegant)] animate-fade-in-up">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="h-5 w-5 text-primary" />
                  Select Date
                </CardTitle>
                <CardDescription>Browse your Trakt schedule</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => setDate(d)}
                  onMonthChange={(d) => setMonthDate(d)}
                  className="rounded-md"
                />
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card className="glass border-border/50 shadow-[var(--shadow-elegant)] mt-6 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <CardHeader>
                <CardTitle className="text-lg">This Week</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Episodes</span>
                  <span className="text-2xl font-bold text-primary">{weekStats.episodeCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Shows</span>
                  <span className="text-2xl font-bold">{weekStats.shows}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Watch Time</span>
                  <span className="text-lg font-semibold">{weekStats.watch}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Episodes List */}
          <div className="lg:col-span-2 space-y-6">
            <div className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <Tv className="h-6 w-6 text-primary" />
                {date ? date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Today's Episodes"}
              </h2>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayList.map((episode, idx) => (
                    <Card key={`${episode?.id || idx}-${episode?.title || "ep"}`} className="glass border-border/50 shadow-[var(--shadow-elegant)] hover-scale transition-all duration-300 group">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-lg font-bold group-hover:text-primary transition-colors">{episode.show.title}</h3>
                              <Badge variant="secondary" className="text-xs">S{episode.season}E{episode.number}</Badge>
                            </div>
                            {episode.title && <p className="text-muted-foreground mb-2">{episode.title}</p>}
                            <div className="flex items-center gap-4 text-sm">
                              {typeof episode.rating === "number" && (
                                <span className="flex items-center gap-1">
                                  <Star className="h-4 w-4 text-primary fill-primary" />
                                  {episode.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="hero"
                            size="sm"
                            disabled={!((episode as any)?.show?.ids?.imdb) || (episode as any)?.season == null || (episode as any)?.number == null}
                            onClick={() => {
                              const imdb = (episode as any)?.show?.ids?.imdb;
                              const s = (episode as any)?.season;
                              const e = (episode as any)?.number;
                              if (imdb && s != null && e != null) navigate(`/watch/tv/${imdb}?season=${s}&episode=${e}`);
                            }}
                          >
                            Play
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {todayList.length === 0 && (
                    <Card className="p-6 text-center text-muted-foreground">No scheduled episodes for this day</Card>
                  )}
                </div>
              )}
            </div>

            {/* Upcoming Episodes */}
            <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              <h2 className="text-2xl font-bold mb-4">Upcoming</h2>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingList.map((item, idx) => (
                    <Card key={`${(item as any).id || idx}-${(item as any).title || "it"}`} className="glass border-border/50 shadow-[var(--shadow-elegant)] hover-scale transition-all duration-300 group">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="text-lg font-bold group-hover:text-primary transition-colors">{item.type === "episode" ? (item as EpisodeItem).show.title : (item as MovieItem).title}</h3>
                              <Badge variant="outline" className="text-xs">{item.displayDate}</Badge>
                            </div>
                            {item.type === "episode" && (item as EpisodeItem).title && (
                              <p className="text-muted-foreground mb-2">{(item as EpisodeItem).title}</p>
                            )}
                            <div className="flex items-center gap-4 text-sm">
                              {typeof item.rating === "number" && (
                                <span className="flex items-center gap-1">
                                  <Star className="h-4 w-4 text-primary fill-primary" />
                                  {item.rating?.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>
                          {item.type === "episode" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!((item as any)?.show?.ids?.imdb) || (item as any)?.season == null || (item as any)?.number == null}
                              onClick={() => {
                                const imdb = (item as any)?.show?.ids?.imdb;
                                const s = (item as any)?.season;
                                const e = (item as any)?.number;
                                if (imdb && s != null && e != null) navigate(`/watch/tv/${imdb}?season=${s}&episode=${e}`);
                              }}
                            >
                              Play
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => navigate(`/watch/movie/${(item as MovieItem).ids.imdb}`)}>Watch</Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {upcomingList.length === 0 && (
                    <Card className="p-6 text-center text-muted-foreground">
                      <CalendarIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
                      No upcoming episodes in the next 7 days
                    </Card>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
