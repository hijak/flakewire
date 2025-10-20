const ProviderRegistry = require('./providers');
const ContentFilters = require('./utils/filters');

class ScraperManager {
    constructor() {
        this.registry = new ProviderRegistry();
        this.filters = new ContentFilters();
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.lastHealthCheck = 0;
        this.healthCheckInterval = 10 * 60 * 1000; // 10 minutes
    }

    // Main search method
    async search(query, options = {}) {
        try {
            const searchData = this.parseSearchQuery(query, options);

            // Check cache first
            const cacheKey = this.generateCacheKey(searchData, options);
            const cachedResult = this.getFromCache(cacheKey);
            if (cachedResult) {
                console.log(`Returning cached results for: ${searchData.title}`);
                return cachedResult;
            }

            // Perform search
            const results = await this.registry.searchAllProviders(searchData, options);

            // Cache the results
            this.setCache(cacheKey, results);

            return results;
        } catch (error) {
            console.error('ScraperManager search error:', error);
            throw error;
        }
    }

    // Parse and validate search query
    parseSearchQuery(query, options = {}) {
        let searchData = {};

        if (typeof query === 'string') {
            searchData = {
                title: query,
                type: options.type || 'movie',
                year: options.year || null,
                season: options.season || null,
                episode: options.episode || null,
                imdb: options.imdb || null,
                aliases: options.aliases || []
            };
        }

        if (typeof query === 'object') {
            searchData = {
                title: query.title || query.q || '',
                type: query.type || options.type || 'movie',
                year: query.year || options.year || null,
                season: query.season || options.season || null,
                episode: query.episode || options.episode || null,
                imdb: query.imdb || options.imdb || null,
                aliases: query.aliases || options.aliases || []
            };
        }

        // Log the search data for debugging
        console.log(`DEBUG: SearchData:`, {
            title: searchData.title,
            type: searchData.type,
            imdb: searchData.imdb,
            year: searchData.year
        });

        if (!searchData.title) {
            throw new Error('Invalid query format');
        }

        return searchData;
    }

    // Search specific provider
    async searchProvider(providerName, query, options = {}) {
        try {
            const searchData = this.parseSearchQuery(query, options);
            return await this.registry.searchProvider(providerName, searchData, options);
        } catch (error) {
            console.error(`Search provider ${providerName} error:`, error);
            throw error;
        }
    }

    // Get movie/TV show suggestions
    async getSuggestions(query, options = {}) {
        try {
            const searchData = this.parseSearchQuery(query, options);
            const searchQuery = searchData.title;

            if (!searchQuery) {
                throw new Error('Title is required for suggestions');
            }

            // For now, return empty suggestions
            // This could be enhanced to use TMDB/IMDB APIs for real suggestions
            return [];
        } catch (error) {
            console.error('Suggestions error:', error);
            return [];
        }
    }

    // Get available providers
    getProviders() {
        return this.registry.getProviderConfigs();
    }

    // Get provider statistics
    getStats() {
        return this.registry.getStats();
    }

    // Check providers health
    async checkHealth() {
        const now = Date.now();

        // Don't check health too frequently
        if (now - this.lastHealthCheck < this.healthCheckInterval) {
            return await this.registry.checkProvidersHealth();
        }

        this.lastHealthCheck = now;
        return await this.registry.checkProvidersHealth();
    }

    // Enable/disable providers
    async enableProvider(name) {
        const success = this.registry.enableProvider(name);
        if (success) {
            this.clearCache(); // Clear cache when providers change
        }
        return success;
    }

    async disableProvider(name) {
        const success = this.registry.disableProvider(name);
        if (success) {
            this.clearCache(); // Clear cache when providers change
        }
        return success;
    }

    // Cache management
    generateCacheKey(searchData, options) {
        const key = {
            title: searchData.title.toLowerCase(),
            year: searchData.year,
            type: searchData.type,
            season: searchData.season,
            episode: searchData.episode,
            quality: options.quality,
            minSeeders: options.minSeeders,
            language: options.language
        };
        return JSON.stringify(key);
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });

        // Limit cache size
        if (this.cache.size > 100) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    }

    clearCache() {
        this.cache.clear();
        console.log('Scraper cache cleared');
    }

    // Get cache statistics
    getCacheStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;

        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp < this.cacheTimeout) {
                validEntries++;
            } else {
                expiredEntries++;
            }
        }

        return {
            total: this.cache.size,
            valid: validEntries,
            expired: expiredEntries,
            timeout: this.cacheTimeout
        };
    }

    // Cleanup expired cache entries
    cleanupCache() {
        const now = Date.now();
        const keysToDelete = [];

        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp >= this.cacheTimeout) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.cache.delete(key));

        if (keysToDelete.length > 0) {
            console.log(`Cleaned up ${keysToDelete.length} expired cache entries`);
        }

        return keysToDelete.length;
    }

    // Enhanced search with multiple strategies
    async enhancedSearch(query, options = {}) {
        const results = {
            exact: [],
            partial: [],
            suggestions: []
        };

        try {
            // Try exact match first
            const exactResults = await this.search(query, { ...options, strict: true });
            results.exact = exactResults;

            // If no exact results, try partial match
            if (exactResults.length === 0 && options.allowPartial !== false) {
                const partialResults = await this.search(query, { ...options, strict: false });
                results.partial = partialResults;
            }

            // Get suggestions if requested
            if (options.includeSuggestions && results.exact.length === 0) {
                results.suggestions = await this.getSuggestions(query, options);
            }

            return results;
        } catch (error) {
            console.error('Enhanced search error:', error);
            return results;
        }
    }

    // Export/import configuration
    exportConfig() {
        return {
            providers: this.getProviders(),
            stats: this.getStats(),
            cacheStats: this.getCacheStats()
        };
    }

    // Method to periodically clean up cache
    startCacheCleanup() {
        setInterval(() => {
            this.cleanupCache();
        }, 60000); // Clean up every minute
    }
}

module.exports = ScraperManager;