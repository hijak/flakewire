export type MediaItem = { id: string; imdbId?: string | null; title: string; year?: number | string | null; type: 'movie'|'tv'; poster?: string; rating?: number | string | null }

// Single-user mode: no Authorization headers needed; server uses default scope

export async function getHomeFeed(refresh: boolean = false): Promise<{ movies: MediaItem[]; tvShows: MediaItem[]; source: string }>
{
  const u = new URL('/api/home', window.location.origin)
  if (refresh) u.searchParams.set('refresh', 'true')
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error('Failed to load home feed')
  return r.json()
}

export async function searchMedia(q: string, type: 'movie'|'tv' = 'movie') {
  const u = new URL('/api/search/media', window.location.origin)
  u.searchParams.set('q', q)
  u.searchParams.set('type', type)
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error('Search failed')
  return r.json() as Promise<{ results: MediaItem[] }>
}

export type SourceItem = { id: string; name: string; provider: string; quality: string; seeders?: number; size?: number; type: string; url: string; requiresDebrid?: boolean; hash?: string; instant?: boolean }

export type CompatibilityInfo = {
  format: string;
  browserSupport: 'universal' | 'good' | 'fair' | 'limited';
  recommendedAction?: string;
  alternativeCodecs?: string[];
  notes?: string;
}

export type ResolveResponse = {
  status: 'ok' | 'non_streamable';
  directUrl?: string;
  originalLink?: string;
  filename?: string;
  format?: string;
  compatibility?: CompatibilityInfo;
  message?: string;
  suggestion?: string;
  availableFormats?: string[];
  reason?: string;
}

export async function getSources(type: 'movie'|'tv', imdbId: string, season?: number, episode?: number) {
  const path = `/api/sources/${encodeURIComponent(type)}/${encodeURIComponent(imdbId)}`
  const u = new URL(path, window.location.origin)
  if (season) u.searchParams.set('season', String(season))
  if (episode) u.searchParams.set('episode', String(episode))
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error('Failed to load sources')
  return r.json() as Promise<{ sources: SourceItem[] }>
}

export async function resolveLink(link: string) {
  const r = await fetch('/api/debrid/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }) })
  if (!r.ok) throw new Error('Failed to resolve link')
  return r.json() as Promise<ResolveResponse>
}

export async function getHealth(): Promise<{ debridProviders?: string[] } & Record<string, any>> {
  const r = await fetch('/api/health')
  if (!r.ok) throw new Error('Failed to load health')
  return r.json()
}

export async function getVideoFormats() {
  const r = await fetch('/api/video/formats')
  if (!r.ok) throw new Error('Failed to load video format information')
  return r.json() as Promise<{
    supportedFormats: Record<string, {
      format: string;
      mimeType: string;
      browserSupport: string;
      codecs: string[];
      priority: number;
      recommended: boolean;
      issues?: string[];
      alternatives?: string[];
    }>;
    browserCompatibility: Record<string, Record<string, boolean>>;
    recommendations: {
      primary: string;
      fallback: string;
      avoid: string[];
      notes: string;
    };
  }>
}

export type NotificationItem = {
  id: string;
  type: 'episode' | 'premiere';
  title: string;
  message: string;
  aired?: string | null;
  poster?: string | null;
  show?: { imdbId?: string|null; title?: string };
  episode?: { imdbId?: string|null; season?: number|null; number?: number|null; title?: string };
}

export async function getNotifications(refresh: boolean = false) {
  const u = new URL('/api/notifications', window.location.origin)
  if (refresh) u.searchParams.set('refresh', 'true')
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error('Failed to load notifications')
  return r.json() as Promise<{ notifications: NotificationItem[]; source?: string; timestamp: string }>
}

export async function getMoviesFeed(refresh: boolean = false) {
  const u = new URL('/api/movies/feed', window.location.origin)
  if (refresh) u.searchParams.set('refresh', 'true')
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error('Failed to load movies feed')
  return r.json() as Promise<{ collection: MediaItem[]; watchlist: MediaItem[]; recent?: MediaItem[]; lists?: { name: string; id: string; items: MediaItem[] }[] }>
}

export async function getTVFeed(refresh: boolean = false) {
  const u = new URL('/api/tv/feed', window.location.origin)
  if (refresh) u.searchParams.set('refresh', 'true')
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error('Failed to load tv feed')
  return r.json() as Promise<{ collection: MediaItem[]; watchlist: MediaItem[]; recent?: MediaItem[]; lists?: { name: string; id: string; items: MediaItem[] }[] }>
}
