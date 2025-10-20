const axios = require('axios');

class BaseResolver {
    constructor(name, config = {}) {
        this.name = name;
        this.domains = config.domains || [];
        this.pattern = config.pattern || null;
        this.priority = config.priority || 999;
        this.headers = config.headers || {};
        this.userAgent = config.userAgent || this.getRandomUserAgent();
        this.timeout = config.timeout || 20000;
        this.isUniversal = config.isUniversal || false;
        this.isPopup = config.isPopup || false;
        this.requiresAuth = config.requiresAuth || false;
        this.supportsSubtitles = config.supportsSubtitles || false;

        // HTTP client instance
        this.client = axios.create({
            timeout: this.timeout,
            headers: {
                'User-Agent': this.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                ...this.headers
            }
        });
    }

    // Abstract methods - must be implemented by concrete resolvers
    async getMediaUrl(host, mediaId, options = {}) {
        throw new Error(`getMediaUrl must be implemented by ${this.name}`);
    }

    getUrl(host, mediaId) {
        throw new Error(`getUrl must be implemented by ${this.name}`);
    }

    // Optional methods with default implementations
    getHostAndId(url) {
        if (!this.pattern) {
            return { host: null, mediaId: null };
        }

        const match = url.match(this.pattern);
        if (!match) {
            return { host: null, mediaId: null };
        }

        return {
            host: match[1] || null,
            mediaId: match[2] || null
        };
    }

    validUrl(url, host = null) {
        // If this is a universal resolver, accept any URL
        if (this.isUniversal) {
            return true;
        }

        // Check if the host matches our supported domains
        const targetHost = host || new URL(url).hostname;
        return this.domains.some(domain =>
            targetHost.includes(domain) || domain.includes(targetHost)
        );
    }

    // Authentication methods
    async login() {
        if (!this.requiresAuth) {
            return true;
        }
        throw new Error(`Login not implemented for ${this.name}`);
    }

    async logout() {
        // Default implementation - no special cleanup needed
        return true;
    }

    // Utility methods
    getRandomUserAgent() {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:89.0) Gecko/20100101 Firefox/89.0'
        ];

        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    async makeRequest(url, options = {}) {
        try {
            const config = {
                ...options,
                headers: {
                    'Referer': url,
                    'Origin': new URL(url).origin,
                    ...options.headers
                }
            };

            const response = await this.client.get(url, config);
            return response.data;
        } catch (error) {
            console.error(`Request failed for ${url}:`, error.message);
            throw error;
        }
    }

    async makePostRequest(url, data, options = {}) {
        try {
            const config = {
                ...options,
                headers: {
                    'Referer': url,
                    'Origin': new URL(url).origin,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    ...options.headers
                }
            };

            const response = await this.client.post(url, data, config);
            return response.data;
        } catch (error) {
            console.error(`POST request failed for ${url}:`, error.message);
            throw error;
        }
    }

    // URL utilities
    decodeHtmlEntities(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    extractJsonFromScript(html, pattern) {
        const match = html.match(pattern);
        if (match && match[1]) {
            try {
                return JSON.parse(match[1]);
            } catch (error) {
                console.error('Failed to parse JSON from script:', error.message);
                return null;
            }
        }
        return null;
    }

    // Base64 and decoding utilities
    base64Decode(str) {
        try {
            return Buffer.from(str, 'base64').toString('utf8');
        } catch (error) {
            console.error('Base64 decode failed:', error.message);
            return str;
        }
    }

    // Source processing utilities
    appendHeaders(url, headers = {}) {
        if (Object.keys(headers).length === 0) {
            return url;
        }

        const separator = url.includes('?') ? '&' : '|';
        const headerString = Object.entries(headers)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join('&');

        return `${url}${separator}${headerString}`;
    }

    // Quality extraction
    extractQualityFromLabel(label) {
        const qualityPatterns = {
            '4K': /2160p|4k|ultrahd|uhd/i,
            '1080p': /1080p|full.?hd|fhd/i,
            '720p': /720p|hd|hdtv/i,
            '480p': /480p|sd|dvd/i,
            '360p': /360p/i,
            'CAM': /cam|ts|telesync|hqcam|hdts/i,
            'SCR': /scr|screener|dvdscr|hdscr/i,
            'WEB': /webdl|webrip|web-dl|web-rip/i
        };

        for (const [quality, pattern] of Object.entries(qualityPatterns)) {
            if (pattern.test(label)) {
                return quality;
            }
        }

        return 'Unknown';
    }

    // Resolver information
    getInfo() {
        return {
            name: this.name,
            domains: this.domains,
            priority: this.priority,
            isUniversal: this.isUniversal,
            isPopup: this.isPopup,
            requiresAuth: this.requiresAuth,
            supportsSubtitles: this.supportsSubtitles
        };
    }

    // Static methods for plugin identification
    static isUniversal() {
        return false;
    }

    static isPopup() {
        return false;
    }
}

module.exports = BaseResolver;