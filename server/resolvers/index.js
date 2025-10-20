const PluginRegistry = require('./PluginRegistry');

// Create and export a singleton instance
const resolverRegistry = new PluginRegistry();

// Export the registry instance and related utilities
module.exports = {
    registry: resolverRegistry,
    PluginRegistry,
    // Convenience methods
    async initialize() {
        await resolverRegistry.initialize();
        return resolverRegistry;
    },

    async resolveUrl(url, options = {}) {
        await resolverRegistry.initialize();
        return await resolverRegistry.resolveUrl(url, options);
    },

    findResolver(url) {
        return resolverRegistry.findResolver(url);
    },

    getStats() {
        return resolverRegistry.getStats();
    },

    async healthCheck() {
        return await resolverRegistry.healthCheck();
    }
};