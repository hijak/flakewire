const axios = require('axios');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

function resolveCacheDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR; // allow override
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(base, 'Flake Wire', 'Cache');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Caches', 'Flake Wire');
    } else {
      const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
      return path.join(base, 'flake-wire');
    }
  } catch (_) {
    return path.join(process.cwd(), 'data');
  }
}

class PosterService {
  constructor(secureStorage, options = {}) {
    this.cache = new Map();
    this.cacheTimeout = 3600000; // 1 hour
    this.secureStorage = secureStorage;
    this.omdbApiKey = process.env.OMDB_API_KEY || options.omdbApiKey || 'be62d2ad'; // Default fallback
    this.posterDBApiKey = process.env.POSTERDB_API_KEY || options.posterDBApiKey || '';
    this.traktClientId = process.env.TRAKT_CLIENT_ID || options.traktClientId || '';
    this.fanartApiKey = process.env.FANART_API_KEY || process.env.FANARTTV_API_KEY || options.fanartApiKey || '';
    const cacheDir = resolveCacheDir();
    this.diskCacheDir = cacheDir;
    this.diskCachePath = path.join(cacheDir, 'posters_cache.json');
    this.diskCache = {};
    this._loadedDisk = false;
    try { if (!fs.existsSync(this.diskCacheDir)) fs.mkdirSync(this.diskCacheDir, { recursive: true }); } catch {}
    // Load disk cache synchronously best-effort
    try {
      if (fs.existsSync(this.diskCachePath)) {
        const txt = fs.readFileSync(this.diskCachePath, 'utf8');
        this.diskCache = JSON.parse(txt || '{}');
      } else {
        try { fs.writeFileSync(this.diskCachePath, JSON.stringify({}, null, 2)); } catch {}
        this.diskCache = {};
      }
      this._loadedDisk = true;
    } catch {
      this.diskCache = {};
      this._loadedDisk = true;
    }
  }

  // Helper method to get user's OMDb API key dynamically
  async getOmdbApiKey(userId = 'default') {
    try {
      // First try to get user's stored API key
      const keyData = await this.secureStorage.getApiKey(userId, 'omdb');
      if (keyData && keyData.key) {
        return keyData.key;
      }

      // Fallback to environment variable if no user key is stored
      return process.env.OMDB_API_KEY;
    } catch (error) {
      console.error('Error getting user OMDb API key:', error);
      return process.env.OMDB_API_KEY;
    }
  }

  getCacheKey(query, type = 'search') {
    return `${type}:${String(query).toLowerCase()}`;
  }

  isCacheValid(timestamp) {
    return Date.now() - timestamp < this.cacheTimeout;
  }

  _normalizePosterKey({ imdbId = null, title = '', year = null, type = 'movie' }) {
    if (imdbId && /^tt\d+$/.test(imdbId)) return `imdb:${imdbId}`;
    return `title:${String(title).toLowerCase().trim()}|${year || ''}|${type}`;
  }
  _getPosterFromDisk(key) {
    const v = this.diskCache[key];
    return typeof v === 'string' && v.length ? v : null;
  }
  async _setPosterToDisk(key, url) {
    this.diskCache[key] = url;
    try { await fsp.writeFile(this.diskCachePath, JSON.stringify(this.diskCache, null, 2)); } catch {}
  }
  _normalizeBackgroundKey({ imdbId = null, title = '', year = null, type = 'movie' }) {
    const base = this._normalizePosterKey({ imdbId, title, year, type });
    return `bg:${base}`;
  }

  _normalizeRatingKey({ imdbId = null, title = '', year = null, type = 'movie' }) {
    if (imdbId && /^tt\d+$/.test(imdbId)) return `rating:imdb:${imdbId}`;
    return `rating:title:${String(title).toLowerCase().trim()}|${year || ''}|${type}`;
  }

  _getMetaFromDisk(key) {
    try { return this.diskCache[key] ?? null; } catch { return null; }
  }

  async _setMetaToDisk(key, value) {
    this.diskCache[key] = value;
    try { await fsp.writeFile(this.diskCachePath, JSON.stringify(this.diskCache, null, 2)); } catch {}
  }

  getPlaceholderPoster(title, width = 300, height = 450) {
    // Return null to let the client render a branded placeholder (logo)
    return null;
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  async getOMDbPoster(title, year = null, type = 'movie') {
    // Always try to get the user's API key dynamically
    this.omdbApiKey = await this.getOmdbApiKey();
    if (!this.omdbApiKey) return null;
    const cacheKey = this.getCacheKey(`${title}-${year}-${type}`, 'omdbPoster');
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (this.isCacheValid(cached.timestamp)) return cached.data;
    }
    try {
      const params = {
        apikey: this.omdbApiKey,
        t: title,
        y: year || undefined,
        type: type === 'tv' ? 'series' : 'movie'
      };
      const res = await axios.get('https://www.omdbapi.com/', { params, timeout: 7000 });
      const data = res.data;
      const poster = data && data.Response === 'True' && data.Poster && data.Poster !== 'N/A' ? data.Poster : null;
      this.cache.set(cacheKey, { data: poster, timestamp: Date.now() });
      return poster;
    } catch (e) {
      console.error('OMDb poster fetch error:', e.message);
      return null;
    }
  }

  async getOMDbRating({ imdbId = null, title = null, year = null, type = 'movie' }) {
    try {
      // Always try to get user's API key dynamically
      this.omdbApiKey = await this.getOmdbApiKey();
      if (!this.omdbApiKey) return null;
      const keyPart = imdbId || `${title}-${year}-${type}`;
      const cacheKey = this.getCacheKey(`omdbRating:${keyPart}`, 'omdbRating');
      const diskKey = this._normalizeRatingKey({ imdbId, title, year, type });

      // Very long-lived disk cache for ratings (30 days or until manual clear)
      const RATING_TTL_MS = 1000 * 60 * 60 * 24 * 30;

      // Check memory cache with extended TTL
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < RATING_TTL_MS) return cached.data;
      }

      // Check disk cache
      const diskVal = this._getMetaFromDisk(diskKey);
      if (diskVal != null) {
        if (typeof diskVal === 'object' && diskVal !== null && 'value' in diskVal && 'ts' in diskVal) {
          if ((Date.now() - Number(diskVal.ts || 0)) < RATING_TTL_MS) {
            this.cache.set(cacheKey, { data: diskVal.value, timestamp: Date.now() });
            return diskVal.value;
          }
        } else if (typeof diskVal === 'number' || typeof diskVal === 'string') {
          const n = Number(diskVal);
          const val = isNaN(n) ? null : n;
          this.cache.set(cacheKey, { data: val, timestamp: Date.now() });
          return val;
        }
      }
      const params = imdbId ? { apikey: this.omdbApiKey, i: imdbId }
                            : { apikey: this.omdbApiKey, t: title, y: year || undefined, type: type === 'tv' ? 'series' : 'movie' };
      const res = await axios.get('https://www.omdbapi.com/', { params, timeout: 7000 });
      const data = res.data;
      let rating = null;
      if (data && data.Response === 'True') {
        const r = data.imdbRating;
        if (r && r !== 'N/A') {
          const n = Number(r);
          rating = isNaN(n) ? null : Math.round(n * 10) / 10; // one decimal
        }
      }
      this.cache.set(cacheKey, { data: rating, timestamp: Date.now() });
      // Persist to disk with timestamp for long-lived caching
      await this._setMetaToDisk(diskKey, { value: rating, ts: Date.now() });
      return rating;
    } catch {
      return null;
    }
  }

  async getPosterUrl(title, year = null, type = 'movie', imdbId = null, tvdbId = null) {
    const diskKey = this._normalizePosterKey({ imdbId, title, year, type });
    const diskHit = this._getPosterFromDisk(diskKey);
    if (diskHit) return diskHit;
    // Prefer OMDb first, then Fanart.tv, then PosterDB
    const poster = await this.getOMDbPoster(title, year, type);
    if (poster) { await this._setPosterToDisk(diskKey, poster); return poster; }
    const fan = await this.getPosterFromFanart(imdbId, tvdbId, type);
    if (fan) { await this._setPosterToDisk(diskKey, fan); return fan; }
    const fallback = await this.getPosterFromPosterDB(imdbId, title, year, type);
    if (fallback) { await this._setPosterToDisk(diskKey, fallback); return fallback; }
    // Do not cache placeholder so we can retry later when keys are provided
    return this.getPlaceholderPoster(title);
  }

  // Fallback: ThePosterDB (optional, requires API key)
  async getPosterFromPosterDB(imdbId = null, title = null, year = null, type = 'movie') {
    try {
      if (!this.posterDBApiKey) return null;
      const cacheKey = this.getCacheKey(`posterdb:${imdbId || title}:${year}:${type}`, 'posterdb');
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (this.isCacheValid(cached.timestamp)) return cached.data;
      }

      const axios = require('axios');
      const params = {};
      if (imdbId) params.imdb_id = imdbId;
      else if (title) params.search = title;
      if (year) params.year = year;
      if (type) params.type = type === 'tv' ? 'show' : 'movie';

      const headers = { 'Authorization': `Bearer ${this.posterDBApiKey}` };
      let resp = await axios.get('https://theposterdb.com/api/assets', { params, headers, timeout: 8000 });
      let data = resp.data;
      let url = null;
      // Try common shapes
      const first = (data && (data.data || data.results || data.assets || data)[0]) || null;
      if (first) {
        url = first.poster || first.poster_url || first.image || first.url || null;
      }
      // If not found and we searched by title, try without year
      if (!url && title && year) {
        const params2 = { search: title, type: params.type };
        resp = await axios.get('https://theposterdb.com/api/assets', { params: params2, headers, timeout: 8000 });
        data = resp.data;
        const first2 = (data && (data.data || data.results || data.assets || data)[0]) || null;
        if (first2) url = first2.poster || first2.poster_url || first2.image || first2.url || null;
      }

      if (url) {
        this.cache.set(cacheKey, { data: url, timestamp: Date.now() });
        return url;
      }
      return null;
    } catch (e) {
      // Silent fallback
      return null;
    }
  }

  // Fetch and cache full Fanart.tv JSON for reuse across poster/background lookups
  async _fetchFanartData(imdbId = null, tvdbId = null, type = 'movie') {
    try {
      // resolve key from secure storage if env not set
      if (!this.fanartApiKey && this.secureStorage) {
        try {
          const def = await this.secureStorage.getApiKey('default', 'fanarttv');
          if (def?.key) this.fanartApiKey = def.key;
        } catch {}
      }
      if (!this.fanartApiKey) return null;

      const idKey = type === 'tv' ? (tvdbId || imdbId || '') : (imdbId || tvdbId || '');
      const cacheKey = this.getCacheKey(`fanart_json:${type}:${idKey}`, 'fanart_json');
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (this.isCacheValid(cached.timestamp)) return cached.data;
      }

      const axios = require('axios');
      let data = null;
      if (type === 'movie' && imdbId) {
        const resp = await axios.get(`https://webservice.fanart.tv/v3/movies/${encodeURIComponent(imdbId)}`, { params: { api_key: this.fanartApiKey }, timeout: 8000 });
        data = resp.data || null;
      } else if (type === 'tv') {
        if (tvdbId) {
          const resp = await axios.get(`https://webservice.fanart.tv/v3/tv/${encodeURIComponent(tvdbId)}`, { params: { api_key: this.fanartApiKey }, timeout: 8000 });
          data = resp.data || null;
        } else if (imdbId) {
          // Fallback when only IMDB is available (Fanart movies endpoint sometimes contains TV as well)
          const resp = await axios.get(`https://webservice.fanart.tv/v3/movies/${encodeURIComponent(imdbId)}`, { params: { api_key: this.fanartApiKey }, timeout: 8000 });
          data = resp.data || null;
        }
      }

      if (data) this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch {
      return null;
    }
  }

  async getPosterFromFanart(imdbId = null, tvdbId = null, type = 'movie') {
    try {
      // resolve key from secure storage if env not set
      if (!this.fanartApiKey && this.secureStorage) {
        try {
          const def = await this.secureStorage.getApiKey('default', 'fanarttv');
          if (def?.key) this.fanartApiKey = def.key;
        } catch {}
      }
      if (!this.fanartApiKey) return null;
      const cacheKey = this.getCacheKey(`fanart:${imdbId || tvdbId}:${type}`, 'fanart');
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (this.isCacheValid(cached.timestamp)) return cached.data;
      }
      let url = null;
      const data = await this._fetchFanartData(imdbId, tvdbId, type);
      if (data) {
        if (type === 'movie') {
          const posters = data.movieposter || [];
          if (Array.isArray(posters) && posters.length) url = posters[0].url;
        } else {
          const posters = data.tvposter || data.hdtvlogo || [];
          if (Array.isArray(posters) && posters.length) url = posters[0].url;
        }
      }
      if (url) {
        this.cache.set(cacheKey, { data: url, timestamp: Date.now() });
        return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Backgrounds (hero) from Fanart.tv
  async getBackgroundFromFanart(imdbId = null, tvdbId = null, type = 'movie') {
    try {
      if (!this.fanartApiKey && this.secureStorage) {
        try {
          const def = await this.secureStorage.getApiKey('default', 'fanarttv');
          if (def?.key) this.fanartApiKey = def.key;
        } catch {}
      }
      if (!this.fanartApiKey) return null;
      const cacheKey = this.getCacheKey(`fanart_bg:${imdbId || tvdbId}:${type}`, 'fanart_bg');
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (this.isCacheValid(cached.timestamp)) return cached.data;
      }
      let url = null;
      const data = await this._fetchFanartData(imdbId, tvdbId, type);
      if (data) {
        if (type === 'movie') {
          // Prefer cinematic backgrounds for hero (not banners)
          const arts = data.moviefanart || data.moviebackground || [];
          if (Array.isArray(arts) && arts.length) url = arts[0].url;
        } else {
          const arts = data.showbackground || data.tvthumb || [];
          if (Array.isArray(arts) && arts.length) url = arts[0].url;
        }
      }
      if (url) {
        this.cache.set(cacheKey, { data: url, timestamp: Date.now() });
        return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getBackgroundUrl(title, year = null, type = 'movie', imdbId = null, tvdbId = null) {
    const diskKey = this._normalizeBackgroundKey({ imdbId, title, year, type });
    const diskHit = this._getPosterFromDisk(diskKey);
    if (diskHit) return diskHit;
    const fan = await this.getBackgroundFromFanart(imdbId, tvdbId, type);
    if (fan) { await this._setPosterToDisk(diskKey, fan); return fan; }
    // fallback to poster as background if needed
    const poster = await this.getPosterUrl(title, year, type, imdbId, tvdbId);
    if (poster) { await this._setPosterToDisk(diskKey, poster); return poster; }
    // Do not cache placeholder backgrounds
    return this.getPlaceholderPoster(title, 1280, 720);
  }

  async enhanceMovieData(movie) {
    try {
      const imdbGuess = movie.imdb || movie.imdbId || (typeof movie.id === 'string' && movie.id.startsWith('tt') ? movie.id : null);
      const [poster, rating] = await Promise.all([
        this.getPosterUrl(movie.title, movie.year, 'movie', imdbGuess),
        this.getOMDbRating({ imdbId: imdbGuess, title: movie.title, year: movie.year, type: 'movie' })
      ]);
      return { ...movie, poster, rating };
    } catch (e) {
      return { ...movie, poster: this.getPlaceholderPoster(movie.title) };
    }
  }

  async enhanceTVShowData(show) {
    try {
      const imdbGuess = show.imdb || show.imdbId || (typeof show.id === 'string' && show.id.startsWith('tt') ? show.id : null);
      const tvdbGuess = show.tvdb || show.tvdbId || (show.ids && show.ids.tvdb) || null;
      const [poster, rating] = await Promise.all([
        this.getPosterUrl(show.title, show.year, 'tv', imdbGuess, tvdbGuess),
        this.getOMDbRating({ imdbId: imdbGuess, title: show.title, year: show.year, type: 'tv' })
      ]);
      return { ...show, poster, rating };
    } catch (e) {
      return { ...show, poster: this.getPlaceholderPoster(show.title) };
    }
  }

  async enhanceMovieBatch(movies) {
    return Promise.all(movies.map(m => this.enhanceMovieData(m)));
  }

  async enhanceTVShowBatch(shows) {
    return Promise.all(shows.map(s => this.enhanceTVShowData(s)));
  }

  // Trakt-based search with Fanart posters
  async searchMedia(query, type = 'movie', maxResults = 20) {
    const traktType = type === 'tv' ? 'show' : 'movie';
    const cacheKey = this.getCacheKey(`traktSearch:${query}:${traktType}:${maxResults}`, 'traktSearch');
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (this.isCacheValid(cached.timestamp)) return cached.data;
    }
    try {
      if (!this.traktClientId) return [];
      const res = await axios.get(`https://api.trakt.tv/search/${traktType}`, {
        params: { query, limit: maxResults },
        headers: { 'trakt-api-version': '2', 'trakt-api-key': this.traktClientId },
        timeout: 8000
      });
      const arr = Array.isArray(res.data) ? res.data : [];
      const normalized = arr.map(item => {
        const m = item.movie || item.show || {};
        const ids = m.ids || {};
        return {
          id: ids.imdb || ids.slug || ids.trakt,
          imdbId: ids.imdb || null,
          tvdb: ids.tvdb || null,
          title: m.title,
          year: m.year,
          type: item.type === 'show' ? 'tv' : 'movie'
        };
      });
      const withPosters = await Promise.all(normalized.map(async it => {
        const poster = await this.getPosterUrl(it.title, it.year, it.type, it.imdbId, it.tvdb);
        const rating = await this.getOMDbRating({ imdbId: it.imdbId, title: it.title, year: it.year, type: it.type });
        return { ...it, poster: poster || this.getPlaceholderPoster(it.title), rating };
      }));
      this.cache.set(cacheKey, { data: withPosters, timestamp: Date.now() });
      return withPosters;
    } catch (e) {
      console.error('Trakt search error:', e.message);
      return [];
    }
  }
}

module.exports = PosterService;
