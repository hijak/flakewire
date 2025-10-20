const ProviderRegistry = require('./providers');
const ContentFilters = require('./utils/filters');
const { registry: resolverRegistry } = require('../resolvers');

class EnhancedScraperManager {
    constructor() {
        this.torrentRegistry = new ProviderRegistry();
        this.filters = new ContentFilters();
        this.resolverRegistry = resolverRegistry;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
        this.lastHealthCheck = 0;
        this.healthCheckInterval = 10 * 60 * 1000; // 10 minutes
    }

    async initialize() {
        await this.resolverRegistry.initialize();
        console.log('Enhanced scraper manager initialized');
    }

    // Main search method that combines torrents and direct links
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

            // Search both torrents and direct links
            const results = await Promise.allSettled([
                this.searchTorrents(searchData, options),
                this.searchDirectLinks(searchData, options)
            ]);

            const torrentResults = results[0].status === 'fulfilled' ? results[0].value : [];
            const directResults = results[1].status === 'fulfilled' ? results[1].value : [];

            // Combine and process results
            const combinedResults = [
                ...this.processTorrentResults(torrentResults, searchData),
                ...this.processDirectResults(directResults, searchData)
            ];

            // Filter and sort results
            const filteredResults = this.filters.filterResults(combinedResults, options);
            const sortedResults = this.filters.sortResults(filteredResults);

            // Cache the results
            this.setCache(cacheKey, sortedResults);

            return sortedResults;
        } catch (error) {
            console.error('EnhancedScraperManager search error:', error);
            throw error;
        }
    }

    // Search torrent sources
    async searchTorrents(searchData, options = {}) {
        try {
            return await this.torrentRegistry.searchAllProviders(searchData, options);
        } catch (error) {
            console.error('Torrent search error:', error);
            return [];
        }
    }

    // Search direct streaming links
    async searchDirectLinks(searchData, options = {}) {
        try {
            // Use only the direct search provider from the registry
            const providers = this.torrentRegistry.getAllProviders()
                .filter(p => p.enabled && (p.isDirectSearch === true || (p.name && p.name.toLowerCase() === 'directsearch')))
                .filter(p => (searchData.type === 'tv' ? p.supportsTV : p.supportsMovies));

            if (providers.length === 0) return [];

            const timeout = options.timeout || 15000;
            const searchPromises = providers.map(async provider => {
                try {
                    const result = await Promise.race([
                        provider.safeSearch(searchData, options),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Direct search timeout')), timeout))
                    ]);
                    return { provider: provider.name, results: result };
                } catch (error) {
                    console.warn(`Direct provider ${provider.name} failed:`, error.message);
                    return { provider: provider.name, results: [] };
                }
            });

            const settled = await Promise.allSettled(searchPromises);
            const all = [];
            for (const s of settled) {
                if (s.status === 'fulfilled' && Array.isArray(s.value.results)) {
                    all.push(...s.value.results);
                }
            }
            return all;
        } catch (error) {
            console.error('Direct links search error:', error);
            return [];
        }
    }

    // Resolve streaming URLs
    async resolveStreamingUrl(url, options = {}) {
        try {
            if (!url) {
                throw new Error('URL is required for resolution');
            }

            // Check if it's a torrent (magnet link)
            if (url.startsWith('magnet:')) {
                return await this.resolveTorrent(url, options);
            }

            // Try to resolve with URL resolvers
            const resolver = this.resolverRegistry.findResolver(url);
            if (resolver) {
                const resolved = await this.resolverRegistry.resolveUrl(url, options);
                return {
                    url: resolved.url,
                    resolver: resolved.resolver,
                    type: 'direct',
                    headers: {}
                };
            }

            // If no resolver found, return as-is
            return {
                url: url,
                resolver: 'none',
                type: 'unknown',
                headers: {}
            };
        } catch (error) {
            console.error('URL resolution failed:', error);
            throw error;
        }
    }

    // Resolve torrent to streaming links
    async resolveTorrent(magnetLink, options = {}) {
        try {
            // This would integrate with debrid services to convert torrents to streams
            console.log(`Resolving torrent: ${magnetLink.substring(0, 50)}...`);

            // Placeholder implementation
            return {
                url: magnetLink,
                resolver: 'torrent',
                type: 'torrent',
                headers: {},
                requiresDebrid: true
            };
        } catch (error) {
            console.error('Torrent resolution failed:', error);
            throw error;
        }
    }

    // Process torrent results
    processTorrentResults(torrentResults, searchData) {
        return torrentResults.map(result => ({
            ...result,
            source: 'torrent',
            requiresDebrid: true,
            streamable: false // Will be streamable after debrid
        }));
    }

    // Process direct link results
    processDirectResults(directResults, searchData) {
        return directResults.map(result => ({
            ...result,
            source: 'direct',
            requiresDebrid: false,
            streamable: true
        }));
    }

    // Parse and validate search query
    parseSearchQuery(query, options = {}) {
        if (typeof query === 'string') {
            return {
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
            return {
                title: query.title || query.q || '',
                type: query.type || options.type || 'movie',
                year: query.year || options.year || null,
                season: query.season || options.season || null,
                episode: query.episode || options.episode || null,
                imdb: query.imdb || options.imdb || null,
                aliases: query.aliases || options.aliases || []
            };
        }

        throw new Error('Invalid query format');
    }

    // Enhanced search with multiple strategies
    async enhancedSearch(query, options = {}) {
        const results = {
            torrents: [],
            direct: [],
            resolved: []
        };

        try {
            // Search torrents
            const torrentResults = await this.searchTorrents(query, options);
            results.torrents = torrentResults;

            // Search direct links if we have specific URLs
            if (query.urls && Array.isArray(query.urls)) {
                for (const url of query.urls) {
                    try {
                        const resolved = await this.resolveStreamingUrl(url, options);
                        results.resolved.push(resolved);
                    } catch (error) {
                        console.error(`Failed to resolve URL ${url}:`, error.message);
                    }
                }
            }

            return results;
        } catch (error) {
            console.error('Enhanced search error:', error);
            return results;
        }
    }

    // Get comprehensive statistics
    async getStats() {
        const torrentStats = this.torrentRegistry.getStats();
        const resolverStats = this.resolverRegistry.getStats();
        const cacheStats = this.getCacheStats();

        return {
            torrents: torrentStats,
            resolvers: resolverStats,
            cache: cacheStats,
            combined: {
                totalSources: torrentStats.total + resolverStats.total,
                enabledSources: torrentStats.enabled + resolverStats.enabled
            }
        };
    }

    // Check health of all systems
    async checkHealth() {
        const torrentHealth = await this.torrentRegistry.checkProvidersHealth();
        const resolverHealth = await this.resolverRegistry.healthCheck();

        return {
            torrents: torrentHealth,
            resolvers: resolverHealth,
            timestamp: new Date().toISOString()
        };
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
            language: options.language,
            includeTorrents: options.includeTorrents !== false,
            includeDirect: options.includeDirect !== false
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
        console.log('Enhanced scraper cache cleared');
    }

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

    // Export configuration
    exportConfig() {
        return {
            torrents: this.torrentRegistry.getProviderConfigs(),
            resolvers: this.resolverRegistry.getStats(),
            cache: this.getCacheStats()
        };
    }

    // Start cache cleanup
    startCacheCleanup() {
        setInterval(() => {
            this.cleanupCache();
        }, 60000); // Clean up every minute
    }

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
}

module.exports = EnhancedScraperManager;
