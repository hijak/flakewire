const crypto = require('crypto');
const axios = require('axios');

class OAuthService {
  constructor() {
    const actualPort = process.env.ACTUAL_PORT || process.env.PORT || '3001';
    const actualHost = process.env.ACTUAL_HOST || '127.0.0.1';
    const defaultRedirect = `http://${actualHost}:${actualPort}/auth/callback`;
    this.traktConfig = {
      clientId: process.env.TRAKT_CLIENT_ID || '',
      clientSecret: process.env.TRAKT_CLIENT_SECRET || '',
      redirectUri: process.env.TRAKT_REDIRECT_URI || defaultRedirect,
      apiUrl: 'https://api.trakt.tv',
      oauthUrl: 'https://api.trakt.tv'
    };

    this.realDebridConfig = {
      clientId: process.env.REAL_DEBRID_CLIENT_ID || '24567',
      clientSecret: process.env.REAL_DEBRID_CLIENT_SECRET || '',
      redirectUri: process.env.REAL_DEBRID_REDIRECT_URI || 'http://localhost:3000/auth/realdebrid/callback',
      apiUrl: 'https://api.real-debrid.com/rest/1.0',
      oauthUrl: 'https://api.real-debrid.com/oauth/v2'
    };

    this.allDebridConfig = {
      clientId: process.env.ALL_DEBRID_CLIENT_ID || '12345',
      clientSecret: process.env.ALL_DEBRID_CLIENT_SECRET || '',
      redirectUri: process.env.ALL_DEBRID_REDIRECT_URI || 'http://localhost:3000/auth/alldebrid/callback',
      apiUrl: 'https://api.alldebrid.com/v4',
      pinUrl: 'https://api.alldebrid.com/v4/pin'
    };
  }

  // Trakt Device Code Flow
  async traktDeviceCode() {
    if (!this.traktConfig.clientId) throw new Error('Trakt client not configured');
    const res = await axios.post('https://api.trakt.tv/oauth/device/code', {
      client_id: this.traktConfig.clientId
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    return res.data; // { device_code, user_code, verification_url, expires_in, interval }
  }

  async traktPollDeviceCode(device_code) {
    if (!this.traktConfig.clientId) throw new Error('Trakt client not configured');
    try {
      const res = await axios.post('https://api.trakt.tv/oauth/device/token', {
        code: device_code,
        client_id: this.traktConfig.clientId,
        client_secret: this.traktConfig.clientSecret
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      return {
        access_token: res.data.access_token,
        refresh_token: res.data.refresh_token,
        expires_at: new Date(Date.now() + res.data.expires_in * 1000).toISOString(),
        scope: res.data.scope
      };
    } catch (e) {
      // When not yet approved, Trakt returns 400 with error like authorization_pending or slow_down
      const msg = e.response?.data?.error || e.message;
      const status = e.response?.status || 400;
      return { pending: true, status, error: msg };
    }
  }

  // Generate a random state for OAuth flow
  generateState() {
    return crypto.randomBytes(16).toString('hex');
  }

  // Compute current redirect URI (prefer env override; else actual server host/port)
  getCurrentRedirectUri() {
    const envUri = process.env.TRAKT_REDIRECT_URI;
    if (envUri) return envUri;
    const host = process.env.ACTUAL_HOST || '127.0.0.1';
    const port = process.env.ACTUAL_PORT || process.env.PORT || '3001';
    return `http://${host}:${port}/auth/callback`;
  }

  // Get Trakt authorization URL
  getTraktAuthUrl(state) {
    if (!this.traktConfig.clientId || !this.traktConfig.clientSecret) {
      throw new Error('Trakt client not configured. Set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET.');
    }
    const redirectUri = this.getCurrentRedirectUri();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.traktConfig.clientId,
      redirect_uri: redirectUri,
      state
    });
    return `https://trakt.tv/oauth/authorize?${params.toString()}`;
  }

  // Exchange Trakt authorization code for access token
  async exchangeTraktCode(code, state) {
    try {
      if (!this.traktConfig.clientId || !this.traktConfig.clientSecret) {
        throw new Error('Trakt client not configured.');
      }
      const redirectUri = this.getCurrentRedirectUri();
      const response = await axios.post('https://api.trakt.tv/oauth/token', {
        code: code,
        client_id: this.traktConfig.clientId,
        client_secret: this.traktConfig.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_at: new Date(Date.now() + response.data.expires_in * 1000).toISOString(),
        scope: response.data.scope
      };
    } catch (error) {
      console.error('Trakt OAuth error:', error.response?.data || error.message);
      throw new Error('Failed to exchange Trakt authorization code');
    }
  }

  // Refresh Trakt access token
  async refreshTraktToken(refreshToken) {
    try {
      const redirectUri = this.getCurrentRedirectUri();
      const response = await axios.post('https://api.trakt.tv/oauth/token', {
        refresh_token: refreshToken,
        client_id: this.traktConfig.clientId,
        client_secret: this.traktConfig.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'refresh_token'
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_at: new Date(Date.now() + response.data.expires_in * 1000).toISOString(),
        scope: response.data.scope
      };
    } catch (error) {
      console.error('Trakt token refresh error:', error.response?.data || error.message);
      throw new Error('Failed to refresh Trakt token');
    }
  }

  // Get Real-Debrid authorization URL
  getRealDebridAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: this.realDebridConfig.clientId,
      redirect_uri: this.realDebridConfig.redirectUri,
      state: state,
      response_type: 'code'
    });

    return `${this.realDebridConfig.oauthUrl}/auth/device?${params.toString()}`;
  }

  // Exchange Real-Debrid authorization code for access token
  async exchangeRealDebridCode(code, state) {
    try {
      // Note: Real-Debrid uses form data for the token exchange
      const params = new URLSearchParams();
      params.append('client_id', this.realDebridConfig.clientId);
      params.append('client_secret', this.realDebridConfig.clientSecret);
      params.append('code', code);
      params.append('redirect_uri', this.realDebridConfig.redirectUri);
      params.append('grant_type', 'authorization_code');

      const response = await axios.post(`${this.realDebridConfig.oauthUrl}/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        expires_at: new Date(Date.now() + response.data.expires_in * 1000).toISOString(),
        token_type: response.data.token_type
      };
    } catch (error) {
      console.error('Real-Debrid OAuth error:', error.response?.data || error.message);
      throw new Error('Failed to exchange Real-Debrid authorization code');
    }
  }

  // Refresh Real-Debrid access token
  async refreshRealDebridToken(refreshToken) {
    try {
      const params = new URLSearchParams();
      params.append('client_id', this.realDebridConfig.clientId);
      params.append('client_secret', this.realDebridConfig.clientSecret);
      params.append('refresh_token', refreshToken);
      params.append('grant_type', 'refresh_token');

      const response = await axios.post(`${this.realDebridConfig.oauthUrl}/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token || refreshToken,
        expires_in: response.data.expires_in,
        expires_at: new Date(Date.now() + response.data.expires_in * 1000).toISOString(),
        token_type: response.data.token_type
      };
    } catch (error) {
      console.error('Real-Debrid token refresh error:', error.response?.data || error.message);
      throw new Error('Failed to refresh Real-Debrid token');
    }
  }

  // Make authenticated request to Real-Debrid API
  async makeRealDebridRequest(endpoint, accessToken) {
    try {
      const response = await axios.get(`${this.realDebridConfig.apiUrl}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Real-Debrid API error:', error.response?.data || error.message);
      throw new Error(`Real-Debrid API request failed: ${error.message}`);
    }
  }

  // Get user profile from Real-Debrid
  async getRealDebridUserProfile(accessToken) {
    return this.makeRealDebridRequest('/user?limit=100', accessToken);
  }

  // AllDebrid PIN-based authentication flow
  async getAllDebridPin() {
    try {
      // AllDebrid uses a simple GET request with agent parameter
      const params = new URLSearchParams({
        agent: this.allDebridConfig.clientId
      });
      
      const response = await axios.get(`${this.allDebridConfig.apiUrl}/pin/get?${params.toString()}`);

      if (response.data.status !== 'success') {
        throw new Error(`AllDebrid PIN request failed: ${response.data.error?.message || 'Unknown error'}`);
      }

      const pinData = response.data.data;
      return {
        pin: pinData.pin,
        check: pinData.check,
        expires_in: pinData.expires_in,
        user_url: 'https://alldebrid.com/pin/',
        verification_url: 'https://alldebrid.com/pin/' // AllDebrid's standard PIN verification page
      };
    } catch (error) {
      console.error('AllDebrid PIN error:', error.response?.data || error.message);
      throw new Error('Failed to get AllDebrid PIN');
    }
  }

  // Check AllDebrid PIN status and get API key when activated
  async checkAllDebridPin(pin, check) {
    try {
      const params = new URLSearchParams({
        pin: pin,
        check: check
      });
      
      const response = await axios.get(`${this.allDebridConfig.apiUrl}/pin/check?${params.toString()}`);

      if (response.data.status !== 'success') {
        // If it's an error status but indicates the pin isn't activated yet, handle accordingly
        if (response.data.error && response.data.error.code === 'PIN_CHECK_INVALID') {
          return {
            activated: false,
            expires_in: 60 // Default time to check again
          };
        }
        throw new Error(`AllDebrid PIN check failed: ${response.data.error?.message || 'Unknown error'}`);
      }

      const data = response.data.data;

      if (data.activated === true) {
        // If activated, return the complete token data
        return {
          activated: true,
          apikey: data.apikey || data.token, // AllDebrid might return it as token or apikey
          access_token: data.apikey || data.token,
          expires_in: 31536000, // 1 year for API keys
          expires_at: new Date(Date.now() + 31536000 * 1000).toISOString(),
          token_type: 'ApiKey'
        };
      } else {
        // Return activation status and time remaining
        return {
          activated: false,
          expires_in: data.expires_in || 60 // Default to 60 if not provided
        };
      }
    } catch (error) {
      console.error('AllDebrid PIN check error:', error.response?.data || error.message);
      // If it's a 404 or similar error, it might mean the PIN isn't activated yet
      if (error.response && (error.response.status === 404 || error.response.status === 400)) {
        return {
          activated: false,
          expires_in: 60
        };
      }
      throw new Error('Failed to check AllDebrid PIN status');
    }
  }

  // Refresh AllDebrid token (if needed - AllDebrid uses API keys that don't typically expire)
  // This is more for completeness, as AllDebrid tokens are typically API keys that don't expire
  async refreshAllDebridToken(refreshToken) {
    // AllDebrid doesn't typically use refresh tokens - API keys are long-lived
    // This is a placeholder implementation
    return {
      access_token: refreshToken, // For API key, the token itself is the "refreshed" token
      expires_in: 31536000, // 1 year (assuming it's an API key)
      expires_at: new Date(Date.now() + 31536000 * 1000).toISOString(),
      token_type: 'ApiKey'
    };
  }

  // Make authenticated request to AllDebrid API
  async makeAllDebridRequest(endpoint, accessToken) {
    try {
      const response = await axios.get(`${this.allDebridConfig.apiUrl}${endpoint}`, {
        params: {
          apikey: accessToken
        }
      });

      if (response.data.status !== 'success') {
        throw new Error(`AllDebrid API request failed: ${response.data.error?.message || 'Unknown error'}`);
      }

      return response.data.data;
    } catch (error) {
      console.error('AllDebrid API error:', error.response?.data || error.message);
      throw new Error(`AllDebrid API request failed: ${error.message}`);
    }
  }

  // Get user profile from AllDebrid
  async getAllDebridUserProfile(accessToken) {
    return this.makeAllDebridRequest('/user', accessToken);
  }

  // Validate OAuth state (prevent CSRF attacks)
  validateState(storedState, providedState) {
    return storedState === providedState;
  }

  // Make authenticated request to Trakt API
  async makeTraktRequest(endpoint, accessToken) {
    try {
      const response = await axios.get(`${this.traktConfig.apiUrl}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': this.traktConfig.clientId
        }
      });

      return response.data;
    } catch (error) {
      console.error('Trakt API error:', error.response?.data || error.message);
      throw new Error(`Trakt API request failed: ${error.message}`);
    }
  }

  // Get user profile from Trakt
  async getTraktUserProfile(accessToken) {
    return this.makeTraktRequest('/users/me', accessToken);
  }

  // Get user watchlist from Trakt
  async getTraktWatchlist(accessToken, type = 'movies') {
    return this.makeTraktRequest(`/users/me/watchlist/${type}`, accessToken);
  }

  // Get user watched history from Trakt
  async getTraktWatchedHistory(accessToken, type = 'movies') {
    return this.makeTraktRequest(`/users/me/watched/${type}`, accessToken);
  }

  // Generic Trakt request helper
  async makeTraktRequest(endpoint, accessToken = null, params = {}) {
    const url = `${this.traktConfig.apiUrl}${endpoint}`;
    try {
      const headers = {
        'trakt-api-version': '2',
        'trakt-api-key': this.traktConfig.clientId
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      const res = await axios.get(url, { headers, params, timeout: 15000 });
      return res.data;
    } catch (e) {
      console.error('Trakt API error:', e.response?.data || e.message);
      throw e;
    }
  }

  async getTraktUserProfile(accessToken) {
    try {
      // Trakt user settings returns account info
      const data = await this.makeTraktRequest('/users/settings', accessToken);
      return data?.user || null;
    } catch (e) {
      return null;
    }
  }

  async getTraktRecommendationsMovies(accessToken, limit = 20) {
    return this.makeTraktRequest('/recommendations/movies', accessToken, { limit });
  }

  async getTraktRecommendationsShows(accessToken, limit = 20) {
    return this.makeTraktRequest('/recommendations/shows', accessToken, { limit });
  }

  async getTraktWatchlistMovies(accessToken) {
    return this.makeTraktRequest('/sync/watchlist/movies', accessToken);
  }

  async getTraktWatchlistShows(accessToken) {
    return this.makeTraktRequest('/sync/watchlist/shows', accessToken);
  }

  async getTrendingMovies(limit = 20) {
    return this.makeTraktRequest('/movies/trending', null, { limit });
  }

  async getTrendingShows(limit = 20) {
    return this.makeTraktRequest('/shows/trending', null, { limit });
  }

  async getPopularMovies(limit = 20) {
    return this.makeTraktRequest('/movies/popular', null, { limit });
  }

  async getPopularShows(limit = 20) {
    return this.makeTraktRequest('/shows/popular', null, { limit });
  }

  async getTraktCollectionMovies(accessToken) {
    return this.makeTraktRequest('/sync/collection/movies', accessToken);
  }

  async getTraktCollectionShows(accessToken) {
    return this.makeTraktRequest('/sync/collection/shows', accessToken);
  }

  async getTraktHistoryMovies(accessToken, limit = 20) {
    return this.makeTraktRequest('/sync/history/movies', accessToken, { limit });
  }

  async getTraktHistoryShows(accessToken, limit = 20) {
    return this.makeTraktRequest('/sync/history/shows', accessToken, { limit });
  }

  async getTraktUserLists(accessToken) {
    return this.makeTraktRequest('/users/me/lists', accessToken);
  }

  async getTraktListItemsMovies(accessToken, listIdOrSlug, page = 1, limit = 20) {
    return this.makeTraktRequest(`/users/me/lists/${encodeURIComponent(listIdOrSlug)}/items/movies`, accessToken, { page, limit });
  }

  async getTraktListItemsShows(accessToken, listIdOrSlug, page = 1, limit = 20) {
    return this.makeTraktRequest(`/users/me/lists/${encodeURIComponent(listIdOrSlug)}/items/shows`, accessToken, { page, limit });
  }
}

module.exports = OAuthService;
