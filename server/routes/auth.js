const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const OAuthService = require('../services/oauthService');
const SecureStorage = require('../services/secureStorage');

const oauthService = new OAuthService();
let secureStorage = new SecureStorage();
function setSecureStorage(storage) { secureStorage = storage; }
let debridManager = null;

// Allow server to inject debridManager for refreshing providers
function setDebridManager(manager) { debridManager = manager; }

// Optional JWT parsing to associate OAuth with the logged-in user
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';
function getUserId(req) {
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

// Store OAuth state temporarily (in production, use Redis or database)
const oauthStates = new Map();

// Get OAuth authorization URL
router.get('/oauth/:provider/auth', async (req, res) => {
  try {
    const { provider } = req.params;
    const state = oauthService.generateState();
    const userId = getUserId(req);

    // Store state with timestamp (will be used for validation)
    oauthStates.set(state, {
      provider,
      timestamp: Date.now(),
      userAgent: req.get('User-Agent'),
      userId
    });

    // For AllDebrid, we use PIN-based authentication instead of redirect
    if (provider === 'alldebrid') {
      const pinData = await oauthService.getAllDebridPin();
      res.json({
        pinData: pinData,
        state,
        type: 'pin_auth'
      });
    } else {
      let authUrl;
      switch (provider) {
        case 'trakt':
          authUrl = oauthService.getTraktAuthUrl(state);
          break;
        case 'realdebrid':
          authUrl = oauthService.getRealDebridAuthUrl(state);
          break;
        default:
          return res.status(400).json({ error: 'Unsupported OAuth provider' });
      }
      
      res.json({ authUrl, state });
    }
  } catch (error) {
    console.error('OAuth auth URL error:', error.message || error);
    const msg = error?.message?.includes('Trakt client not configured')
      ? 'Trakt client not configured. Please set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET on the server.'
      : 'Failed to generate authorization URL';
    res.status(503).json({ error: msg });
  }
});

// OAuth callback handler
router.post('/oauth/:provider/callback', async (req, res) => {
  try {
    const { provider } = req.params;
    const { code, state, error } = req.body;
    // Prefer the userId captured when we issued the auth URL; fallback to current request's user
    const storedState = oauthStates.get(state);
    const userIdFromAuth = storedState?.userId || null;
    const userId = userIdFromAuth || getUserId(req);

    if (error) {
      return res.status(400).json({ error: `OAuth error: ${error}` });
    }

    // Validate state
    if (!storedState || storedState.provider !== provider) {
      return res.status(400).json({ error: 'Invalid or expired OAuth state' });
    }

    // Clean up state
    oauthStates.delete(state);

    // Exchange code for tokens - AllDebrid is handled separately via PIN flow
    let tokenData;
    switch (provider) {
      case 'trakt':
        tokenData = await oauthService.exchangeTraktCode(code, state);
        break;
      case 'realdebrid':
        tokenData = await oauthService.exchangeRealDebridCode(code, state);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported OAuth provider' });
    }

    // Store encrypted tokens for the user
    await secureStorage.storeOAuthToken(userId, provider, tokenData);
    // Single-user mode: also mirror tokens to 'default' scope
    try { await secureStorage.storeOAuthToken('default', provider, tokenData); } catch (e) { console.warn('Default scope mirror failed:', e?.message || e) }

    // Get user profile if available
    let userProfile = null;
    if (provider === 'trakt') {
      try {
        userProfile = await oauthService.getTraktUserProfile(tokenData.access_token);
      } catch (error) {
        console.error('Failed to get user profile:', error.message);
      }
    }

    res.json({
      success: true,
      provider,
      userProfile,
      expiresAt: tokenData.expires_at
    });

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

// Refresh OAuth token
router.post('/oauth/:provider/refresh', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = getUserId(req);

    // Get current token
    const currentTokenData = await secureStorage.getOAuthToken(userId, provider);
    if (!currentTokenData) {
      return res.status(404).json({ error: 'No OAuth token found for provider' });
    }

    let newTokenData;
    switch (provider) {
      case 'trakt':
        if (!currentTokenData.token.refresh_token) {
          return res.status(400).json({ error: 'No refresh token available' });
        }
        newTokenData = await oauthService.refreshTraktToken(currentTokenData.token.refresh_token);
        break;
      case 'realdebrid':
        if (!currentTokenData.token.refresh_token) {
          return res.status(400).json({ error: 'No refresh token available' });
        }
        newTokenData = await oauthService.refreshRealDebridToken(currentTokenData.token.refresh_token);
        break;
      case 'alldebrid':
        // AllDebrid API keys are long-lived and don't typically need refreshing
        // But if needed, we can implement a refresh mechanism
        newTokenData = await oauthService.refreshAllDebridToken(currentTokenData.token.access_token);
        break;
      default:
        return res.status(400).json({ error: 'Token refresh not supported for this provider' });
    }

    // Store new tokens
    await secureStorage.storeOAuthToken(userId, provider, newTokenData);

    res.json({
      success: true,
      expiresAt: newTokenData.expires_at
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Trakt Device Code start
router.post('/oauth/trakt/device/start', async (req, res) => {
  try {
    const data = await oauthService.traktDeviceCode();
    res.json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_url: data.verification_url,
      expires_in: data.expires_in,
      interval: data.interval
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to start device code', message: e.message });
  }
});

// Trakt Device Code poll
router.post('/oauth/trakt/device/poll', async (req, res) => {
  try {
    const { device_code } = req.body || {};
    if (!device_code) return res.status(400).json({ error: 'Missing device_code' });
    const result = await oauthService.traktPollDeviceCode(device_code);
    if (result.pending) return res.json({ pending: true, status: result.status, error: result.error });
    // Store token for the current or default user
    const userId = getUserId(req);
    await secureStorage.storeOAuthToken(userId, 'trakt', result);
    // Single-user mode: mirror to default scope
    try { await secureStorage.storeOAuthToken('default', 'trakt', result) } catch (e) { console.warn('Mirror trakt token to default failed:', e?.message || e) }
    res.json({ success: true, expiresAt: result.expires_at });
  } catch (e) {
    res.status(500).json({ error: 'Device code polling failed', message: e.message });
  }
});

// Revoke OAuth token
router.delete('/oauth/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = getUserId(req);

    const success = await secureStorage.deleteOAuthToken(userId, provider);
    if (success) {
      res.json({ success: true, message: 'OAuth token revoked successfully' });
    } else {
      res.status(404).json({ error: 'No OAuth token found for provider' });
    }
  } catch (error) {
    console.error('OAuth token revocation error:', error);
    res.status(500).json({ error: 'Failed to revoke OAuth token' });
  }
});

// Get OAuth status
router.get('/oauth/:provider/status', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = getUserId(req);

    // Use async token retrieval to ensure storage is ready
    const tokUser = await secureStorage.getOAuthToken(userId, provider);
    const tokDefault = await secureStorage.getOAuthToken('default', provider);
    const tokenData = tokUser || tokDefault;
    let isConfigured = Boolean(tokenData && tokenData.token);
    // Fallback: consider configured if storage shows provider present (even if token decrypt failed)
    if (!isConfigured) {
      try {
        isConfigured = secureStorage.isProviderConfigured(userId, provider, 'oauth') || secureStorage.isProviderConfigured('default', provider, 'oauth');
      } catch {}
    }
    let isExpired = true;
    if (tokenData && tokenData.token && tokenData.token.expires_at) {
      isExpired = new Date(tokenData.token.expires_at) <= new Date();
    } else if (isConfigured) {
      isExpired = false;
    }
    res.json({ provider, configured: isConfigured, expired: isExpired, metadata: tokenData?.metadata || null });
  } catch (error) {
    console.error('OAuth status check error:', error);
    res.status(500).json({ error: 'Failed to check OAuth status' });
  }
});

// Check AllDebrid PIN status (new endpoint for PIN authentication)
router.post('/oauth/alldebrid/check', async (req, res) => {
  try {
    const { pin, check } = req.body;
    const userId = getUserId(req);

    if (!pin || !check) {
      return res.status(400).json({ error: 'PIN and check token are required' });
    }

    const result = await oauthService.checkAllDebridPin(pin, check);

    if (result.activated) {
      // Store as OAuth token
      await secureStorage.storeOAuthToken(userId, 'alldebrid', {
        access_token: result.access_token,
        apikey: result.apikey,
        expires_at: result.expires_at,
        token_type: result.token_type
      });
      // Mirror to default scope as well for single-user mode
      try {
        await secureStorage.storeOAuthToken('default', 'alldebrid', {
          access_token: result.access_token,
          apikey: result.apikey,
          expires_at: result.expires_at,
          token_type: result.token_type
        });
      } catch (e) { console.warn('Mirror alldebrid token to default failed:', e?.message || e) }
      // Also store as API key so DebridManager can load it
      try {
        await secureStorage.storeApiKey(userId, 'alldebrid', result.apikey, { source: 'oauth_pin' });
        // Also store a default-scope key for system services
        await secureStorage.storeApiKey('default', 'alldebrid', result.apikey, { source: 'oauth_pin' });
      } catch (e) {
        console.warn('Failed to store AllDebrid API key:', e.message);
      }
      // Refresh providers so DebridManager picks it up immediately
      try { if (debridManager) await debridManager.refreshProviders(); } catch (e) { console.warn('Debrid refresh failed:', e.message); }

      // Get user profile if available
      let userProfile = null;
      try {
        userProfile = await oauthService.getAllDebridUserProfile(result.apikey); // Use apikey for API calls
      } catch (error) {
        console.error('Failed to get AllDebrid user profile:', error.message);
      }

      res.json({
        success: true,
        provider: 'alldebrid',
        userProfile,
        expiresAt: result.expires_at,
        activated: true
      });
    } else {
      // PIN not yet activated
      res.json({
        activated: false,
        expires_in: result.expires_in
      });
    }
  } catch (error) {
    console.error('AllDebrid PIN check error:', error);
    res.status(500).json({ error: 'Failed to check PIN status' });
  }
});

module.exports = { router, setDebridManager, setSecureStorage };
