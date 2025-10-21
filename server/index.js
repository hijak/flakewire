const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Load environment variables
// In Electron, __dirname might be inside ASAR, so try multiple paths
const envPath = path.join(__dirname, '..', '.env');
const envPathAlt = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envPathAlt)) {
  dotenv.config({ path: envPathAlt });
} else {
  dotenv.config(); // fallback to default behavior
}

// Import services
const DebridManager = require('./debrid/debridManager');
const ScraperManager = require('./scrapers/scraperManager');
const NewScraperManager = require('./scrapers/ScraperManager');
const EnhancedScraperManager = require('./scrapers/EnhancedScraperManager');
const SecureStorage = require('./services/secureStorage');
const OAuthService = require('./services/oauthService');
const PosterService = require('./services/imdbService');
const MKVTranscoder = require('./services/mkvTranscoder');

// Import routes
const { router: authRoutes, setDebridManager: setDebridManagerForAuth, setSecureStorage: setSecureStorageForAuth } = require('./routes/auth');
const userRoutes = require('./routes/users');
const searchRoutes = require('./routes/search');
const { router: configRoutes, setDebridManager } = require('./routes/config');
const calendarMod = require('./routes/calendar');

// Initialize services
const secureStorage = new SecureStorage();
const debridManager = new DebridManager();
const scraperManager = new ScraperManager(secureStorage);
const newScraperManager = new NewScraperManager();
const enhancedScraperManager = new EnhancedScraperManager();
const oauthService = new OAuthService();
const posterService = new PosterService(secureStorage);
const mkvTranscoder = new MKVTranscoder();

// Helper function to get user's OMDb API key
async function getUserOmdbApiKey(userId = 'default') {
  try {
    // First try to get user's stored API key
    const keyData = await secureStorage.getApiKey(userId, 'omdb');
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

// Inject debridManager into config routes
setDebridManager(debridManager);
setDebridManagerForAuth(debridManager);
// Inject shared secureStorage into routes so all writes go through one instance
try { setSecureStorageForAuth(secureStorage); } catch {}
try { if (typeof calendarMod.setSecureStorage === 'function') calendarMod.setSecureStorage(secureStorage); } catch {}

const app = express();
let traktReady = false;
let traktReadyError = null;
let traktReadyPromise = null;
const DEFAULT_PORT = parseInt(process.env.PORT || '3001', 10) || 3001;
const DEFAULT_HOST = process.env.HOST || process.env.BIND_HOST || '127.0.0.1';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// JWT Authentication Middleware
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user; // Attach user info to request
    next();
  });
};

// Ensure Trakt token is ready (single-user): try default scope, refresh if expired
async function ensureTraktReady() {
  try {
    traktReadyError = null;
    // Prefer default scope
    const td = await secureStorage.getOAuthToken('default', 'trakt');
    if (td && td.token) {
      const token = td.token;
      const expired = token.expires_at ? (new Date(token.expires_at) <= new Date()) : false;
      if (expired && token.refresh_token) {
        try {
          const newTok = await oauthService.refreshTraktToken(token.refresh_token);
          await secureStorage.storeOAuthToken('default', 'trakt', newTok);
        } catch (e) {
          console.warn('[Trakt] Refresh failed at startup:', e?.message || e);
        }
      }
      traktReady = true;
      return true;
    }
    // If provider marked configured but token not readable yet, wait a bit and retry once
    if (secureStorage.isProviderConfigured('default', 'trakt', 'oauth')) {
      await new Promise(r => setTimeout(r, 300));
      const td2 = await secureStorage.getOAuthToken('default', 'trakt');
      traktReady = Boolean(td2 && td2.token);
      return traktReady;
    }
    traktReady = true; // no trakt configured; don't block UI
    return true;
  } catch (e) {
    traktReadyError = e?.message || String(e);
    traktReady = true; // don't block UI due to error
    return true;
  }
}

function startTraktInit() {
  traktReadyPromise = ensureTraktReady().catch(() => true);
}

startTraktInit();

// Serve static files from built frontend (prefer new Vite dist, fall back to CRA build)
function findStaticRoot() {
  const candidates = [];
  // Repo structure
  candidates.push(path.join(__dirname, '../client/dist'));
  candidates.push(path.join(__dirname, '../client/build'));
  // Current working dir (useful in some packagers)
  candidates.push(path.join(process.cwd(), 'client/build'));
  // Electron resources path (when packaged)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'client/build'));
    candidates.push(path.join(process.resourcesPath, 'client/dist'));
  }
  // Executable directory variants
  try {
    const execDir = path.dirname(process.execPath || '');
    if (execDir) {
      candidates.push(path.join(execDir, 'resources/app/client/build'));
      candidates.push(path.join(execDir, 'resources/app/client/dist'));
    }
  } catch (_) {}

  for (const cand of candidates) {
    try {
      const indexPath = path.join(cand, 'index.html');
      if (fs.existsSync(indexPath)) return cand;
    } catch (_) {}
  }
  return null;
}

let staticRoot = findStaticRoot();
if (staticRoot) {
  console.log('Static root set to:', staticRoot);
  app.use(express.static(staticRoot));
} else {
  console.warn('No static frontend found. If packaged, ensure client/build is included.');
}

// SPA fallback: serve index.html for non-API routes
app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path === '/logo.png') return next();
  try {
    // Wait briefly for Trakt ready on cold start
    if (!traktReady && traktReadyPromise) {
      await Promise.race([
        traktReadyPromise,
        new Promise(r => setTimeout(r, 800))
      ]);
    }
  } catch (_) {}
  if (!staticRoot) {
    return res.status(404).send('Frontend not found. Build the client or check packaging.');
  }
  const indexFile = path.join(staticRoot, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send('Frontend index not found');
  }
});

// API Routes
app.get('/api/health', async (req, res) => {
  // Try to initialize debrid providers if not already available
  if (debridManager.getAvailableProviders().length === 0) {
    try {
      await debridManager.refreshProviders();
    } catch (error) {
      // Silently fail - debrid might be configured later
      console.log('Health check debrid refresh failed:', error.message);
    }
  }

  res.json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    debridProviders: debridManager.getAvailableProviders(),
    scrapers: scraperManager.getAvailableScrapers(),
    scraperStats: newScraperManager.getStats(),
    tokens: {
      traktReady,
      traktReadyError
    },
    features: {
      oauth: true,
      secureStorage: true,
      apiKeyManagement: true,
      enhancedSearch: true
    }
  });
});

// Debug: report trakt storage status (no secrets shown)
app.get('/api/debug/trakt', async (req, res) => {
  try {
    const td = await secureStorage.getOAuthToken('default', 'trakt');
    const configured = secureStorage.isProviderConfigured('default', 'trakt', 'oauth');
    const expired = td?.token?.expires_at ? (new Date(td.token.expires_at) <= new Date()) : null;
    res.json({
      configured,
      hasToken: Boolean(td && td.token),
      expired,
      metadata: td?.metadata || null,
      storageFile: secureStorage.storageFile || null,
      dataDir: secureStorage.dataDir || null,
    });
  } catch (e) {
    res.status(500).json({ error: 'debug_failed', message: e?.message || String(e) });
  }
});

// Video format compatibility endpoint
app.get('/api/video/formats', (req, res) => {
  res.json({
    supportedFormats: {
      mp4: {
        format: 'mp4',
        mimeType: 'video/mp4',
        browserSupport: 'universal',
        codecs: ['h264', 'h265', 'av1'],
        priority: 1,
        recommended: true
      },
      webm: {
        format: 'webm',
        mimeType: 'video/webm',
        browserSupport: 'universal',
        codecs: ['vp8', 'vp9', 'av1'],
        priority: 2,
        recommended: true
      },
      m4v: {
        format: 'm4v',
        mimeType: 'video/x-m4v',
        browserSupport: 'good',
        codecs: ['h264'],
        priority: 3,
        recommended: true
      },
      avi: {
        format: 'avi',
        mimeType: 'video/x-msvideo',
        browserSupport: 'limited',
        codecs: ['divx', 'xvid', 'h264'],
        priority: 4,
        recommended: false,
        issues: ['Limited codec support in browsers', 'May require external player']
      },
      mkv: {
        format: 'mkv',
        mimeType: 'video/x-matroska',
        browserSupport: 'direct',
        codecs: ['h264', 'h265', 'vp9', 'av1'],
        priority: 5,
        recommended: true,
        notes: 'Direct streaming with enhanced player support',
        features: [
          'Direct streaming via enhanced video player',
          'Multiple codec support (H.264, H.265, VP9, AV1)',
          'Subtitle and multiple audio track support',
          'Chapter navigation support'
        ],
        playerCompatibility: {
          'Native': 'Some browsers support MKV natively',
          'Enhanced': 'Custom player with codec detection',
          'External': 'Download for VLC, MPC-HC, etc.'
        }
      },
      mov: {
        format: 'mov',
        mimeType: 'video/quicktime',
        browserSupport: 'fair',
        codecs: ['h264', 'hevc'],
        priority: 6,
        recommended: false,
        issues: ['Apple format, limited cross-browser support']
      }
    },
    browserCompatibility: {
      chrome: { mp4: true, webm: true, m4v: true, avi: false, mkv: 'enhanced', mov: true },
      firefox: { mp4: true, webm: true, m4v: true, avi: false, mkv: 'enhanced', mov: true },
      safari: { mp4: true, webm: true, m4v: true, avi: false, mkv: 'limited', mov: true },
      edge: { mp4: true, webm: true, m4v: true, avi: false, mkv: 'enhanced', mov: true }
    },
    recommendations: {
      primary: 'mp4',
      fallback: 'webm',
      mkvSupport: 'direct-streaming-with-enhanced-player',
      notes: 'MKV files now supported via direct streaming with enhanced player capabilities'
    }
  });
});

// Notifications based on Trakt calendars (new episodes and premieres)
app.get('/api/notifications', async (req, res) => {
  try {
    const userId = getOptionalUserId(req);
    const refresh = String(req.query.refresh || 'false') === 'true';

    if (!refresh) {
      const cached = notificationsCache.get(userId);
      if (cached && (Date.now() - cached.ts) < NOTIFICATIONS_TTL) {
        return res.json(cached.data);
      }
    }

    // Determine Trakt scope
    const userHas = secureStorage.isProviderConfigured(userId, 'trakt', 'oauth') && !secureStorage.isTokenExpired(userId, 'trakt');
    const defHas = secureStorage.isProviderConfigured('default', 'trakt', 'oauth') && !secureStorage.isTokenExpired('default', 'trakt');
    const scope = userHas ? userId : (defHas ? 'default' : null);
    if (!scope) return res.json({ notifications: [], source: 'no_trakt', timestamp: new Date().toISOString() });

    const tokenData = await secureStorage.getOAuthToken(scope, 'trakt');

    // From 7 days ago to 14 days ahead
    const now = new Date();
    const start = new Date(now.getTime() - 7*24*60*60*1000);
    const days = 21;
    const startStr = formatDateYYYYMMDD(start);

    const [shows, premieres] = await Promise.all([
      oauthService.makeTraktRequest(`/calendars/my/shows/${startStr}/${days}`, tokenData.token.access_token).catch(() => []),
      oauthService.makeTraktRequest(`/calendars/my/shows/premieres/${startStr}/${days}`, tokenData.token.access_token).catch(() => [])
    ]);

    const notifications = [];
    const seen = new Set();
    const pushItem = async (item, kind) => {
      try {
        const show = item?.show || {};
        const ep = item?.episode || {};
        const ids = show?.ids || {};
        const epIds = ep?.ids || {};
        const key = `${kind}:${ids.imdb || ids.slug || ids.trakt}:${ep.season || 0}:${ep.number || 0}:${item.first_aired || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        const poster = await posterService.getPosterUrl(show.title || '', show.year || null, 'tv', ids.imdb || null, ids.tvdb || null);
        notifications.push({
          id: key,
          type: kind,
          title: kind === 'premiere' ? 'New series premiere' : 'New episode',
          message: kind === 'premiere' ? `${show.title || ''} — ${ep.title || ''}` : `${show.title || ''} S${String(ep.season || 0).padStart(2,'0')}E${String(ep.number || 0).padStart(2,'0')} — ${ep.title || ''}`,
          aired: item.first_aired || null,
          show: { imdbId: ids.imdb || null, tvdbId: ids.tvdb || null, title: show.title || '' },
          episode: { imdbId: epIds.imdb || null, season: ep.season || null, number: ep.number || null, title: ep.title || '' },
          poster
        });
      } catch {}
    };

    const limitEpisodes = Array.isArray(shows) ? shows.slice(0, 20) : [];
    for (const it of limitEpisodes) {
      // eslint-disable-next-line no-await-in-loop
      await pushItem(it, 'episode');
    }
    const limitPremieres = Array.isArray(premieres) ? premieres.slice(0, 10) : [];
    for (const it of limitPremieres) {
      // eslint-disable-next-line no-await-in-loop
      await pushItem(it, 'premiere');
    }

    notifications.sort((a,b) => new Date(b.aired || 0).getTime() - new Date(a.aired || 0).getTime());
    const payload = { notifications, source: 'trakt_calendars', timestamp: new Date().toISOString() };
    notificationsCache.set(userId, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (e) {
    console.error('Notifications error:', e.message);
    res.status(500).json({ error: 'Failed to load notifications', message: e.message });
  }
});

// Mount authentication and user routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Mount search routes
app.use('/api/search', searchRoutes);

// Mount calendar routes
app.use('/api/calendar', calendarMod.router || calendarMod);

// Serve app logo from project root if present (used by UI spinner/header)
app.get('/logo.png', (req, res) => {
  try {
    const p = path.join(__dirname, '../logo.png');
    if (fs.existsSync(p)) return res.sendFile(p);
    // Not found — return 404 so the client can fallback if needed
    return res.status(404).end();
  } catch (e) {
    return res.status(404).end();
  }
});

// OAuth browser callback landing page (handles external browser flow)
app.get('/auth/callback', (req, res) => {
  try {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authentication</title>
  <style>
    body { background:#121212; color:#eee; font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
    .card { background:#1f1f1f; padding:24px; border-radius:8px; width: min(520px, 92vw); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { margin: 0 0 8px 0; font-size: 20px; color: #fff; }
    p { margin: 8px 0; color: #ccc; }
    .ok { color: #4caf50; }
    .err { color: #e53935; }
    .small { font-size: 12px; color:#aaa; }
    button { margin-top: 12px; background:#e50914; color:#fff; border:none; border-radius:4px; padding:8px 12px; cursor:pointer; }
  </style>
  <script>
    async function complete() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const err = params.get('error');
      const out = document.getElementById('out');
      const btn = document.getElementById('btn');
      if (err) {
        out.innerHTML = '<p class="err">Authentication failed: ' + err + '</p>';
        btn.style.display='inline-block';
        return;
      }
      if (!code || !state) {
        out.innerHTML = '<p class="err">Missing OAuth parameters.</p>';
        btn.style.display='inline-block';
        return;
      }
      try {
        const resp = await fetch('/api/auth/oauth/trakt/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          out.innerHTML = '<p class="ok">Trakt authentication successful.</p><p class="small">You can close this window and return to the app.</p>';
          setTimeout(() => { window.close(); }, 1200);
        } else {
          out.innerHTML = '<p class="err">Failed to complete authentication: ' + (data.error || resp.statusText) + '</p>';
          btn.style.display='inline-block';
        }
      } catch (e) {
        out.innerHTML = '<p class="err">Network error: ' + (e && e.message ? e.message : e) + '</p>';
        btn.style.display='inline-block';
      }
    }
    window.addEventListener('DOMContentLoaded', complete);
  </script>
</head>
<body>
  <div class="card">
    <h1>Finishing sign-in…</h1>
    <div id="out"><p>Please wait while we complete authentication.</p></div>
    <button id="btn" onclick="window.close()" style="display:none">Close</button>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('OAuth callback handler failed');
  }
});

// Maintenance: clear caches and optionally remove configuration
app.post('/api/maintenance/clear', async (req, res) => {
  try {
    const body = req.body || {};
    const images = body.images !== false; // default true
    const transcoded = body.transcoded !== false; // default true
    const metadata = body.metadata !== false; // default true
    const remove = body.remove || {}; // { trakt, alldebrid, omdb, fanarttv }

    const result = { imagesCleared: false, transcodedCleared: false, metadataCleared: false, removed: {} };

    const fs = require('fs');
    const fsp = require('fs').promises;
    const path = require('path');

    // Clear artwork/background cache
    if (images) {
      try {
        if (posterService && posterService.cache) posterService.cache.clear();
      } catch {}
      try {
        if (posterService && posterService.diskCachePath) {
          await fsp.writeFile(posterService.diskCachePath, JSON.stringify({}, null, 2));
          result.imagesCleared = true;
        }
      } catch (e) {
        console.warn('Failed to clear posters disk cache:', e.message);
      }
    }

    // Clear transcoded/remux cache directory
    if (transcoded) {
      try {
        if (typeof mkvTranscoder?.cleanup === 'function') {
          await mkvTranscoder.cleanup();
        }
      } catch {}
      try {
        const dir = mkvTranscoder?.outputDir;
        if (dir && fs.existsSync(dir)) {
          await fsp.rm(dir, { recursive: true, force: true });
          await fsp.mkdir(dir, { recursive: true });
        }
        result.transcodedCleared = true;
      } catch (e) {
        console.warn('Failed to clear transcoded dir:', e.message);
      }
    }

    // Clear in-memory TV metadata caches
    if (metadata) {
      try { tvSeasonsCache.clear(); } catch {}
      try { tvSeasonEpisodesCache.clear(); } catch {}
      try { tvEpisodeDetailCache.clear(); } catch {}
      result.metadataCleared = true;
    }

    // Remove configurations
    const removeProvider = async (p) => {
      try { await secureStorage.deleteApiKey('default', p); } catch {}
    };
    const removeOAuth = async (p) => {
      try { await secureStorage.deleteOAuthToken('default', p); } catch {}
    };
    if (remove.trakt) {
      await removeOAuth('trakt');
      result.removed.trakt = true;
    }
    if (remove.alldebrid) {
      await removeOAuth('alldebrid');
      await removeProvider('alldebrid');
      try { await debridManager.refreshProviders(); } catch {}
      result.removed.alldebrid = true;
    }
    if (remove.omdb) {
      await removeProvider('omdb');
      result.removed.omdb = true;
    }
    if (remove.fanarttv) {
      await removeProvider('fanarttv');
      result.removed.fanarttv = true;
    }

    res.json({ success: true, ...result });
  } catch (e) {
    console.error('Maintenance clear error:', e);
    res.status(500).json({ error: 'Failed to clear', message: e.message });
  }
});

// Public API key management (default scope) for desktop app without login
app.get('/api/public/api-keys/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    // Check secure storage 'default' scope, then env
    const key = await secureStorage.getApiKey('default', provider);
    if (key) return res.json({ provider, configured: true, source: 'storage', metadata: key.metadata });
    const envMap = {
      omdb: process.env.OMDB_API_KEY,
      fanarttv: process.env.FANART_API_KEY || process.env.FANARTTV_API_KEY,
    };
    const envKey = envMap[provider];
    if (envKey) return res.json({ provider, configured: true, source: 'env' });
    return res.status(404).json({ error: 'Not configured' });
  } catch (e) {
    console.error('Public API key get error:', e.message);
    res.status(500).json({ error: 'Failed to get key' });
  }
});

app.post('/api/public/api-keys/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const { apiKey } = req.body || {};
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'Valid apiKey required' });
    }
    const okProviders = new Set(['omdb', 'fanarttv', 'alldebrid']);
    if (!okProviders.has(provider)) return res.status(400).json({ error: 'Unsupported provider' });
    await secureStorage.storeApiKey('default', provider, apiKey.trim(), { source: 'public' });
    // Side-effects: refresh providers for alldebrid
    try { if (provider === 'alldebrid') await debridManager.refreshProviders(); } catch {}
    res.json({ success: true });
  } catch (e) {
    console.error('Public API key save error:', e.message);
    res.status(500).json({ error: 'Failed to save key' });
  }
});

// Debug endpoint for API keys (no auth required)
app.get('/api/debug/api-keys', async (req, res) => {
  try {
    const provider = req.query.provider || 'alldebrid';
    const keys = secureStorage.listAllApiKeys(provider);
    res.json({
      provider,
      storedKeys: keys,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Debug API keys error:', error);
    res.status(500).json({ error: 'Failed to get debug info' });
  }
});

// Mount protected configuration routes
app.use('/api/config', authenticateToken, configRoutes);

// Media routes
app.get('/api/movies', async (req, res) => {
  try {
    // Mock data for MVP with real posters from IMDB
    const movies = [
      {
        id: 1,
        title: "Inception",
        year: 2010,
        description: "A thief who steals corporate secrets through dream-sharing technology",
        type: "movie"
      },
      {
        id: 2,
        title: "The Dark Knight",
        year: 2008,
        description: "Batman must accept one of the greatest psychological and physical tests",
        type: "movie"
      }
    ];

    // Enhance movies with poster URLs
    const enhancedMovies = await posterService.enhanceMovieBatch(movies);
    res.json(enhancedMovies);
  } catch (error) {
    console.error('Failed to fetch movies:', error);
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

app.get('/api/tv-shows', async (req, res) => {
  try {
    // Mock data for MVP with real posters from IMDB
    const tvShows = [
      {
        id: 1,
        title: "Breaking Bad",
        year: 2008,
        description: "A high school chemistry teacher turned methamphetamine cook",
        type: "tv",
        seasons: 5
      },
      {
        id: 2,
        title: "Stranger Things",
        year: 2016,
        description: "When a young boy disappears, his mother and friends uncover supernatural mysteries",
        type: "tv",
        seasons: 4
      }
    ];

    // Enhance TV shows with poster URLs
    const enhancedTVShows = await posterService.enhanceTVShowBatch(tvShows);
    res.json(enhancedTVShows);
  } catch (error) {
    console.error('Failed to fetch TV shows:', error);
    res.status(500).json({ error: 'Failed to fetch TV shows' });
  }
});

// TV metadata: seasons and episodes via Trakt (OMDb fallback)
app.get('/api/tv/:imdbId/seasons', async (req, res) => {
  try {
    const { imdbId } = req.params;

    if (!imdbId || !/^tt\d+$/.test(imdbId)) {
      return res.status(400).json({ error: 'Invalid IMDB ID', message: 'IMDB ID must be in format tt1234567' });
    }

    // Cache check
    const cacheKey = imdbId;
    const cached = tvSeasonsCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TV_EP_CACHE_TTL) {
      return res.json(cached.data);
    }

    let totalSeasons = 1; let showTitle = ''; let showYear = null; let overview = ''; let poster = null; let tvdbId = null;
    try {
      const show = await oauthService.makeTraktRequest(`/shows/${imdbId}`, null, { extended: 'full' });
      const seasonsArr = await oauthService.makeTraktRequest(`/shows/${imdbId}/seasons`, null, {});
      const nums = Array.isArray(seasonsArr) ? seasonsArr.map(s => s.number).filter(n => n > 0) : [];
      totalSeasons = nums.length || show?.aired_seasons || 1;
      showTitle = show?.title || '';
      showYear = show?.year || null;
      overview = show?.overview || '';
      tvdbId = show?.ids?.tvdb || null;
      try {
        poster = await posterService.getBackgroundUrl(showTitle, showYear, 'tv', imdbId, tvdbId);
      } catch {}
    } catch (e) {
      // fallback to OMDb quick check
      try {
        const axios = require('axios');
        const omdbApiKey = await getUserOmdbApiKey();
        const seriesResp = await axios.get('https://www.omdbapi.com/', { params: { apikey: omdbApiKey, i: imdbId }, timeout: 5000 });
        const series = seriesResp.data;
        if (series && series.Response === 'True') { totalSeasons = parseInt(series.totalSeasons) || 1; showTitle = series.Title || ''; overview = series.Plot || ''; poster = series.Poster && series.Poster !== 'N/A' ? series.Poster : null; showYear = parseInt(series.Year) || null; }
      } catch {}
    }
    const payload = { imdbId, title: showTitle, year: showYear, overview, poster, totalSeasons, timestamp: new Date().toISOString() };
    tvSeasonsCache.set(cacheKey, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (error) {
    console.error('TV seasons API error:', error);
    res.status(500).json({ error: 'Failed to load seasons', message: error.message });
  }
});

// Single season episodes
app.get('/api/tv/:imdbId/season/:season', async (req, res) => {
  try {
    const { imdbId, season } = req.params;
    const s = parseInt(season);
    if (!imdbId || !/^tt\d+$/.test(imdbId) || !s || s < 1) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    const cacheKey = `${imdbId}:${s}`;
    const cached = tvSeasonEpisodesCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TV_EP_CACHE_TTL) {
      return res.json(cached.data);
    }
    let episodes = [];
    try {
      const seasonData = await oauthService.makeTraktRequest(`/shows/${imdbId}/seasons/${s}`, null, { extended: 'full' });
      if (!Array.isArray(seasonData)) return res.status(404).json({ error: 'Season not found' });
      episodes = seasonData.map(ep => ({ episode: ep.number, title: ep.title, released: ep.first_aired || null, imdbID: ep.ids?.imdb || null, imdbRating: ep.rating || null }));
    } catch (e) {
      // fallback no episodes
      episodes = [];
    }
    const payload = { imdbId, season: s, episodes, timestamp: new Date().toISOString() };
    tvSeasonEpisodesCache.set(cacheKey, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (error) {
    console.error('TV season API error:', error);
    res.status(500).json({ error: 'Failed to load season', message: error.message });
  }
});

// Episode details (plot, runtime, poster)
app.get('/api/tv/:imdbId/season/:season/episode/:episode', async (req, res) => {
  try {
    const { imdbId, season, episode } = req.params;
    const s = parseInt(season);
    const e = parseInt(episode);
    if (!imdbId || !/^tt\d+$/.test(imdbId) || !s || !e) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    const cacheKey = `${imdbId}:${s}:${e}`;
    const cached = tvEpisodeDetailCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TV_EP_CACHE_TTL) {
      return res.json(cached.data);
    }
    const ep = await oauthService.makeTraktRequest(`/shows/${imdbId}/seasons/${s}/episodes/${e}`, null, { extended: 'full' });
    if (!ep || !ep.title) return res.status(404).json({ error: 'Episode not found' });
    const payload = {
      imdbId,
      season: s,
      episode: e,
      title: ep.title,
      plot: ep.overview || '',
      poster: null,
      released: ep.first_aired || null,
      runtime: ep.runtime || null,
      imdbRating: ep.rating || null,
      imdbID: ep.ids?.imdb || null
    };
    tvEpisodeDetailCache.set(cacheKey, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (error) {
    console.error('TV episode details API error:', error);
    res.status(500).json({ error: 'Failed to load episode details', message: error.message });
  }
});

// Test endpoint to verify backend is responding
app.get('/api/test', (req, res) => {
  console.log('DEBUG: Test endpoint called');
  res.json({ message: 'Backend is working', timestamp: new Date().toISOString() });
});

// Streaming proxy endpoint for debrid links
app.get('/api/stream/:url(*)', async (req, res) => {
  try {
    const { url } = req.params;

    if (!url) {
      return res.status(400).json({ error: 'Missing streaming URL' });
    }

    // Decode the URL (it might be encoded)
    let streamingUrl;
    try {
      streamingUrl = decodeURIComponent(url);
    } catch {
      streamingUrl = url;
    }

    // Validate that this is a debrid domain
    const allowedDomains = [
      'alldebrid.com',
      'debrid.it',
      'alldebrid.fr',
      'xp9khl.debrid.it', // Add the specific subdomain from the error
      'k7l8m9.debrid.it'   // Add other subdomains if needed
    ];

    try {
      const urlObj = new URL(streamingUrl);
      if (!allowedDomains.some(domain => urlObj.hostname.includes(domain))) {
        return res.status(403).json({ error: 'Domain not allowed for streaming' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid streaming URL' });
    }

    // Set proper headers for streaming
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Set referrer policy to allow cross-origin requests
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    console.log(`Proxying streaming request to: ${streamingUrl}`);

    // Use axios to stream the content
    const axios = require('axios');

    const response = await axios({
      method: 'get',
      url: streamingUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://alldebrid.com/',
        'Origin': 'https://alldebrid.com',
        ...(req.headers['range'] ? { Range: req.headers['range'] } : {}),
        ...(req.headers['accept'] ? { Accept: req.headers['accept'] } : {})
      },
      timeout: 30000
    });

    // Copy response headers
    let contentType = response.headers['content-type'];
    const contentLength = response.headers['content-length'];
    const contentDisposition = response.headers['content-disposition'];
    const acceptRanges = response.headers['accept-ranges'];
    const contentRange = response.headers['content-range'];

    // Fix content type for video files
    if (!contentType || contentType === 'application/octet-stream') {
      const urlObj = new URL(streamingUrl);
      const pathname = urlObj.pathname.toLowerCase();

      if (pathname.endsWith('.mp4')) {
        contentType = 'video/mp4';
      } else if (pathname.endsWith('.mkv')) {
        contentType = 'video/x-matroska';
        // Enhanced MKV streaming headers
        res.setHeader('X-Video-Format', 'mkv');
        res.setHeader('X-Video-Container', 'matroska');
        res.setHeader('X-MKV-Support', 'direct-streaming');
        res.setHeader('X-Enhanced-Player', 'required');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        console.log(`MKV direct streaming enabled for ${pathname}`);
      } else if (pathname.endsWith('.webm')) {
        contentType = 'video/webm';
      } else if (pathname.endsWith('.avi')) {
        contentType = 'video/x-msvideo';
        // Add AVI compatibility headers
        res.setHeader('X-Video-Format', 'avi');
        res.setHeader('X-Codec-Warning', 'AVI may not be supported in all browsers');
        res.setHeader('X-Recommended-Action', 'Use MP4 format if available for better compatibility');
        console.log(`AVI file detected. Browser support varies. Adding compatibility headers for ${pathname}`);
      } else if (pathname.endsWith('.mov')) {
        contentType = 'video/quicktime';
      } else if (pathname.endsWith('.m4v')) {
        contentType = 'video/x-m4v';
      } else {
        // Default to mp4 for unknown video types
        contentType = 'video/mp4';
      }

      console.log(`Detected video type: ${contentType} for ${pathname}`);
    }

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    // Mirror upstream status (e.g., 206 Partial Content when ranged)
    res.status(response.status || 200);

    // For HEAD requests, send headers only
    if (req.method === 'HEAD') {
      return res.end();
    }

    // Stream the response
    response.data.pipe(res);

  } catch (error) {
    console.error('Streaming proxy error:', error.message);
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      res.status(502).json({ error: 'Unable to connect to streaming server' });
    } else if (error.code === 'ECONNRESET') {
      res.status(504).json({ error: 'Streaming connection reset' });
    } else {
      res.status(500).json({ error: 'Streaming failed', message: error.message });
    }
  }
});

// MKV Transcoding endpoints
app.get('/api/transcoded/:sessionId/playlist.m3u8', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const playlistPath = require('path').join(mkvTranscoder.outputDir, sessionId, 'playlist.m3u8');

    // Check if playlist exists
    const fs = require('fs');
    if (!fs.existsSync(playlistPath)) {
      // Check transcoding status
      const status = mkvTranscoder.getTranscodingStatus(sessionId);
      if (status && status.status === 'transcoding') {
        res.setHeader('Content-Type', 'application/json');
        return res.json({
          status: 'transcoding',
          progress: status.progress,
          message: 'Transcoding in progress...'
        });
      } else if (status && status.status === 'failed') {
        return res.status(500).json({
          status: 'failed',
          error: status.error || 'Transcoding failed'
        });
      } else {
        return res.status(404).json({
          status: 'not_found',
          message: 'Transcoded file not found'
        });
      }
    }

    // Serve the HLS playlist
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');

    // Handle range requests for HLS
    if (req.headers.range) {
      res.setHeader('Content-Range', req.headers.range);
      res.status(206);
    } else {
      res.status(200);
    }

    const fileStream = fs.createReadStream(playlistPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Transcoded playlist error:', error);
    res.status(500).json({ error: 'Failed to serve transcoded playlist' });
  }
});

app.get('/api/transcoded/:sessionId/segment:segmentNumber.ts', async (req, res) => {
  try {
    const { sessionId, segmentNumber } = req.params;
    const segmentPath = require('path').join(mkvTranscoder.outputDir, sessionId, `segment${segmentNumber}.ts`);

    const fs = require('fs');
    if (!fs.existsSync(segmentPath)) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    // Get segment file stats
    const stats = fs.statSync(segmentPath);
    const fileSize = stats.size;

    // Handle range requests for video segments
    if (req.headers.range) {
      const range = req.headers.range;
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      res.setHeader('Content-Type', 'video/MP2T');
      res.status(206);

      const fileStream = fs.createReadStream(segmentPath, { start, end });
      fileStream.pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', 'video/MP2T');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(200);

      const fileStream = fs.createReadStream(segmentPath);
      fileStream.pipe(res);
    }

  } catch (error) {
    console.error('Transcoded segment error:', error);
    res.status(500).json({ error: 'Failed to serve transcoded segment' });
  }
});

app.get('/api/transcoded/:sessionId/status', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = mkvTranscoder.getTranscodingStatus(sessionId);

    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(status);
  } catch (error) {
    console.error('Transcoding status error:', error);
    res.status(500).json({ error: 'Failed to get transcoding status' });
  }
});

// MKV Fast Remuxing endpoints
app.get('/api/remuxed/:sessionId/output.mp4', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const outputPath = require('path').join(mkvTranscoder.outputDir, sessionId, 'output.mp4');

    // Check if remuxed file exists
    const fs = require('fs');
    if (!fs.existsSync(outputPath)) {
      // Check remuxing status
      const status = mkvTranscoder.getTranscodingStatus(sessionId);
      if (status && status.status === 'remuxing') {
        res.setHeader('Content-Type', 'application/json');
        return res.json({
          status: 'remuxing',
          progress: status.progress,
          message: 'Fast remuxing MKV to MP4...'
        });
      } else if (status && status.status === 'completed') {
        res.setHeader('Content-Type', 'application/json');
        return res.json({
          status: 'completed',
          progress: 100,
          url: status.outputUrl || `/api/remuxed/${sessionId}/output.mp4`
        });
      } else if (status && status.status === 'failed') {
        return res.status(500).json({
          status: 'failed',
          error: status.error || 'Remuxing failed'
        });
      } else {
        return res.status(404).json({
          status: 'not_found',
          message: 'Remuxed file not found'
        });
      }
    }

    // Get file stats
    const stats = fs.statSync(outputPath);
    const fileSize = stats.size;

    // Handle range requests for video seeking
    if (req.headers.range) {
      const range = req.headers.range;
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(206);

      const fileStream = fs.createReadStream(outputPath, { start, end });
      fileStream.pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.status(200);

      const fileStream = fs.createReadStream(outputPath);
      fileStream.pipe(res);
    }

  } catch (error) {
    console.error('Remuxed file error:', error);
    res.status(500).json({ error: 'Failed to serve remuxed file' });
  }
});

app.get('/api/remuxed/:sessionId/status', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = mkvTranscoder.getTranscodingStatus(sessionId);

    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(status);
  } catch (error) {
    console.error('Remuxing status error:', error);
    res.status(500).json({ error: 'Failed to get remuxing status' });
  }
});

// Sources scraping route (scrape torrents/direct links for a media by OMDb/IMDB id)
app.get('/api/sources/:type/:imdbId', async (req, res) => {
  console.log(`*** SOURCES ENDPOINT CALLED FOR ${req.params.type}/${req.params.imdbId} ***`);
  try {
    const { type, imdbId } = req.params;
    const omdbApiKey = await getUserOmdbApiKey();
    const season = req.query.season ? parseInt(req.query.season) : null;
    const episode = req.query.episode ? parseInt(req.query.episode) : null;

    if (!/^tt\d+$/.test(imdbId)) {
      return res.status(400).json({ error: 'Invalid IMDB ID format' });
    }

    // Pull title/year from Trakt (fallback to OMDb if needed)
    let title = null; let year = null;
    try {
      if (type === 'movie') {
        const m = await oauthService.makeTraktRequest(`/movies/${imdbId}`, null, {});
        title = m?.title || null; year = m?.year || null;
      } else {
        const s = await oauthService.makeTraktRequest(`/shows/${imdbId}`, null, {});
        title = s?.title || null; year = s?.year || null;
      }
    } catch {}
    if (!title) {
      try {
        const axios = require('axios');
        const omdbResp = await axios.get('https://www.omdbapi.com/', { params: { apikey: omdbApiKey, i: imdbId }, timeout: 5000 });
        const omdb = omdbResp.data; if (omdb && omdb.Response === 'True') { title = omdb.Title; year = parseInt(omdb.Year) || null; }
      } catch {}
    }
    if (!title) return res.status(404).json({ error: 'Title not found' });

    // Search for sources using enhanced manager (torrents, etc.)
    const results = await enhancedScraperManager.search({ title, year, type, imdb: imdbId, season, episode }, {
      quality: null,
      minSeeders: 0,
      language: 'en',
      maxResults: 50
    });

    console.log(`DEBUG: Sources endpoint found ${results.length} raw results for ${title}`);

    // Normalize response for client
    let sources = results.map((r, idx) => ({
      id: r.hash || r.url || `${r.provider}-${idx}`,
      name: r.name,
      provider: r.provider,
      quality: r.quality,
      seeders: r.seeders || 0,
      size: r.size || 0,
      type: r.type,
      url: r.url, // magnet or direct
      requiresDebrid: !!r.debridonly,
      hash: r.hash || null
    }));

    // Annotate AllDebrid instant availability for magnet hashes
    try {
      const dp = debridManager.getProvider('alldebrid');
      const instantCandidates = sources
        .filter(s => s.hash)
        .slice(0, 20) // limit checks
        .map(s => `magnet:?xt=urn:btih:${s.hash}`);
      if (dp && instantCandidates.length) {
        const checks = await dp.checkInstant(instantCandidates);
        const instantMap = new Map();
        for (const item of checks) {
          // item.magnet may be the normalized magnet string; map by hash when possible
          const m = item.magnet || '';
          const hashMatch = m.match(/btih:([A-Fa-f0-9]{40})/);
          if (hashMatch) instantMap.set(hashMatch[1].toLowerCase(), !!item.instant);
        }
        sources = sources.map(s => ({
          ...s,
          instant: s.hash ? !!instantMap.get((s.hash || '').toLowerCase()) : false
        }));
        // Prefer instant sources first
        sources.sort((a, b) => (b.instant === a.instant) ? 0 : (b.instant ? 1 : -1));
      }
    } catch (e) {
      console.warn('Instant availability annotate failed:', e.message);
    }

    // Only show cached torrents (instant) for debrid-required sources; keep direct links
    // Note: Removed instant availability filter to show all torrents
    // sources = sources.filter(s => {
    //   const isTorrent = s.requiresDebrid || (s.url || '').startsWith('magnet:');
    //   return isTorrent ? s.instant === true : true;
    // });

    console.log(`DEBUG: Returning ${sources.length} sources for ${title}`);
    res.json({
      imdbId,
      type,
      title,
      year,
      season: season || undefined,
      episode: episode || undefined,
      sources,
      count: sources.length,
      debug: {
        resultsCount: results.length,
        firstResult: results[0] || null,
        hasResults: results.length > 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sources fetch error:', error);
    res.status(500).json({ error: 'Failed to scrape sources', message: error.message });
  }
});

// Debrid resolution route: convert magnet/direct to a playable/downloadable URL
app.post('/api/debrid/resolve', async (req, res) => {
  try {
    const { link, provider = 'alldebrid', prefer = 'video' } = req.body || {};

    if (!link) {
      return res.status(400).json({ error: 'Missing link to resolve' });
    }

    // If link is already direct (http/https), return it as-is
    if (/^https?:\/\//i.test(link)) {
      return res.json({ directUrl: link, provider: 'direct', status: 'ok' });
    }

    // Get debrid provider
    let dp = debridManager.getProvider(provider);
    if (!dp) {
      // Attempt to initialize providers on-demand
      try {
        await debridManager.refreshProviders();
        dp = debridManager.getProvider(provider);
      } catch (e) {
        console.error('Debrid refresh failed:', e.message);
      }
      if (!dp) {
        return res.status(503).json({ error: 'Debrid provider not configured', provider });
      }
    }

    // Add magnet and return immediately to allow client-side polling
    const addResp = await dp.addMagnet(link);
    const torrentId = addResp?.id || addResp?.torrent?.id || addResp?.hash || addResp?.magnet?.id || addResp?.magnets?.[0]?.id;
    if (!torrentId) {
      return res.status(500).json({ error: 'Failed to add magnet to debrid' });
    }

    // Try a quick readiness check once; otherwise instruct client to poll
    try {
      const info = await dp.getTorrentInfo(torrentId);
      const magnetInfo = Array.isArray(info?.magnets) ? info.magnets[0] : (info?.magnets || info);
      const linksArr = [];
      if (Array.isArray(magnetInfo?.links)) linksArr.push(...magnetInfo.links);
      if (Array.isArray(info?.links)) linksArr.push(...info.links);
      if (Array.isArray(info?.data?.links)) linksArr.push(...info.data.links);
      if (linksArr.length > 0) {
        const videoExts = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'];
        const maxTry = Math.min(linksArr.length, 20);
        const getName = (item, url) => {
          const name = item?.filename || item?.name || item?.file || '';
          if (name) return String(name).toLowerCase();
          try {
            const u = new URL(url);
            return decodeURIComponent(u.pathname.split('/').pop() || '').toLowerCase();
          } catch { return String(url).toLowerCase(); }
        };

        if (prefer === 'video') {
          // Prioritize browser-friendly formats (MP4, WebM, M4V) over MKV
          const sortedLinks = linksArr.slice(0, maxTry).sort((a, b) => {
            const aLink = typeof a === 'string' ? a : (a.link || a.url || a.download || '');
            const bLink = typeof b === 'string' ? b : (b.link || b.url || b.download || '');
            const aName = getName(a, aLink).toLowerCase();
            const bName = getName(b, bLink).toLowerCase();

            // MP4 files get highest priority
            if (aName.endsWith('.mp4') && !bName.endsWith('.mp4')) return -1;
            if (!aName.endsWith('.mp4') && bName.endsWith('.mp4')) return 1;

            // WebM files get second priority
            if (aName.endsWith('.webm') && !bName.endsWith('.webm')) return -1;
            if (!aName.endsWith('.webm') && bName.endsWith('.webm')) return 1;

            // M4V files get third priority
            if (aName.endsWith('.m4v') && !bName.endsWith('.m4v')) return -1;
            if (!aName.endsWith('.m4v') && bName.endsWith('.m4v')) return 1;

            // AVI files get fourth priority (more support than MKV)
            if (aName.endsWith('.avi') && !bName.endsWith('.avi')) return -1;
            if (!aName.endsWith('.avi') && bName.endsWith('.avi')) return 1;

            // MOV files get fifth priority
            if (aName.endsWith('.mov') && !bName.endsWith('.mov')) return -1;
            if (!aName.endsWith('.mov') && bName.endsWith('.mov')) return 1;

            return 0;
          });

          for (let i = 0; i < sortedLinks.length; i++) {
            const item = sortedLinks[i] || {};
            const originalLink = typeof item === 'string' ? item : (item.link || item.url || item.download || item);
            const fname = getName(item, originalLink);
            if (videoExts.some(ext => fname.endsWith(ext))) {
              const isBrowserFriendly = fname.endsWith('.mp4') || fname.endsWith('.webm') || fname.endsWith('.m4v');

              try {
                const unrestricted = await dp.unrestrictLink(originalLink);
                const directUrl = unrestricted?.download || unrestricted?.streaming || unrestricted?.link || originalLink;

                // Return proxied URL to avoid CORS issues
                const proxiedUrl = `/api/stream/${encodeURIComponent(directUrl)}`;
                // Build an internal absolute URL for ffmpeg that is reachable from this process
                const portForInternal = process.env.ACTUAL_PORT || process.env.PORT || DEFAULT_PORT;
                const hostForInternal = process.env.ACTUAL_HOST || '127.0.0.1';
                const absoluteProxiedUrl = `http://${hostForInternal}:${portForInternal}${proxiedUrl}`;
                const response = {
                  status: 'ok',
                  provider,
                  directUrl: proxiedUrl,
                  originalLink,
                  filename: unrestricted?.filename || fname,
                  proxied: true,
                  format: isBrowserFriendly ? 'native' : 'transcoded'
                };

                // Handle MKV files - direct streaming with MP4 fallback
                const filename = response.filename.toLowerCase();
                if (filename.endsWith('.mkv')) {
                  console.log(`MKV: Setting up dual-mode streaming for ${response.filename}`);

                  let fallbackAbsolute = null;
                  if (mkvTranscoder.forceTranscode) {
                    // Only prepare fallback when transcoding is enabled
                    const fallbackPath = await mkvTranscoder.getRemuxedUrl(absoluteProxiedUrl, response.filename);
                    fallbackAbsolute = `${req.protocol}://${req.get('host')}${fallbackPath}`;
                  }

                  response.format = 'mkv_native';
                  response.directUrl = proxiedUrl; // MKV direct stream
                  response.fallbackUrl = fallbackAbsolute; // HLS fallback when enabled; otherwise null
                  response.compatibility = {
                    format: 'mkv',
                    browserSupport: 'limited',
                    recommendedAction: 'Will attempt MKV direct streaming, fallback to MP4 if needed',
                    notes: 'MKV file will be streamed directly. If unsupported, will automatically retry with MP4 version.',
                    streaming: {
                      direct: true,
                      container: 'mkv',
                      requiresEnhancedPlayer: true,
                      hasMp4Fallback: false,
                      hasHlsFallback: Boolean(mkvTranscoder.forceTranscode)
                    },
                    fallback: {
                      format: mkvTranscoder.forceTranscode ? 'hls' : 'none',
                      url: fallbackAbsolute,
                      status: mkvTranscoder.forceTranscode ? 'preparing' : 'disabled'
                    }
                  };
                } else if (filename.endsWith('.avi')) {
                  response.compatibility = {
                    format: 'avi',
                    browserSupport: 'limited',
                    recommendedAction: 'Try to find MP4 version for better compatibility',
                    alternativeCodecs: ['h264', 'h265', 'vp9'],
                    notes: 'AVI files may not play in all browsers due to codec support limitations'
                  };
                }

                return res.json(response);
              } catch (_) {
                // Fallback to original link if unlock fails
                if (!isBrowserFriendly) {
                  console.log(`Skipping non-browser-friendly format: ${fname}, trying next file...`);
                  continue; // Skip MKV and other unsupported formats
                }

                const proxiedUrl = `/api/stream/${encodeURIComponent(originalLink)}`;
                return res.json({
                  status: 'ok',
                  provider,
                  directUrl: proxiedUrl,
                  originalLink,
                  filename: fname,
                  proxied: true,
                  format: 'native'
                });
              }
            }
          }
          return res.json({
            status: 'non_streamable',
            reason: 'no_browser_friendly_formats',
            message: 'Only MKV/AVI files found. These formats may not be supported by your browser.',
            suggestion: 'Try searching for the same content with different quality or from a different provider that offers MP4 format.',
            availableFormats: linksArr.slice(0, 5).map(item => {
              const name = typeof item === 'string' ? item : (item.filename || item.name || '');
              return name.toLowerCase().includes('.mkv') ? 'MKV' :
                     name.toLowerCase().includes('.avi') ? 'AVI' : 'Unknown';
            }).filter((format, index, arr) => arr.indexOf(format) === index)
          });
        } else {
          // prefer 'any': return first available link (unlock if possible, otherwise original)
          for (let i = 0; i < maxTry; i++) {
            const item = linksArr[i] || {};
            const originalLink = typeof item === 'string' ? item : (item.link || item.url || item.download || item);
            try {
              const unrestricted = await dp.unrestrictLink(originalLink);
              const directUrl = unrestricted?.download || unrestricted?.streaming || unrestricted?.link || originalLink;
              const proxiedUrl = `/api/stream/${encodeURIComponent(directUrl)}`;
              return res.json({ status: 'ok', provider, directUrl: proxiedUrl, originalLink, filename: unrestricted?.filename || item?.filename || '', proxied: true });
            } catch (_) {
              // Fallback to original link
              const proxiedUrl = `/api/stream/${encodeURIComponent(originalLink)}`;
              return res.json({ status: 'ok', provider, directUrl: proxiedUrl, originalLink, filename: item?.filename || '', proxied: true });
            }
          }
          return res.status(502).json({ error: 'No links available' });
        }
      }
    } catch (e) {
      console.warn('Quick readiness check failed:', e.message);
    }

    return res.status(202).json({ status: 'processing', provider, torrentId });
  } catch (error) {
    console.error('Debrid resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve link via debrid', message: error.message });
  }
});

// Debrid torrent status/poll endpoint
app.get('/api/debrid/status/:provider/:id', async (req, res) => {
  try {
    const { provider, id } = req.params;
    const prefer = (req.query.prefer || 'video').toLowerCase();
    const debug = req.query.debug === 'true';
    let dp = debridManager.getProvider(provider);
    if (!dp) {
      try { await debridManager.refreshProviders(); } catch (_) {}
      dp = debridManager.getProvider(provider);
      if (!dp) return res.status(503).json({ error: 'Debrid provider not configured', provider });
    }
    const info = await dp.getTorrentInfo(id);
    const magnetInfo = Array.isArray(info?.magnets) ? info.magnets[0] : (info?.magnets || info);
    const linksArr = [];
    if (Array.isArray(magnetInfo?.links)) linksArr.push(...magnetInfo.links);
    if (Array.isArray(info?.links)) linksArr.push(...info.links);
    if (Array.isArray(info?.data?.links)) linksArr.push(...info.data.links);
    const filesArr = magnetInfo?.files || info?.files || info?.data?.files || [];
    if (linksArr.length > 0) {
      const videoExts = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'];
      const maxTry = Math.min(linksArr.length, 20);
      const getName = (item, url) => {
        const name = item?.filename || item?.name || item?.file || '';
        if (name) return String(name).toLowerCase();
        try { const u = new URL(url); return decodeURIComponent(u.pathname.split('/').pop() || '').toLowerCase(); }
        catch { return String(url).toLowerCase(); }
      };
      if (prefer === 'video') {
        for (let i = 0; i < maxTry; i++) {
          const item = linksArr[i] || {};
          const originalLink = typeof item === 'string' ? item : (item.link || item.url || item.download || item);
          const fname = getName(item, originalLink);
          if (videoExts.some(ext => fname.endsWith(ext))) {
            try {
              const unrestricted = await dp.unrestrictLink(originalLink);
              const directUrl = unrestricted?.download || unrestricted?.link || originalLink;
              const proxiedUrl = `/api/stream/${encodeURIComponent(directUrl)}`;
              return res.json({ status: 'ok', directUrl: proxiedUrl, filename: unrestricted?.filename || fname, proxied: true, debug: debug ? { tried: i+1, candidates: linksArr.length } : undefined });
            } catch (_) {
              const proxiedUrl = `/api/stream/${encodeURIComponent(originalLink)}`;
              return res.json({ status: 'ok', directUrl: proxiedUrl, filename: fname, proxied: true, debug: debug ? { tried: i+1, candidates: linksArr.length, fallback: true } : undefined });
            }
          }
        }
        return res.json({ status: 'non_streamable', reason: 'archive_or_non_video', debug: debug ? { candidates: summarizeLinks(linksArr), files: summarizeFiles(filesArr) } : undefined });
      } else {
        for (let i = 0; i < maxTry; i++) {
          const item = linksArr[i] || {};
          const originalLink = typeof item === 'string' ? item : (item.link || item.url || item.download || item);
          try {
            const unrestricted = await dp.unrestrictLink(originalLink);
            const directUrl = unrestricted?.download || unrestricted?.link || originalLink;
            const proxiedUrl = `/api/stream/${encodeURIComponent(directUrl)}`;
            return res.json({ status: 'ok', directUrl: proxiedUrl, filename: unrestricted?.filename || item?.filename || '', proxied: true, debug: debug ? { tried: i+1, candidates: linksArr.length } : undefined });
          } catch (_) {
            const proxiedUrl = `/api/stream/${encodeURIComponent(originalLink)}`;
            return res.json({ status: 'ok', directUrl: proxiedUrl, filename: item?.filename || '', proxied: true, debug: debug ? { tried: i+1, candidates: linksArr.length, fallback: true } : undefined });
          }
        }
        return res.status(502).json({ status: 'error', error: 'No links available' });
      }
    }
    // Fallback: if no magnets/links for provided id, try recent magnets (best-effort)
    if (linksArr.length === 0 && (!Array.isArray(info?.magnets) || info.magnets.length === 0)) {
      try {
        const recent = await dp.listRecentMagnets();
        // Prefer the most recent with links
        const withLinks = recent.find(m => Array.isArray(m.links) && m.links.length > 0);
        if (withLinks) {
          const fallbackLinks = withLinks.links;
          const videoExts = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v'];
          const getName = (item, url) => {
            const name = item?.filename || item?.name || item?.file || '';
            if (name) return String(name).toLowerCase();
            try { const u = new URL(url); return decodeURIComponent(u.pathname.split('/').pop() || '').toLowerCase(); }
            catch { return String(url).toLowerCase(); }
          };
          if (prefer === 'video') {
            for (const item of fallbackLinks) {
              const originalLink = typeof item === 'string' ? item : (item.link || item.url || item.download || item);
              const fname = getName(item, originalLink);
              if (videoExts.some(ext => fname.endsWith(ext))) {
                try {
                  const unrestricted = await dp.unrestrictLink(originalLink);
                  const directUrl = unrestricted?.download || unrestricted?.link || originalLink;
                  return res.json({ status: 'ok', directUrl, filename: unrestricted?.filename || fname, debug: debug ? { fallbackUsed: true } : undefined });
                } catch (_) {
                  return res.json({ status: 'ok', directUrl: originalLink, filename: fname, debug: debug ? { fallbackUsed: true, unlockFailed: true } : undefined });
                }
              }
            }
          } else {
            const first = fallbackLinks[0];
            const originalLink = typeof first === 'string' ? first : (first.link || first.url || first.download || first);
            try {
              const unrestricted = await dp.unrestrictLink(originalLink);
              const directUrl = unrestricted?.download || unrestricted?.link || originalLink;
              return res.json({ status: 'ok', directUrl, filename: unrestricted?.filename || '', debug: debug ? { fallbackUsed: true } : undefined });
            } catch (_) {
              return res.json({ status: 'ok', directUrl: originalLink, filename: '', debug: debug ? { fallbackUsed: true, unlockFailed: true } : undefined });
            }
          }
        }
      } catch (e2) {
        console.warn('Recent magnets fallback failed:', e2.message);
      }
    }

    // Include minimal status info for debugging including file list hints
    const hasArchive = Array.isArray(filesArr) && filesArr.some(f => /\.(rar|r\d{2}|7z|zip|tar|gz|bz2|xz)$/i.test(f.name || f.filename || ''));
    const hasVideo = Array.isArray(filesArr) && filesArr.some(f => /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(f.name || f.filename || ''));
    const base = { status: 'processing', details: { status: magnetInfo?.status, statusCode: magnetInfo?.statusCode, hasArchive, hasVideo } };
    if (debug) {
      base.details.links = summarizeLinks(linksArr);
      base.details.files = summarizeFiles(filesArr);
      base.details.raw = { hasMagnets: Array.isArray(info?.magnets), magnetsCount: Array.isArray(info?.magnets) ? info.magnets.length : 0 };
    }
    return res.json(base);
  } catch (e) {
    console.warn('Debrid status transient error:', e.message);
    return res.json({ status: 'processing', details: { transientError: true, message: e.message } });
  }
});

// Raw debrid debug (sanitized)
app.get('/api/debrid/debug/:provider/:id/raw', async (req, res) => {
  try {
    const { provider, id } = req.params;
    let dp = debridManager.getProvider(provider);
    if (!dp) {
      try { await debridManager.refreshProviders(); } catch (_) {}
      dp = debridManager.getProvider(provider);
      if (!dp) return res.status(503).json({ error: 'Debrid provider not configured', provider });
    }

    const info = await dp.getTorrentInfo(id);
    const maxLen = parseInt(req.query.truncate || '140', 10);
    const safe = sanitizeDebridInfo(info, maxLen);
    // Also log to server console for troubleshooting
    console.log('DEBUG debrid raw (sanitized):', JSON.stringify(safe).slice(0, 5000));
    res.json({ provider, id, sanitized: safe, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Debrid raw debug error:', e);
    res.status(500).json({ error: 'Failed to fetch raw debrid info', message: e.message });
  }
});

function sanitizeDebridInfo(info, maxLen = 140) {
  try {
    const clone = JSON.parse(JSON.stringify(info || {}));
    const shorten = (s) => {
      if (typeof s !== 'string') return s;
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    };
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(walk);
      } else {
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (typeof v === 'string' && (k === 'link' || k === 'url' || k === 'download')) {
            obj[k] = shorten(v);
          } else if (typeof v === 'object') {
            walk(v);
          }
        }
      }
    };
    walk(clone);
    return clone;
  } catch (_) {
    return { error: 'sanitize_failed' };
  }
}
// Helpers for debug summaries
function summarizeLinks(arr) {
  try {
    return (arr || []).slice(0, 10).map(item => {
      const link = typeof item === 'string' ? item : (item.link || item.url || item.download || '');
      const name = (item && (item.filename || item.name || item.file)) || (safeNameFromUrl(link));
      return { name, link: link ? truncate(link, 140) : '', keys: item && typeof item === 'object' ? Object.keys(item) : [] };
    });
  } catch { return []; }
}

function summarizeFiles(arr) {
  try {
    return (arr || []).slice(0, 20).map(f => ({ name: f.name || f.filename || f.file || '', size: f.size || 0 }));
  } catch { return []; }
}

function safeNameFromUrl(u) {
  try { const url = new URL(u); return decodeURIComponent(url.pathname.split('/').pop() || ''); } catch { return ''; }
}

function truncate(s, n) { if (!s) return s; return s.length > n ? s.slice(0, n) + '…' : s; }

// Streaming routes
app.get('/api/stream/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;

    // Mock streaming URLs for MVP
    // Deprecated: use /api/sources and /api/debrid/resolve from client instead
    res.json([]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch streams' });
  }
});


// Remove legacy catch-all (handled below with staticRoot-aware fallback)

// URL resolution endpoints
app.post('/api/resolve', async (req, res) => {
  try {
    const { url, options = {} } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'URL is required',
        message: 'Please provide a URL to resolve'
      });
    }

    const resolved = await enhancedScraperManager.resolveStreamingUrl(url, options);
    res.json({
      original: url,
      resolved: resolved,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('URL resolution error:', error);
    res.status(500).json({
      error: 'URL resolution failed',
      message: error.message
    });
  }
});

// Get resolver statistics
app.get('/api/resolvers/stats', async (req, res) => {
  try {
    const stats = await enhancedScraperManager.getStats();
    res.json({
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Resolver stats error:', error);
    res.status(500).json({
      error: 'Failed to get resolver statistics',
      message: error.message
    });
  }
});

// Check resolver health
app.get('/api/resolvers/health', async (req, res) => {
  try {
    const health = await enhancedScraperManager.checkHealth();
    res.json(health);
  } catch (error) {
    console.error('Resolver health check error:', error);
    res.status(500).json({
      error: 'Health check failed',
      message: error.message
    });
  }
});

// Clear enhanced scraper cache
app.post('/api/enhanced-search/cache/clear', (req, res) => {
  try {
    enhancedScraperManager.clearCache();
    res.json({
      message: 'Enhanced search cache cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message
    });
  }
});

async function initializeAfterListen() {
  console.log(`Environment: ${process.env.NODE_ENV}`);
  try {
    await enhancedScraperManager.initialize();
    console.log('Enhanced scraper manager initialized successfully');
    const debridResolver = enhancedScraperManager.resolverRegistry.getResolver('debrid services');
    if (debridResolver && debridResolver.setDebridManager) {
      debridResolver.setDebridManager(debridManager);
      console.log('Debrid manager injected into DebridResolver');
    }
  } catch (error) {
    console.error('Failed to initialize enhanced scraper manager:', error.message);
  }
}

function startServer(port = DEFAULT_PORT, host = DEFAULT_HOST, options = {}) {
  const { allowRandomFallback = true } = options || {};
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, async () => {
      try {
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        process.env.ACTUAL_PORT = String(actualPort);
        process.env.ACTUAL_HOST = host;
        console.log(`Server running on ${host}:${actualPort}`);
        await initializeAfterListen();
        resolve({ server, port: actualPort, host });
      } catch (e) {
        reject(e);
      }
    });
    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        if (!allowRandomFallback) {
          return reject(err);
        }
        console.warn(`Port ${port} in use, retrying on random port...`);
        const s2 = app.listen(0, host, async () => {
          const addr = s2.address();
          const actualPort = typeof addr === 'object' && addr ? addr.port : 0;
          process.env.ACTUAL_PORT = String(actualPort);
          process.env.ACTUAL_HOST = host;
          console.log(`Server running on ${host}:${actualPort}`);
          await initializeAfterListen();
          resolve({ server: s2, port: actualPort, host });
        });
        s2.on('error', reject);
      } else {
        reject(err);
      }
    });
  });
}

if (require.main === module) {
  startServer().catch((e) => {
    console.error('Fatal: failed to start server', e);
    process.exit(1);
  });
}

module.exports = { app, startServer };
// Helper to parse optional JWT for user context
// Simple in-memory cache for Trakt feeds
const traktFeedCache = {
  home: { data: null, ts: 0 },
  movies: new Map(), // userId -> { data, ts }
  tv: new Map(), // userId -> { data, ts }
};
const TRAKT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
// Notifications cache per user
const notificationsCache = new Map(); // userId -> { data, ts }
const NOTIFICATIONS_TTL = 30 * 60 * 1000; // 30 minutes
function formatDateYYYYMMDD(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
// TV metadata caches
const tvSeasonsCache = new Map(); // imdbId -> { data, ts }
const tvSeasonEpisodesCache = new Map(); // `${imdbId}:${season}` -> { data, ts }
const tvEpisodeDetailCache = new Map(); // `${imdbId}:${season}:${episode}` -> { data, ts }
const TV_EP_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getOptionalUserId(req) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return 'default';
    const user = jwt.verify(token, JWT_SECRET);
    return user?.id || 'default';
  } catch (e) {
    return 'default';
  }
}

// Helper: choose Trakt scope and ensure token is fresh
async function getTraktScopeAndToken(userId) {
  try {
    // Prefer default scope in single-user mode
    const tryScopes = ['default', userId].filter(Boolean);
    for (const scope of tryScopes) {
      const td = await secureStorage.getOAuthToken(scope, 'trakt');
      if (td && td.token) {
        let token = td.token;
        let expired = false;
        try { expired = token.expires_at ? (new Date(token.expires_at) <= new Date()) : false; } catch { expired = false; }
        if (expired && token.refresh_token) {
          try {
            const newTok = await oauthService.refreshTraktToken(token.refresh_token);
            await secureStorage.storeOAuthToken(scope, 'trakt', newTok);
            token = newTok;
          } catch (e) {
            console.warn('Trakt token refresh failed for scope', scope, e?.message || e);
          }
        }
        return { scope, token };
      }
    }
  } catch (e) {
    console.warn('getTraktScopeAndToken error:', e?.message || e);
  }
  return { scope: null, token: null };
}

// Unified home feed: if user has Trakt OAuth, use recommendations/watchlist; else fallback to trending
app.get('/api/home', async (req, res) => {
  try {
    const userId = getOptionalUserId(req);
    const refresh = String(req.query.refresh || 'false') === 'true';

    // Serve cache if valid
    if (!refresh && traktFeedCache.home.data && (Date.now() - traktFeedCache.home.ts) < TRAKT_CACHE_TTL) {
      return res.json(traktFeedCache.home.data);
    }

    let movies = [];
    let shows = [];

    // Home wants most popular movies and tv shows
    const [popMovies, popShows] = await Promise.all([
      oauthService.getPopularMovies(20).catch(() => []),
      oauthService.getPopularShows(20).catch(() => [])
    ]);
    movies = Array.isArray(popMovies) ? popMovies.map(item => {
      const m = item?.movie || item;
      return {
        id: m?.ids?.imdb || m?.ids?.slug || m?.ids?.trakt,
        imdbId: m?.ids?.imdb || null,
        title: m?.title,
        year: m?.year,
        type: 'movie'
      };
    }) : [];
    shows = Array.isArray(popShows) ? popShows.map(item => {
      const s = item?.show || item;
      return {
        id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt,
        imdbId: s?.ids?.imdb || null,
        tvdbId: s?.ids?.tvdb || null,
        title: s?.title,
        year: s?.year,
        type: 'tv'
      };
    }) : [];

    // Enhance with posters via OMDb
    const enhancedMovies = await posterService.enhanceMovieBatch(movies);
    const enhancedShows = await posterService.enhanceTVShowBatch(shows);

    const payload = {
      movies: enhancedMovies,
      tvShows: enhancedShows,
      source: 'trakt_popular',
      timestamp: new Date().toISOString()
    };
    traktFeedCache.home = { data: payload, ts: Date.now() };
    res.json(payload);
  } catch (error) {
    console.error('Home feed error:', error);
    res.status(500).json({ error: 'Failed to load home feed' });
  }
});

// Movies page feed: user lists (collection, watchlist)
app.get('/api/movies/feed', async (req, res) => {
  try {
    const userId = getOptionalUserId(req);
    const refresh = String(req.query.refresh || 'false') === 'true';
    // Determine scope via token presence (default-first)
    const { scope, token } = await getTraktScopeAndToken(userId);
    if (!scope) {
      // Fallback to popular movies if Trakt not connected
      try {
        const popMovies = await oauthService.getPopularMovies(20).catch(() => []);
        const movies = Array.isArray(popMovies) ? popMovies.map(item => {
          const m = item?.movie || item;
          return { id: m?.ids?.imdb || m?.ids?.slug || m?.ids?.trakt, imdbId: m?.ids?.imdb || null, title: m?.title, year: m?.year, type: 'movie' };
        }) : [];
        const enhanced = await posterService.enhanceMovieBatch(movies);
        return res.json({ collection: enhanced, watchlist: [], recent: [], lists: [], source: 'fallback_popular' });
      } catch (e) {
        console.warn('Movies fallback failed:', e.message);
        return res.json({ collection: [], watchlist: [], recent: [], lists: [], source: 'empty' });
      }
    }
    if (!refresh) {
      const cached = traktFeedCache.movies.get(scope);
      if (cached && (Date.now() - cached.ts) < TRAKT_CACHE_TTL) return res.json(cached.data);
    }
    const tokenData = token ? { token } : await secureStorage.getOAuthToken(scope, 'trakt');
    const [collectionRaw, watchlistRaw, recentRaw, listsRaw] = await Promise.all([
      oauthService.getTraktCollectionMovies(tokenData.token.access_token).catch(() => []),
      oauthService.getTraktWatchlistMovies(tokenData.token.access_token).catch(() => []),
      oauthService.getTraktHistoryMovies(tokenData.token.access_token, 30).catch(() => []),
      oauthService.getTraktUserLists(tokenData.token.access_token).catch(() => [])
    ]);
    const collection = Array.isArray(collectionRaw) ? collectionRaw.map(item => {
      const m = item?.movie || item;
      return { id: m?.ids?.imdb || m?.ids?.slug || m?.ids?.trakt, imdbId: m?.ids?.imdb || null, title: m?.title, year: m?.year, type: 'movie' };
    }) : [];
    const watchlist = Array.isArray(watchlistRaw) ? watchlistRaw.map(item => {
      const m = item?.movie || item;
      return { id: m?.ids?.imdb || m?.ids?.slug || m?.ids?.trakt, imdbId: m?.ids?.imdb || null, title: m?.title, year: m?.year, type: 'movie' };
    }) : [];
    const recent = Array.isArray(recentRaw) ? recentRaw.map(item => {
      const m = item?.movie || item;
      return { id: m?.ids?.imdb || m?.ids?.slug || m?.ids?.trakt, imdbId: m?.ids?.imdb || null, title: m?.title, year: m?.year, type: 'movie' };
    }) : [];

    // Fetch up to 3 custom lists
    const lists = [];
    if (Array.isArray(listsRaw)) {
      for (const li of listsRaw.slice(0, 3)) {
        try {
          const listId = li?.ids?.slug || li?.ids?.trakt || li?.ids?.id || li?.ids?.slug || li?.ids?.ids;
          const items = await oauthService.getTraktListItemsMovies(tokenData.token.access_token, listId, 1, 20).catch(() => []);
          const mapped = Array.isArray(items) ? items.map(entry => {
            const m = entry?.movie || entry;
            return { id: m?.ids?.imdb || m?.ids?.slug || m?.ids?.trakt, imdbId: m?.ids?.imdb || null, title: m?.title, year: m?.year, type: 'movie' };
          }) : [];
          lists.push({ name: li?.name || li?.description || 'List', id: listId, items: mapped });
        } catch (_) {}
      }
    }

    const [enhCol, enhWl, enhRecent, enhListBatches] = await Promise.all([
      posterService.enhanceMovieBatch(collection),
      posterService.enhanceMovieBatch(watchlist),
      posterService.enhanceMovieBatch(recent),
      Promise.all(lists.map(async l => ({ name: l.name, id: l.id, items: await posterService.enhanceMovieBatch(l.items) })))
    ]);
    const data = { collection: enhCol, watchlist: enhWl, recent: enhRecent, lists: enhListBatches, timestamp: new Date().toISOString() };
    traktFeedCache.movies.set(scope, { data, ts: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('Movies feed error:', error);
    res.status(500).json({ error: 'Failed to load movies feed' });
  }
});

// TV page feed: user lists (collection, watchlist)
app.get('/api/tv/feed', async (req, res) => {
  try {
    const userId = getOptionalUserId(req);
    const refresh = String(req.query.refresh || 'false') === 'true';
    const { scope, token } = await getTraktScopeAndToken(userId);
    if (!scope) {
      // Fallback to popular shows if Trakt not connected
      try {
        const popShows = await oauthService.getPopularShows(20).catch(() => []);
        const shows = Array.isArray(popShows) ? popShows.map(item => {
          const s = item?.show || item;
          return { id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt, imdbId: s?.ids?.imdb || null, tvdbId: s?.ids?.tvdb || null, title: s?.title, year: s?.year, type: 'tv' };
        }) : [];
        const enhanced = await posterService.enhanceTVShowBatch(shows);
        return res.json({ collection: enhanced, watchlist: [], recent: [], lists: [], source: 'fallback_popular' });
      } catch (e) {
        console.warn('TV fallback failed:', e.message);
        return res.json({ collection: [], watchlist: [], recent: [], lists: [], source: 'empty' });
      }
    }
    if (!refresh) {
      const cached = traktFeedCache.tv.get(scope);
      if (cached && (Date.now() - cached.ts) < TRAKT_CACHE_TTL) return res.json(cached.data);
    }
    const tokenData = token ? { token } : await secureStorage.getOAuthToken(scope, 'trakt');
    const [collectionRaw, watchlistRaw, recentRaw, listsRaw] = await Promise.all([
      oauthService.getTraktCollectionShows(tokenData.token.access_token).catch(() => []),
      oauthService.getTraktWatchlistShows(tokenData.token.access_token).catch(() => []),
      oauthService.getTraktHistoryShows(tokenData.token.access_token, 30).catch(() => []),
      oauthService.getTraktUserLists(tokenData.token.access_token).catch(() => [])
    ]);
    const collection = Array.isArray(collectionRaw) ? collectionRaw.map(item => {
      const s = item?.show || item;
      return { id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt, imdbId: s?.ids?.imdb || null, tvdbId: s?.ids?.tvdb || null, title: s?.title, year: s?.year, type: 'tv' };
    }) : [];
    const watchlist = Array.isArray(watchlistRaw) ? watchlistRaw.map(item => {
      const s = item?.show || item;
      return { id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt, imdbId: s?.ids?.imdb || null, tvdbId: s?.ids?.tvdb || null, title: s?.title, year: s?.year, type: 'tv' };
    }) : [];
    const recent = Array.isArray(recentRaw) ? recentRaw.map(item => {
      const s = item?.show || item;
      return { id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt, imdbId: s?.ids?.imdb || null, tvdbId: s?.ids?.tvdb || null, title: s?.title, year: s?.year, type: 'tv' };
    }) : [];

    const lists = [];
    if (Array.isArray(listsRaw)) {
      for (const li of listsRaw.slice(0, 3)) {
        try {
          const listId = li?.ids?.slug || li?.ids?.trakt || li?.ids?.id || li?.ids?.slug || li?.ids?.ids;
          const items = await oauthService.getTraktListItemsShows(tokenData.token.access_token, listId, 1, 20).catch(() => []);
          const mapped = Array.isArray(items) ? items.map(entry => {
            const s = entry?.show || entry;
            return { id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt, imdbId: s?.ids?.imdb || null, tvdbId: s?.ids?.tvdb || null, title: s?.title, year: s?.year, type: 'tv' };
          }) : [];
          lists.push({ name: li?.name || li?.description || 'List', id: listId, items: mapped });
        } catch (_) {}
      }
    }

    const [enhCol, enhWl, enhRecent, enhListBatches] = await Promise.all([
      posterService.enhanceTVShowBatch(collection),
      posterService.enhanceTVShowBatch(watchlist),
      posterService.enhanceTVShowBatch(recent),
      Promise.all(lists.map(async l => ({ name: l.name, id: l.id, items: await posterService.enhanceTVShowBatch(l.items) })))
    ]);
    // Fallback: if nothing in any section, show popular TV to avoid empty UI
    let data = { collection: enhCol, watchlist: enhWl, recent: enhRecent, lists: enhListBatches, timestamp: new Date().toISOString() };
    const totalCount = enhCol.length + enhWl.length + enhRecent.length + (Array.isArray(enhListBatches) ? enhListBatches.reduce((a,b)=> a + (b.items?.length||0), 0) : 0);
    if (totalCount === 0) {
      try {
        const popShows = await oauthService.getPopularShows(20).catch(() => []);
        const shows = Array.isArray(popShows) ? popShows.map(item => {
          const s = item?.show || item;
          return { id: s?.ids?.imdb || s?.ids?.slug || s?.ids?.trakt, imdbId: s?.ids?.imdb || null, tvdbId: s?.ids?.tvdb || null, title: s?.title, year: s?.year, type: 'tv' };
        }) : [];
        const enhanced = await posterService.enhanceTVShowBatch(shows);
        data = { collection: enhanced, watchlist: [], recent: [], lists: [], source: 'fallback_popular', timestamp: new Date().toISOString() };
      } catch (_) {}
    }
    traktFeedCache.tv.set(scope, { data, ts: Date.now() });
    res.json(data);
  } catch (error) {
    console.error('TV feed error:', error);
    res.status(500).json({ error: 'Failed to load tv feed' });
  }
});
  // Movie details by IMDB id (Trakt + Fanart poster via PosterService)
app.get('/api/movie/:imdbId', async (req, res) => {
  try {
    const { imdbId } = req.params;
    if (!imdbId || !/^tt\d+$/.test(imdbId)) {
      return res.status(400).json({ error: 'Invalid IMDB ID format' });
    }
    const d = await oauthService.makeTraktRequest(`/movies/${imdbId}`, null, { extended: 'full' });
    if (!d || !d.title) return res.status(404).json({ error: 'Not found' });
    const poster = await posterService.getPosterUrl(d.title, d.year, 'movie', imdbId);
    const background = await posterService.getBackgroundUrl(d.title, d.year, 'movie', imdbId);
    res.json({
      imdbId,
      title: d.title,
      year: d.year,
      plot: d.overview || '',
      runtime: d.runtime || null,
      poster: poster,
      background,
      rating: d.rating || null,
      genres: Array.isArray(d.genres) ? d.genres.join(', ') : ''
    });
  } catch (error) {
    console.error('Movie details API error:', error);
    res.status(500).json({ error: 'Failed to load movie details', message: error.message });
  }
});
