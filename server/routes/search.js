const express = require('express');
const router = express.Router();
const ScraperManager = require('../scrapers/ScraperManager');
const PosterService = require('../services/imdbService');
const SecureStorage = require('../services/secureStorage');

// Initialize services
const secureStorage = new SecureStorage();
const scraperManager = new ScraperManager();
const posterService = new PosterService(secureStorage);
scraperManager.startCacheCleanup();

// Search endpoint - main search functionality
router.get('/', async (req, res) => {
    try {
        const {
            q: query,
            type = 'movie',
            year,
            season,
            episode,
            imdb,
            quality,
            minSeeders = 0,
            language = 'en',
            maxResults = 50,
            provider,
            timeout = 15000,
            includeSuggestions = false,
            allowPartial = true
        } = req.query;

        // Validate required parameters
        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                error: 'Search query is required',
                message: 'Please provide a search term using the "q" parameter'
            });
        }

        // Build search options
        const searchOptions = {
            type,
            year: year ? parseInt(year) : null,
            season: season ? parseInt(season) : null,
            episode: episode ? parseInt(episode) : null,
            imdb: imdb || null,
            quality: quality || null,
            minSeeders: parseInt(minSeeders),
            language,
            maxResults: parseInt(maxResults),
            timeout: parseInt(timeout),
            includeSuggestions: includeSuggestions === 'true',
            allowPartial: allowPartial !== 'false'
        };

        console.log(`Search request: ${query} (${type})`);

        let results;
        if (provider) {
            // Search specific provider
            results = await scraperManager.searchProvider(provider, query, searchOptions);
        } else {
            // Search all providers
            results = await scraperManager.search(query, searchOptions);
        }

        // Add metadata to response
        const response = {
            query: query.trim(),
            type: searchOptions.type,
            results: results,
            count: results.length,
            searchOptions: searchOptions,
            timestamp: new Date().toISOString()
        };

        // Add provider stats if requested
        if (req.query.includeStats === 'true') {
            response.stats = scraperManager.getStats();
        }

        res.json(response);

    } catch (error) {
        console.error('Search API error:', error);
        res.status(500).json({
            error: 'Search failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Enhanced search with media metadata (for frontend)
router.get('/media', async (req, res) => {
    try {
        const {
            q: query,
            type = 'movie',
            maxResults = 20
        } = req.query;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                error: 'Search query is required',
                message: 'Please provide a search term using the "q" parameter'
            });
        }

        // Use OMDb-backed search via PosterService
        const results = await posterService.searchMedia(query.trim(), type, parseInt(maxResults));

        res.json({
            query: query.trim(),
            type,
            results,
            count: results.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Media search API error:', error);
        res.status(500).json({
            error: 'Media search failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Enhanced search with multiple strategies
router.get('/enhanced', async (req, res) => {
    try {
        const {
            q: query,
            type = 'movie',
            includeSuggestions = true,
            allowPartial = true,
            ...otherOptions
        } = req.query;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                error: 'Search query is required',
                message: 'Please provide a search term using the "q" parameter'
            });
        }

        const searchOptions = {
            type,
            includeSuggestions: includeSuggestions === 'true',
            allowPartial: allowPartial !== 'false',
            ...otherOptions
        };

        console.log(`Enhanced search request: ${query} (${type})`);

        const results = await scraperManager.enhancedSearch(query, searchOptions);

        const response = {
            query: query.trim(),
            type: searchOptions.type,
            results: results,
            totalResults: results.exact.length + results.partial.length,
            timestamp: new Date().toISOString()
        };

        res.json(response);

    } catch (error) {
        console.error('Enhanced search API error:', error);
        res.status(500).json({
            error: 'Enhanced search failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get suggestions
router.get('/suggestions', async (req, res) => {
    try {
        const { q: query, type = 'movie', limit = 10 } = req.query;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({
                error: 'Search query is required for suggestions'
            });
        }

        const suggestions = await scraperManager.getSuggestions(query, {
            type,
            maxResults: parseInt(limit)
        });

        res.json({
            query: query.trim(),
            type,
            suggestions,
            count: suggestions.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Suggestions API error:', error);
        res.status(500).json({
            error: 'Failed to get suggestions',
            message: error.message
        });
    }
});

// Get available providers
router.get('/providers', (req, res) => {
    try {
        const providers = scraperManager.getProviders();
        const stats = scraperManager.getStats();

        res.json({
            providers,
            stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Providers API error:', error);
        res.status(500).json({
            error: 'Failed to get providers',
            message: error.message
        });
    }
});

// Check providers health
router.get('/health', async (req, res) => {
    try {
        const health = await scraperManager.checkHealth();

        res.json({
            health,
            cacheStats: scraperManager.getCacheStats(),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Health check API error:', error);
        res.status(500).json({
            error: 'Health check failed',
            message: error.message
        });
    }
});

// Enable/disable provider
router.post('/providers/:name/toggle', async (req, res) => {
    try {
        const { name } = req.params;
        const { enabled } = req.body;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'enabled field must be a boolean'
            });
        }

        let success;
        if (enabled) {
            success = await scraperManager.enableProvider(name);
        } else {
            success = await scraperManager.disableProvider(name);
        }

        if (success) {
            res.json({
                message: `Provider ${name} ${enabled ? 'enabled' : 'disabled'} successfully`,
                provider: name,
                enabled,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({
                error: 'Provider not found',
                message: `Provider ${name} not found or could not be ${enabled ? 'enabled' : 'disabled'}`
            });
        }

    } catch (error) {
        console.error('Provider toggle API error:', error);
        res.status(500).json({
            error: 'Failed to toggle provider',
            message: error.message
        });
    }
});

// Clear cache
router.post('/cache/clear', (req, res) => {
    try {
        scraperManager.clearCache();
        res.json({
            message: 'Cache cleared successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Cache clear API error:', error);
        res.status(500).json({
            error: 'Failed to clear cache',
            message: error.message
        });
    }
});

// Get cache statistics
router.get('/cache/stats', (req, res) => {
    try {
        const cacheStats = scraperManager.getCacheStats();
        res.json({
            cache: cacheStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Cache stats API error:', error);
        res.status(500).json({
            error: 'Failed to get cache statistics',
            message: error.message
        });
    }
});

// Search by IMDB ID
router.get('/imdb/:imdbId', async (req, res) => {
    try {
        const { imdbId } = req.params;
        const {
            type = 'movie',
            quality,
            maxResults = 20,
            minSeeders = 0
        } = req.query;

        if (!imdbId || !/^tt\d+$/.test(imdbId)) {
            return res.status(400).json({
                error: 'Invalid IMDB ID',
                message: 'IMDB ID must be in format tt1234567'
            });
        }

        const searchOptions = {
            imdb: imdbId,
            type,
            quality,
            maxResults: parseInt(maxResults),
            minSeeders: parseInt(minSeeders)
        };

        console.log(`IMDB search request: ${imdbId} (${type})`);

        const results = await scraperManager.search({ imdb: imdbId }, searchOptions);

        res.json({
            imdbId,
            type,
            results,
            count: results.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('IMDB search API error:', error);
        res.status(500).json({
            error: 'IMDB search failed',
            message: error.message
        });
    }
});

module.exports = router;
