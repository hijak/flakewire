const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// This is a simple script to generate initial data for the demo user
// In a real application, this would be handled differently

class DemoDataInitializer {
  constructor() {
    // Use environment variable for data directory or default to app/data
    const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
    this.storageFile = path.join(dataDir, 'secure_storage.json');
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.algorithm = 'aes-256-gcm';
  }

  // Get or create encryption key
  getOrCreateEncryptionKey() {
    // Use environment variable for data directory or default to app/data
    const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
    const keyFile = path.join(dataDir, '.encryption_key');

    try {
      const existingKey = require('fs').readFileSync(keyFile, 'utf8');
      return existingKey;
    } catch (error) {
      // Create new encryption key
      const newKey = crypto.randomBytes(32).toString('hex');

      // Ensure data directory exists
      const dataDir = path.dirname(keyFile);
      try {
        require('fs').mkdirSync(dataDir, { recursive: true });
      } catch (mkdirError) {
        console.error('Failed to create data directory:', mkdirError.message);
        throw mkdirError;
      }

      require('fs').writeFileSync(keyFile, newKey, { mode: 0o600 });
      return newKey;
    }
  }

  // Encrypt data
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

  // Initialize demo user data
  async initializeDemoUser() {
    try {
      // Create the initial data structure
      const initialData = {
        users: {
          "1": { // Demo user ID
            apiKeys: {
              // Add example API keys for demo purposes
              // These are just placeholders - in a real app, users would add their own
            },
            oauthTokens: {
              // Add example OAuth tokens for demo purposes
            }
          }
        }
      };

      // Ensure directory exists
      const dir = path.dirname(this.storageFile);
      await fs.mkdir(dir, { recursive: true });

      // Write the initial data
      await fs.writeFile(this.storageFile, JSON.stringify(initialData, null, 2), { mode: 0o600 });
      
      console.log('Demo user data initialized successfully');
    } catch (error) {
      console.error('Failed to initialize demo user data:', error);
    }
  }
}

// Run initialization if called directly
if (require.main === module) {
  const initializer = new DemoDataInitializer();
  initializer.initializeDemoUser();
} else {
  module.exports = DemoDataInitializer;
}