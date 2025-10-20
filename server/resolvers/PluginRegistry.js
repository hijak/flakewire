const fs = require('fs');
const path = require('path');

class PluginRegistry {
    constructor() {
        this.resolvers = new Map();
        this.universalResolvers = new Map();
        this.domainResolvers = new Map();
        this.priorityQueue = [];
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) {
            return;
        }

        await this.loadPlugins();
        this.buildPriorityQueue();
        this.initialized = true;

        console.log(`PluginRegistry initialized with ${this.resolvers.size} resolvers`);
        console.log(`Universal resolvers: ${this.universalResolvers.size}`);
        console.log(`Domain-specific resolvers: ${this.domainResolvers.size}`);
    }

    async loadPlugins() {
        const pluginsDir = path.join(__dirname, 'plugins');

        // Ensure plugins directory exists
        if (!fs.existsSync(pluginsDir)) {
            fs.mkdirSync(pluginsDir, { recursive: true });
            return;
        }

        try {
            const pluginFiles = fs.readdirSync(pluginsDir)
                .filter(file => file.endsWith('.js') && !file.startsWith('.'));

            for (const file of pluginFiles) {
                try {
                    const pluginPath = path.join(pluginsDir, file);
                    const PluginClass = require(pluginPath);

                    // Handle both default exports and direct exports
                    const Resolver = PluginClass.default || PluginClass;

                    if (typeof Resolver === 'function') {
                        const instance = new Resolver();
                        this.registerResolver(instance);
                    } else if (typeof Resolver === 'object' && Resolver.name) {
                        // Handle cases where the plugin exports a pre-configured instance
                        this.registerResolver(Resolver);
                    } else {
                        console.warn(`Invalid plugin format in ${file}: expected function or object`);
                    }
                } catch (error) {
                    console.error(`Failed to load plugin ${file}:`, error.message);
                }
            }
        } catch (error) {
            console.error('Error loading plugins:', error.message);
        }
    }

    registerResolver(resolver) {
        if (!resolver || !resolver.name) {
            console.warn('Invalid resolver: missing name property');
            return false;
        }

        const name = resolver.name.toLowerCase();

        // Check if resolver already exists
        if (this.resolvers.has(name)) {
            console.warn(`Resolver ${name} already exists, skipping`);
            return false;
        }

        // Validate resolver interface
        if (!this.validateResolver(resolver)) {
            console.warn(`Resolver ${name} does not implement required interface`);
            return false;
        }

        this.resolvers.set(name, resolver);

        // Register in specialized maps
        if (resolver.isUniversal) {
            this.universalResolvers.set(name, resolver);
        }

        // Register domain mappings
        if (resolver.domains && Array.isArray(resolver.domains)) {
            resolver.domains.forEach(domain => {
                if (!this.domainResolvers.has(domain)) {
                    this.domainResolvers.set(domain, []);
                }
                this.domainResolvers.get(domain).push(resolver);
            });
        }

        console.log(`Registered resolver: ${name}`);
        return true;
    }

    validateResolver(resolver) {
        // Check required methods
        const requiredMethods = ['getMediaUrl', 'getUrl'];
        for (const method of requiredMethods) {
            if (typeof resolver[method] !== 'function') {
                console.warn(`Resolver ${resolver.name} missing required method: ${method}`);
                return false;
            }
        }

        // Check optional but recommended methods
        const recommendedMethods = ['validUrl', 'getHostAndId'];
        for (const method of recommendedMethods) {
            if (typeof resolver[method] !== 'function') {
                console.warn(`Resolver ${resolver.name} missing recommended method: ${method}`);
            }
        }

        return true;
    }

    buildPriorityQueue() {
        // Sort resolvers by priority (lower number = higher priority)
        this.priorityQueue = Array.from(this.resolvers.values())
            .sort((a, b) => a.priority - b.priority);
    }

    findResolver(url, host = null) {
        const targetHost = host || (url ? new URL(url).hostname : null);

        if (!targetHost) {
            return null;
        }

        // First try to find exact domain match
        for (const [domain, resolvers] of this.domainResolvers) {
            if (targetHost.includes(domain) || domain.includes(targetHost)) {
                // Return the highest priority resolver for this domain
                return resolvers.sort((a, b) => a.priority - b.priority)[0];
            }
        }

        // Fall back to checking all resolvers
        for (const resolver of this.priorityQueue) {
            if (resolver.validUrl && resolver.validUrl(url, targetHost)) {
                return resolver;
            }
        }

        // Finally, try universal resolvers
        if (this.universalResolvers.size > 0) {
            return this.universalResolvers.values().next().value;
        }

        return null;
    }

    getResolver(name) {
        return this.resolvers.get(name.toLowerCase());
    }

    getAllResolvers() {
        return Array.from(this.resolvers.values());
    }

    getUniversalResolvers() {
        return Array.from(this.universalResolvers.values());
    }

    getDomainResolvers(domain) {
        return this.domainResolvers.get(domain) || [];
    }

    async resolveUrl(url, options = {}) {
        const resolver = this.findResolver(url);
        if (!resolver) {
            throw new Error(`No resolver found for URL: ${url}`);
        }

        const { host, mediaId } = resolver.getHostAndId ?
            resolver.getHostAndId(url) :
            this.extractHostAndId(url);

        if (!host || !mediaId) {
            throw new Error(`Could not extract host and media ID from URL: ${url}`);
        }

        try {
            const resolvedUrl = await resolver.getMediaUrl(host, mediaId, options);
            return {
                url: resolvedUrl,
                resolver: resolver.name,
                host: host,
                mediaId: mediaId
            };
        } catch (error) {
            console.error(`Resolution failed with ${resolver.name}:`, error.message);
            throw error;
        }
    }

    extractHostAndId(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname;
            const pathname = urlObj.pathname;

            // Basic extraction logic - can be enhanced
            const pathParts = pathname.split('/').filter(part => part);
            const mediaId = pathParts[pathParts.length - 1] || pathname;

            return {
                host: hostname,
                mediaId: mediaId
            };
        } catch (error) {
            return {
                host: null,
                mediaId: null
            };
        }
    }

    // Plugin management methods
    enableResolver(name) {
        const resolver = this.getResolver(name);
        if (resolver) {
            resolver.enabled = true;
            return true;
        }
        return false;
    }

    disableResolver(name) {
        const resolver = this.getResolver(name);
        if (resolver) {
            resolver.enabled = false;
            return true;
        }
        return false;
    }

    getEnabledResolvers() {
        return this.getAllResolvers().filter(resolver => resolver.enabled !== false);
    }

    // Statistics and information
    getStats() {
        const resolvers = this.getAllResolvers();
        const enabled = resolvers.filter(r => r.enabled !== false);
        const universal = resolvers.filter(r => r.isUniversal);
        const requiresAuth = resolvers.filter(r => r.requiresAuth);
        const supportsSubtitles = resolvers.filter(r => r.supportsSubtitles);

        return {
            total: resolvers.length,
            enabled: enabled.length,
            disabled: resolvers.length - enabled.length,
            universal: universal.length,
            requiresAuth: requiresAuth.length,
            supportsSubtitles: supportsSubtitles.length,
            domainsCovered: this.domainResolvers.size,
            resolvers: resolvers.map(r => ({
                name: r.name,
                domains: r.domains,
                priority: r.priority,
                enabled: r.enabled !== false,
                isUniversal: r.isUniversal,
                requiresAuth: r.requiresAuth,
                supportsSubtitles: r.supportsSubtitles
            }))
        };
    }

    // Health check
    async healthCheck() {
        const results = [];

        for (const resolver of this.getAllResolvers()) {
            try {
                // Basic health check - try to access a known domain
                const testDomain = resolver.domains && resolver.domains.length > 0 ?
                    resolver.domains[0] : null;

                let status = 'unknown';
                let error = null;

                if (testDomain) {
                    try {
                        const testUrl = `https://${testDomain}`;
                        const response = await fetch(testUrl, {
                            method: 'HEAD',
                            timeout: 5000
                        });
                        status = response.ok ? 'healthy' : 'unhealthy';
                    } catch (err) {
                        status = 'unreachable';
                        error = err.message;
                    }
                } else {
                    status = 'no_test_domain';
                }

                results.push({
                    name: resolver.name,
                    status: status,
                    error: error,
                    domains: resolver.domains,
                    priority: resolver.priority,
                    enabled: resolver.enabled !== false
                });
            } catch (error) {
                results.push({
                    name: resolver.name,
                    status: 'error',
                    error: error.message,
                    domains: resolver.domains,
                    priority: resolver.priority,
                    enabled: resolver.enabled !== false
                });
            }
        }

        return results;
    }

    // Reload plugins (useful for development)
    async reloadPlugins() {
        // Clear current resolvers
        this.resolvers.clear();
        this.universalResolvers.clear();
        this.domainResolvers.clear();
        this.priorityQueue = [];

        // Clear require cache for plugins
        const pluginsDir = path.join(__dirname, 'plugins');
        const pluginFiles = fs.readdirSync(pluginsDir)
            .filter(file => file.endsWith('.js'));

        for (const file of pluginFiles) {
            const pluginPath = path.join(pluginsDir, file);
            delete require.cache[require.resolve(pluginPath)];
        }

        // Reload plugins
        await this.loadPlugins();
        this.buildPriorityQueue();

        console.log('Plugins reloaded successfully');
    }
}

module.exports = PluginRegistry;