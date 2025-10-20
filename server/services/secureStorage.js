const crypto = require('crypto');
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const os = require('os');

function resolveConfigDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(base, 'Flake Wire');
    } else if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'Flake Wire');
    } else {
      // Linux and others: XDG Base Directory spec
      const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      return path.join(base, 'flake-wire');
    }
  } catch (_) {
    return path.join(process.cwd(), 'data');
  }
}

class SecureStorage {
  constructor() {
    // Persistent config directory under user profile (XDG/OS specific)
    const dataDir = resolveConfigDir();
    this.dataDir = dataDir;
    this.storageFile = path.join(this.dataDir, 'secure_storage.json');
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.algorithm = 'aes-256-gcm';
    this.data = {};
    // Ensure initialization completes before any read/write
    this._ready = this.init();
  }

  // Get or create encryption key
  getOrCreateEncryptionKey() {
    const dataDir = this.dataDir || resolveConfigDir();
    const keyFile = path.join(dataDir, '.encryption_key');

    try {
      const existingKey = fssync.readFileSync(keyFile, 'utf8');
      return existingKey;
    } catch (error) {
      // Create new encryption key
      const newKey = crypto.randomBytes(32).toString('hex');

      // Ensure data directory exists
      const dataDir = path.dirname(keyFile);
      try {
        fssync.mkdirSync(dataDir, { recursive: true });
      } catch (mkdirError) {
        console.error('Failed to create data directory:', mkdirError.message);
        throw mkdirError;
      }

      // On Windows, explicit POSIX modes can cause issues; let the OS handle it
      try {
        if (process.platform === 'win32') {
          fssync.writeFileSync(keyFile, newKey);
        } else {
          fssync.writeFileSync(keyFile, newKey, { mode: 0o600 });
        }
      } catch (e) {
        // Fallback without mode if setting mode fails
        try { fssync.writeFileSync(keyFile, newKey); } catch (e2) { throw e2; }
      }
      return newKey;
    }
  }

  // Initialize storage
  async init() {
    try {
      const data = await fs.readFile(this.storageFile, 'utf8');
      this.data = JSON.parse(data);
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      this.data = {};
      await this.saveToDisk();
    }
  }

  // Encrypt sensitive data
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, Buffer.from(this.encryptionKey, 'hex'), iv);
    cipher.setAAD(Buffer.from('flake-wire', 'utf8'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  // Decrypt sensitive data
  decrypt(encryptedData) {
    try {
      const decipher = crypto.createDecipheriv(this.algorithm, Buffer.from(this.encryptionKey, 'hex'), Buffer.from(encryptedData.iv, 'hex'));
      decipher.setAAD(Buffer.from('flake-wire', 'utf8'));
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error.message);
      return null;
    }
  }

  // Save encrypted data to disk
  async saveToDisk() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.storageFile);
      await fs.mkdir(dir, { recursive: true });

      // Avoid POSIX mode flags on Windows to prevent write errors in Electron
      const payload = JSON.stringify(this.data, null, 2);
      if (process.platform === 'win32') {
        await fs.writeFile(this.storageFile, payload);
      } else {
        try {
          await fs.writeFile(this.storageFile, payload, { mode: 0o600 });
        } catch (e) {
          // Fallback without mode if setting mode fails
          await fs.writeFile(this.storageFile, payload);
        }
      }
    } catch (error) {
      console.error('Failed to save secure storage:', error.message);
    }
  }

  // Store API key with encryption for a specific user
  async storeApiKey(userId, provider, key, metadata = {}) {
    await this._ready;
    const encryptedKey = this.encrypt(key);

    if (!this.data.users) {
      this.data.users = {};
    }
    
    if (!this.data.users[userId]) {
      this.data.users[userId] = {};
    }
    
    if (!this.data.users[userId].apiKeys) {
      this.data.users[userId].apiKeys = {};
    }

    this.data.users[userId].apiKeys[provider] = {
      encrypted: encryptedKey,
      metadata: {
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        ...metadata
      }
    };

    await this.saveToDisk();
    return true;
  }

  // Retrieve and decrypt API key for a specific user
  async getApiKey(userId, provider) {
    await this._ready;
    if (!this.data.users || !this.data.users[userId] || !this.data.users[userId].apiKeys || !this.data.users[userId].apiKeys[provider]) {
      return null;
    }

    const keyData = this.data.users[userId].apiKeys[provider];
    const decryptedKey = this.decrypt(keyData.encrypted);

    if (decryptedKey) {
      // Update last used timestamp
      keyData.metadata.lastUsed = new Date().toISOString();
      await this.saveToDisk();

      return {
        key: decryptedKey,
        metadata: keyData.metadata
      };
    }

    return null;
  }

  // Retrieve first available API key for provider across any user
  async getAnyApiKey(provider) {
    try {
      await this._ready;
      if (!this.data.users) return null;
      for (const [userId, udata] of Object.entries(this.data.users)) {
        if (udata.apiKeys && udata.apiKeys[provider]) {
          const keyData = udata.apiKeys[provider];
          const decryptedKey = this.decrypt(keyData.encrypted);
          if (decryptedKey) {
            keyData.metadata.lastUsed = new Date().toISOString();
            await this.saveToDisk();
            return { key: decryptedKey, metadata: keyData.metadata, userId };
          }
        }
      }
      return null;
    } catch (e) {
      console.error('getAnyApiKey error:', e.message);
      return null;
    }
  }

  // Debug method to list all stored API keys for a provider
  listAllApiKeys(provider) {
    try {
      // Note: best-effort; no need to await _ready for debugging
      if (!this.data.users) return [];
      const keys = [];
      for (const [userId, udata] of Object.entries(this.data.users)) {
        if (udata.apiKeys && udata.apiKeys[provider]) {
          keys.push({
            userId,
            hasKey: true,
            createdAt: udata.apiKeys[provider].metadata.createdAt,
            lastUsed: udata.apiKeys[provider].metadata.lastUsed
          });
        }
      }
      return keys;
    } catch (e) {
      console.error('listAllApiKeys error:', e.message);
      return [];
    }
  }

  // Delete API key for a specific user
  async deleteApiKey(userId, provider) {
    await this._ready;
    if (this.data.users && this.data.users[userId] && this.data.users[userId].apiKeys && this.data.users[userId].apiKeys[provider]) {
      delete this.data.users[userId].apiKeys[provider];
      await this.saveToDisk();
      return true;
    }
    return false;
  }

  // Store OAuth token for a specific user
  async storeOAuthToken(userId, provider, tokenData) {
    await this._ready;
    const encryptedToken = this.encrypt(JSON.stringify(tokenData));

    if (!this.data.users) {
      this.data.users = {};
    }
    
    if (!this.data.users[userId]) {
      this.data.users[userId] = {};
    }
    
    if (!this.data.users[userId].oauthTokens) {
      this.data.users[userId].oauthTokens = {};
    }

    this.data.users[userId].oauthTokens[provider] = {
      encrypted: encryptedToken,
      metadata: {
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString()
      }
    };

    await this.saveToDisk();
    return true;
  }

  // Retrieve OAuth token for a specific user
  async getOAuthToken(userId, provider) {
    await this._ready;
    if (!this.data.users || !this.data.users[userId] || !this.data.users[userId].oauthTokens || !this.data.users[userId].oauthTokens[provider]) {
      return null;
    }

    const tokenData = this.data.users[userId].oauthTokens[provider];
    const decryptedToken = this.decrypt(tokenData.encrypted);

    if (decryptedToken) {
      const token = JSON.parse(decryptedToken);

      // Update last used timestamp
      tokenData.metadata.lastUsed = new Date().toISOString();
      await this.saveToDisk();

      return {
        token: token,
        metadata: tokenData.metadata
      };
    }

    return null;
  }

  // Delete OAuth token for a specific user
  async deleteOAuthToken(userId, provider) {
    await this._ready;
    if (this.data.users && this.data.users[userId] && this.data.users[userId].oauthTokens && this.data.users[userId].oauthTokens[provider]) {
      delete this.data.users[userId].oauthTokens[provider];
      await this.saveToDisk();
      return true;
    }
    return false;
  }

  // List all configured providers for a specific user
  listConfiguredProviders(userId) {
    // No async needed; reading in-memory snapshot
    const providers = {};

    if (this.data.users && this.data.users[userId]) {
      if (this.data.users[userId].apiKeys) {
        providers.apiKeys = Object.keys(this.data.users[userId].apiKeys);
      }

      if (this.data.users[userId].oauthTokens) {
        providers.oauthTokens = Object.keys(this.data.users[userId].oauthTokens);
      }
    }

    return providers;
  }

  // Get metadata for a provider for a specific user
  getProviderMetadata(userId, provider, type = 'apiKey') {
    // No async needed; reading in-memory snapshot
    if (!this.data.users || !this.data.users[userId]) {
      return null;
    }
    
    const storage = type === 'oauth' ? this.data.users[userId].oauthTokens : this.data.users[userId].apiKeys;
    if (storage && storage[provider]) {
      return storage[provider].metadata;
    }
    return null;
  }

  // Check if provider is configured for a specific user
  isProviderConfigured(userId, provider, type = 'apiKey') {
    // No async needed; reading in-memory snapshot
    if (!this.data.users || !this.data.users[userId]) {
      return false;
    }
    
    const storage = type === 'oauth' ? this.data.users[userId].oauthTokens : this.data.users[userId].apiKeys;
    return storage && storage[provider] ? true : false;
  }

  // Validate token expiration for a specific user
  isTokenExpired(userId, provider) {
    // No async needed; reading in-memory snapshot, then decrypt
    if (!this.data.users || !this.data.users[userId] || !this.data.users[userId].oauthTokens || !this.data.users[userId].oauthTokens[provider]) {
      return true;
    }

    const tokenData = this.data.users[userId].oauthTokens[provider];
    const decryptedToken = this.decrypt(tokenData.encrypted);
    if (!decryptedToken) return true;

    try {
      const token = JSON.parse(decryptedToken);
      if (token.expires_at) {
        return new Date(token.expires_at) <= new Date();
      }
    } catch (error) {
      console.error('Token validation error:', error.message);
      return true;
    }

    return false;
  }
}

module.exports = SecureStorage;
