const HTTPClient = require('../utils/client');
const ContentFilters = require('../utils/filters');

class BaseProvider {
    constructor(name, config = {}) {
        this.name = name;
        this.baseURL = config.baseURL || '';
        this.priority = config.priority || 1;
        this.enabled = config.enabled !== false; // Default to enabled
        this.supportsMovies = config.supportsMovies !== false;
        this.supportsTV = config.supportsTV || false;
        this.hasSupport = config.hasSupport || false;
        this.packCapable = config.packCapable || false;
        this.minSeeders = config.minSeeders || 0;
        this.client = new HTTPClient();
        this.filters = new ContentFilters();

        // Rate limiting
        this.lastRequestTime = 0;
        this.minRequestInterval = config.minRequestInterval || 1000; // 1 second default
    }

    // Rate limiting helper
    async waitIfNeeded() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    // Abstract method to be implemented by concrete providers
    async search(data) {
        throw new Error('search method must be implemented by concrete provider');
    }

    // Helper method to validate search data
    validateSearchData(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid search data: must be an object');
        }

        if (!data.title || typeof data.title !== 'string') {
            throw new Error('Invalid search data: title is required and must be a string');
        }

        return true;
    }

    // Helper method to standardize result format
    createResult(data) {
        return {
            provider: this.name,
            source: 'torrent',
            seeders: data.seeders || 0,
            leechers: data.leechers || 0,
            hash: data.hash || data.infoHash || '',
            name: data.name || data.title || '',
            quality: data.quality || this.filters.detectQuality(data.name || data.title || ''),
            language: data.language || this.filters.detectLanguage(data.name || data.title || ''),
            url: data.url || data.magnet || data.link || '',
            info: data.info || this.createInfoString(data),
            size: data.size || this.filters.parseSize(data.sizeStr || data.size || '0'),
            direct: data.direct || false,
            debridonly: data.debridonly !== false, // Default to true for torrents
            type: data.type || 'movie',
            year: data.year || null,
            imdb: data.imdb || null,
            season: data.season || null,
            episode: data.episode || null,
            uploadedAt: data.uploadedAt || data.created || null,
            verified: data.verified || false,
            tracker: data.tracker || this.name,
            peers: data.peers || (data.seeders + data.leechers) || 0
        };
    }

    // Helper method to create info string
    createInfoString(data) {
        const parts = [];

        if (data.quality) {
            parts.push(data.quality);
        }

        if (data.size) {
            parts.push(this.filters.formatSize(data.size));
        }

        if (data.seeders !== undefined) {
            parts.push(`S: ${data.seeders}`);
        }

        if (data.leechers !== undefined) {
            parts.push(`L: ${data.leechers}`);
        }

        return parts.join(' | ') || 'Unknown';
    }

    // Helper method to clean and normalize search query
    cleanSearchQuery(title, year = null) {
        let cleanTitle = title
            .replace(/[._-]/g, ' ') // Replace dots, underscores, hyphens with spaces
            .replace(/[^\w\s]/g, ' ') // Replace special characters with spaces
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();

        // Add year if provided
        if (year) {
            cleanTitle += ` ${year}`;
        }

        return cleanTitle;
    }

    // Helper method to extract IMDB ID from various formats
    extractIMDBID(imdbData) {
        if (!imdbData) return null;

        // Handle tt1234567 format
        if (typeof imdbData === 'string' && imdbData.startsWith('tt')) {
            return imdbData;
        }

        // Handle numeric format
        if (typeof imdbData === 'string' && /^\d+$/.test(imdbData)) {
            return `tt${imdbData.padStart(7, '0')}`;
        }

        // Handle numeric value
        if (typeof imdbData === 'number') {
            return `tt${imdbData.toString().padStart(7, '0')}`;
        }

        return null;
    }

    // Error handling wrapper
    async safeSearch(data) {
        try {
            await this.waitIfNeeded(); // Rate limiting
            this.validateSearchData(data);
            return await this.search(data);
        } catch (error) {
            console.error(`${this.name} search failed:`, error.message);
            return []; // Return empty array on failure
        }
    }

    // Provider status check
    async isAvailable() {
        try {
            const response = await this.client.get(this.baseURL, {
                timeout: 5000,
                headers: { 'Accept': 'text/html' }
            });
            return response.status === 200;
        } catch (error) {
            console.error(`${this.name} availability check failed:`, error.message);
            return false;
        }
    }

    // Provider configuration
    getConfig() {
        return {
            name: this.name,
            baseURL: this.baseURL,
            priority: this.priority,
            enabled: this.enabled,
            supportsMovies: this.supportsMovies,
            supportsTV: this.supportsTV,
            hasSupport: this.hasSupport,
            packCapable: this.packCapable,
            minSeeders: this.minSeeders,
            minRequestInterval: this.minRequestInterval
        };
    }

    // Enable/disable provider
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    // Update provider configuration
    updateConfig(config) {
        Object.assign(this, config);
    }
}

module.exports = BaseProvider;