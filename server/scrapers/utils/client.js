const axios = require('axios');

class HTTPClient {
    constructor() {
        this.defaultOptions = {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        };
    }

    async request(url, options = {}) {
        try {
            const config = {
                ...this.defaultOptions,
                ...options,
                url: url,
                headers: {
                    ...this.defaultOptions.headers,
                    ...options.headers
                }
            };

            const response = await axios(config);
            return response;
        } catch (error) {
            console.error(`HTTP request failed for ${url}:`, error.message);
            throw error;
        }
    }

    async get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    async post(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            data: data
        });
    }

    // Method for making requests with cookies/session management
    async requestWithSession(url, options = {}) {
        const config = {
            ...options,
            withCredentials: true,
            jar: true // Enable cookie jar
        };

        return this.request(url, config);
    }

    // Method for rotating user agents
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

    // Method for proxy support (basic implementation)
    async requestWithProxy(url, proxyUrl, options = {}) {
        const config = {
            ...options,
            proxy: {
                host: new URL(proxyUrl).hostname,
                port: new URL(proxyUrl).port || 8080
            }
        };

        return this.request(url, config);
    }
}

module.exports = HTTPClient;