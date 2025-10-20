const AllDebrid = require('./allDebrid');
const SecureStorage = require('../services/secureStorage');

class DebridManager {
  constructor() {
    this.providers = new Map();
    this.secureStorage = new SecureStorage();
    this.initializeProviders();
  }

  async initializeProviders() {
    // Initialize AllDebrid via API key only
    try {
      const candidates = [];

      // Check environment variable first
      if (process.env.ALLDEBRID_API_KEY) {
        candidates.push({ source: 'env', key: process.env.ALLDEBRID_API_KEY });
        console.log('Found AllDebrid API key in environment');
      }

      // Check for default stored API key (set by settings)
      try {
        const def = await this.secureStorage.getApiKey('default', 'alldebrid');
        if (def?.key) {
          candidates.push({ source: 'default', key: def.key });
          console.log('Found AllDebrid API key in default storage');
        } else {
          console.log('No AllDebrid API key in default storage');
        }
      } catch (e) {
        console.log('Error checking default AllDebrid API key:', e.message);
      }

      // Check for any user API key as fallback
      try {
        const any = await this.secureStorage.getAnyApiKey('alldebrid');
        if (any?.key) {
          candidates.push({ source: `user:${any.userId}`, key: any.key });
          console.log(`Found AllDebrid API key for user ${any.userId}`);
        } else {
          console.log('No user AllDebrid API keys found');
        }
      } catch (e) {
        console.log('Error checking user AllDebrid API keys:', e.message);
      }

      
      console.log(`Total AllDebrid API key candidates: ${candidates.length}`);

      for (const cand of candidates) {
        try {
          console.log(`Testing AllDebrid API key from ${cand.source}...`);
          const ad = new AllDebrid(cand.key);
          const status = await ad.checkStatus();
          if (status?.status === 'active') {
            this.providers.set('alldebrid', ad);
            console.log(`✓ Initialized AllDebrid provider from ${cand.source}`);
            return;
          } else {
            console.log(`✗ AllDebrid API key from ${cand.source} returned status:`, status);
          }
        } catch (e) {
          console.log(`✗ AllDebrid API key from ${cand.source} failed:`, e.message);
        }
      }

      console.warn('AllDebrid key not found or invalid; debrid disabled');
    } catch (e) {
      console.error('Failed to init AllDebrid:', e.message);
    }
  }

  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  async checkProviderStatus(providerName) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not available`);
    }
    return await provider.checkStatus();
  }

  async addMagnetToProvider(providerName, magnetLink) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not available`);
    }
    return await provider.addMagnet(magnetLink);
  }

  async getTorrentInfo(providerName, torrentId) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not available`);
    }
    return await provider.getTorrentInfo(torrentId);
  }

  async getStreamingLinks(providerName, torrentId) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not available`);
    }
    return await provider.getStreamingLinks(torrentId);
  }

  async getAllProviderStatuses() {
    const statuses = {};
    for (const [name, provider] of this.providers) {
      try {
        statuses[name] = await provider.checkStatus();
      } catch (error) {
        statuses[name] = { status: 'error', error: error.message };
      }
    }
    return statuses;
  }

  // Refresh providers when configuration changes
  async refreshProviders() {
    this.providers.clear();
    await this.initializeProviders();
  }

  // Get provider instance
  getProvider(name) {
    return this.providers.get(name);
  }
}

module.exports = DebridManager;
