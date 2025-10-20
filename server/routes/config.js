const express = require('express');
const router = express.Router();
const SecureStorage = require('../services/secureStorage');
const OAuthService = require('../services/oauthService');

// Global debrid manager instance (will be injected by main server)
let debridManager = null;

const secureStorage = new SecureStorage();
const oauthService = new OAuthService();

// Function to inject debridManager
function setDebridManager(manager) {
  debridManager = manager;
}

// Store API key
router.post('/api-keys/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const { apiKey, metadata = {} } = req.body;
    const userId = req.user.id; // Get user ID from authenticated token

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({ error: 'Valid API key is required' });
    }

    // Validate provider
    const validProviders = ['tmdb', 'premiumize', 'alldebrid', 'imdb', 'omdb', 'fanarttv'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    // Store encrypted API key for the user
    const success = await secureStorage.storeApiKey(userId, provider, apiKey.trim(), metadata);
    // Also store under a shared 'default' scope for system services (e.g., debridManager)
    try {
      await secureStorage.storeApiKey('default', provider, apiKey.trim(), metadata);
    } catch (e) {
      console.warn('Failed to store default-scoped API key:', e.message);
    }

    if (success) {
      // No extra env handling for removed providers
      // Refresh debrid providers if this is a debrid provider
      if (debridManager && ['realdebrid', 'premiumize', 'alldebrid'].includes(provider)) {
        await debridManager.refreshProviders();
      }

      res.json({
        success: true,
        message: `API key for ${provider} stored successfully`,
        provider
      });
    } else {
      res.status(500).json({ error: 'Failed to store API key' });
    }
  } catch (error) {
    console.error('API key storage error:', error);
    res.status(500).json({ error: 'Failed to store API key' });
  }
});

// Get API key (without exposing the actual key)
router.get('/api-keys/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user.id; // Get user ID from authenticated token

    const keyData = await secureStorage.getApiKey(userId, provider);
    if (!keyData) {
      const envMap = {
      omdb: process.env.OMDB_API_KEY,
      fanarttv: process.env.FANART_API_KEY || process.env.FANARTTV_API_KEY,
    };
    const envKey = envMap[provider];
    if (envKey) {
      return res.json({ provider, configured: true, metadata: { source: 'env' }, source: 'env' });
    }
    return res.status(404).json({ error: 'API key not found' });
    }

    // Return metadata only, not the actual key
    res.json({
      provider,
      configured: true,
      metadata: keyData.metadata
    });
  } catch (error) {
    console.error('API key retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve API key' });
  }
});

// Delete API key
router.delete('/api-keys/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user.id; // Get user ID from authenticated token

    const success = await secureStorage.deleteApiKey(userId, provider);
    if (success) {
      res.json({
        success: true,
        message: `API key for ${provider} deleted successfully`
      });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('API key deletion error:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Test API key
router.post('/api-keys/:provider/test', async (req, res) => {
  try {
    const { provider } = req.params;
    const userId = req.user.id; // Get user ID from authenticated token
    const keyData = await secureStorage.getApiKey(userId, provider);

    if (!keyData) {
      const envMap = {
      omdb: process.env.OMDB_API_KEY,
      fanarttv: process.env.FANART_API_KEY || process.env.FANARTTV_API_KEY,
    };
    const envKey = envMap[provider];
    if (envKey) {
      return res.json({ provider, configured: true, metadata: { source: 'env' }, source: 'env' });
    }
    return res.status(404).json({ error: 'API key not found' });
    }

    let testResult = { valid: false, message: 'Unknown provider' };

  switch (provider) {
    case 'tmdb':
      testResult = await testTMDBKey(keyData.key);
      break;
    case 'premiumize':
      testResult = await testPremiumizeKey(keyData.key);
      break;
    case 'alldebrid':
      testResult = await testAllDebridKey(keyData.key);
      break;
    case 'imdb':
      testResult = await testIMDBKey(keyData.key);
      break;
    
    
  }

    res.json(testResult);
  } catch (error) {
    console.error('API key test error:', error);
    res.status(500).json({ error: 'Failed to test API key' });
  }
});

// Get all configured providers
router.get('/providers', async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from authenticated token
    const configuredProviders = secureStorage.listConfiguredProviders(userId);

    // Add OAuth status for providers that support it
    const oauthProviders = ['trakt', 'realdebrid', 'alldebrid'];
    const oauthStatus = {};

    for (const provider of oauthProviders) {
      oauthStatus[provider] = {
        configured: secureStorage.isProviderConfigured(userId, provider, 'oauth'),
        expired: secureStorage.isTokenExpired(userId, provider),
        metadata: secureStorage.getProviderMetadata(userId, provider, 'oauth')
      };
    }

    res.json({
      apiKeys: configuredProviders.apiKeys || [],
      oauthTokens: configuredProviders.oauthTokens || [],
      oauthStatus
    });
  } catch (error) {
    console.error('Provider listing error:', error);
    res.status(500).json({ error: 'Failed to list providers' });
  }
});

// Get system configuration
router.get('/system', async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from authenticated token
    const configuredProviders = secureStorage.listConfiguredProviders(userId);

    res.json({
      version: require('../../package.json').version,
      features: {
        traktOAuth: true,
        realDebridOAuth: true,
        apiKeyManagement: true,
        secureStorage: true
      },
      configuredProviders: configuredProviders.apiKeys?.length || 0,
      configuredOAuth: configuredProviders.oauthTokens?.length || 0
    });
  } catch (error) {
    console.error('System config error:', error);
    res.status(500).json({ error: 'Failed to get system configuration' });
  }
});

// Helper functions for API key testing
async function testTMDBKey(apiKey) {
  try {
    const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${apiKey}`);
    if (response.ok) {
      return { valid: true, message: 'TMDB API key is valid' };
    } else {
      return { valid: false, message: 'Invalid TMDB API key' };
    }
  } catch (error) {
    return { valid: false, message: 'TMDB API test failed' };
  }
}

async function testPremiumizeKey(apiKey) {
  try {
    const response = await fetch('https://www.premiumize.me/api/account/info', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (response.ok) {
      const data = await response.json();
      return {
        valid: true,
        message: 'Premiumize API key is valid',
        user: data.username,
        premium: data.premium_until
      };
    } else {
      return { valid: false, message: 'Invalid Premiumize API key' };
    }
  } catch (error) {
    return { valid: false, message: 'Premiumize API test failed' };
  }
}

async function testAllDebridKey(apiKey) {
  try {
    const agent = process.env.ALLDEBRID_AGENT || 'flake-wire';
    const response = await fetch(`https://api.alldebrid.com/v4/user?apikey=${apiKey}&agent=${encodeURIComponent(agent)}`);
    const data = await response.json();
    if (data.status === 'success') {
      return { valid: true, message: 'AllDebrid API key is valid', user: data.data?.user };
    }
    const errMsg = data?.error?.message || 'Invalid AllDebrid API key';
    return { valid: false, message: errMsg };
  } catch (error) {
    return { valid: false, message: 'AllDebrid API test failed' };
  }
}

async function testIMDBKey(apiKey) {
  try {
    // Test with a well-known movie (Titanic)
    const response = await fetch(`https://www.omdbapi.com/?apikey=${apiKey}&t=Titanic&y=1997`);
    if (response.ok) {
      const data = await response.json();
      if (data.Response === 'True') {
        return {
          valid: true,
          message: 'IMDB API key is valid',
          testMovie: data.Title,
          testYear: data.Year
        };
      } else {
        return { valid: false, message: 'Invalid IMDB API key' };
      }
    } else {
      return { valid: false, message: 'Invalid IMDB API key' };
    }
  } catch (error) {
    return { valid: false, message: 'IMDB API test failed' };
  }
}

// Orionoid integration removed

// removed prowlarr integration

// Debug endpoint to list all stored API keys (for debugging - no auth required)
router.get('/debug/api-keys', async (req, res) => {
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

module.exports = { router, setDebridManager };
