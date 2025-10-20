const YTSProvider = require('./YTSProvider');
const PirateBayProvider = require('./PirateBayProvider');
const EZTVProvider = require('./EZTVProvider');
const TorrentDownloadsProvider = require('./TorrentDownloadsProvider');
const YouplexProvider = require('./YouplexProvider');
const ContentFilters = require('../utils/filters');

class ProviderRegistry {
    constructor() {
        this.providers = new Map();
        this.filters = new ContentFilters();
        this.initializeProviders();
    }

    initializeProviders() {
        // Register all available providers
        this.registerProvider(new YTSProvider());
        this.registerProvider(new PirateBayProvider());
        this.registerProvider(new TorrentDownloadsProvider());
        this.registerProvider(new YouplexProvider());
        this.registerProvider(new EZTVProvider());

        console.log(`Initialized ${this.providers.size} scraper providers (ETTV, Nyaa, HD-Encode, Mixdrop, RMZ, Streamtape, Upstream, VOE removed - only YTS, PirateBay, TorrentDownloads, YouPlex, EZTV active)`);
    }

    registerProvider(provider) {
        if (provider.name) {
            this.providers.set(provider.name.toLowerCase(), provider);
            console.log(`Registered provider: ${provider.name}`);
        }
    }

    getProvider(name) {
        return this.providers.get(name.toLowerCase());
    }

    getAllProviders() {
        return Array.from(this.providers.values());
    }

    getEnabledProviders() {
        return this.getAllProviders().filter(provider => provider.enabled);
    }

    getProvidersByType(type) {
        return this.getEnabledProviders().filter(provider => {
            if (type === 'movie') return provider.supportsMovies;
            if (type === 'tv') return provider.supportsTV;
            return true;
        });
    }

    enableProvider(name) {
        const provider = this.getProvider(name);
        if (provider) {
            provider.setEnabled(true);
            console.log(`Enabled provider: ${name}`);
            return true;
        }
        return false;
    }

    disableProvider(name) {
        const provider = this.getProvider(name);
        if (provider) {
            provider.setEnabled(false);
            console.log(`Disabled provider: ${name}`);
            return true;
        }
        return false;
    }

    getProviderConfigs() {
        return this.getAllProviders().map(provider => provider.getConfig());
    }

    async checkProvidersHealth() {
        const healthChecks = await Promise.allSettled(
            this.getAllProviders().map(async provider => ({
                name: provider.name,
                enabled: provider.enabled,
                available: await provider.isAvailable()
            }))
        );

        return healthChecks.map(result =>
            result.status === 'fulfilled' ? result.value : {
                name: result.reason?.name || 'Unknown',
                enabled: false,
                available: false,
                error: result.reason?.message
            }
        );
    }

    // Search across all providers
    async searchAllProviders(data, options = {}) {
        const {
            maxResults = 50,
            minSeeders = 0,
            quality = null,
            language = 'en',
            timeout = 15000
        } = options;

        // Get relevant providers based on content type
        const providers = this.getProvidersByType(data.type || 'movie');

        if (providers.length === 0) {
            console.warn('No providers available for search');
            return [];
        }

        console.log(`Searching across ${providers.length} providers for: ${data.title}`);

        // Create search promises with timeout
        const searchPromises = providers.map(async provider => {
            try {
                const result = await Promise.race([
                    provider.safeSearch(data),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Search timeout')), timeout)
                    )
                ]);
                return { provider: provider.name, results: result };
            } catch (error) {
                console.error(`Provider ${provider.name} failed:`, error.message);
                return { provider: provider.name, results: [], error: error.message };
            }
        });

        // Execute all searches in parallel
        const searchResults = await Promise.allSettled(searchPromises);

        // Collect and flatten all results
        const allResults = [];
        for (const searchResult of searchResults) {
            if (searchResult.status === 'fulfilled') {
                const { provider, results, error } = searchResult.value;
                if (results && results.length > 0) {
                    console.log(`${provider}: Found ${results.length} results`);
                    allResults.push(...results);
                } else if (error) {
                    console.warn(`${provider}: ${error}`);
                }
            } else {
                console.error('Search promise rejected:', searchResult.reason.message);
            }
        }

        console.log(`Total raw results: ${allResults.length}`);

        // Apply filters and sorting
        const filteredResults = this.filters.filterResults(allResults, {
            minSeeders,
            quality,
            language,
            maxSize: options.maxSize
        });

        const sortedResults = this.filters.sortResults(filteredResults);

        // Limit results
        const finalResults = sortedResults.slice(0, maxResults);

        console.log(`Final filtered results: ${finalResults.length}`);

        return finalResults;
    }

    // Search specific provider
    async searchProvider(providerName, data, options = {}) {
        const provider = this.getProvider(providerName);
        if (!provider) {
            throw new Error(`Provider not found: ${providerName}`);
        }

        if (!provider.enabled) {
            throw new Error(`Provider is disabled: ${providerName}`);
        }

        return await provider.safeSearch(data, options);
    }

    // Get statistics
    getStats() {
        const providers = this.getAllProviders();
        return {
            total: providers.length,
            enabled: providers.filter(p => p.enabled).length,
            disabled: providers.filter(p => !p.enabled).length,
            supportsMovies: providers.filter(p => p.supportsMovies).length,
            supportsTV: providers.filter(p => p.supportsTV).length,
            providers: providers.map(p => ({
                name: p.name,
                enabled: p.enabled,
                supportsMovies: p.supportsMovies,
                supportsTV: p.supportsTV,
                priority: p.priority
            }))
        };
    }
}

module.exports = ProviderRegistry;
