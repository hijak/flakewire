const BaseResolver = require('../BaseResolver');
const AllDebrid = require('../../debrid/allDebrid');

class DebridResolver extends BaseResolver {
    constructor() {
        super('Debrid Services', {
            domains: ['*'], // Universal resolver
            priority: 200,
            isUniversal: true,
            requiresAuth: true
        });
        this.debridManager = null;
    }

    setDebridManager(debridManager) {
        this.debridManager = debridManager;
    }

    async getMediaUrl(host, mediaId, options = {}) {
        // Integrate with AllDebrid service for URL unlocking
        try {
            if (mediaId.startsWith('magnet:')) {
                // Handle magnet links through debrid service
                return await this.handleMagnetLink(mediaId, options);
            } else if (mediaId.startsWith('http://') || mediaId.startsWith('https://')) {
                // Handle direct links through debrid service
                return await this.unrestrictLink(mediaId, options);
            } else {
                // Handle other formats
                return mediaId;
            }
        } catch (error) {
            console.error(`Debrid resolution failed:`, error.message);
            throw error;
        }
    }

    getUrl(host, mediaId) {
        // For debrid services, return the original URL
        return mediaId;
    }

    async handleMagnetLink(magnetLink, options = {}) {
        try {
            // Get AllDebrid provider from debrid manager
            if (!this.debridManager) {
                throw new Error('Debrid manager not available');
            }

            const allDebridProvider = this.debridManager.getProvider('alldebrid');
            if (!allDebridProvider) {
                throw new Error('AllDebrid provider not available');
            }

            console.log(`Adding magnet to AllDebrid: ${magnetLink.substring(0, 50)}...`);

            // Add magnet to AllDebrid
            const magnetData = await allDebridProvider.addMagnet(magnetLink);

            // Get streaming links
            const streamingData = await allDebridProvider.getStreamingLinks(magnetData.id);

            if (streamingData && streamingData.streamable && streamingData.links) {
                // Return the first available streaming link
                const videoLink = streamingData.links.find(link =>
                    link.filename && (link.filename.includes('.mp4') || link.filename.includes('.mkv'))
                );

                if (videoLink) {
                    return this.appendHeaders(videoLink.link, {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    });
                }
            }

            throw new Error('No streaming links available');
        } catch (error) {
            console.error('Magnet handling failed:', error.message);
            throw error;
        }
    }

    async unrestrictLink(url, options = {}) {
        try {
            // Get AllDebrid provider from debrid manager
            if (!this.debridManager) {
                throw new Error('Debrid manager not available');
            }

            const allDebridProvider = this.debridManager.getProvider('alldebrid');
            if (!allDebridProvider) {
                throw new Error('AllDebrid provider not available');
            }

            console.log(`Unlocking link with AllDebrid: ${url}`);

            // Unlock the link with AllDebrid
            const unlockedData = await allDebridProvider.unrestrictLink(url);

            if (unlockedData && unlockedData.download) {
                return this.appendHeaders(unlockedData.download, {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                });
            }

            throw new Error('Failed to unlock link');
        } catch (error) {
            console.error('Link unlocking failed:', error.message);
            throw error;
        }
    }

    getHostAndId(url) {
        // For universal resolver, return the URL as the media ID
        try {
            const urlObj = new URL(url);
            return {
                host: urlObj.hostname,
                mediaId: url
            };
        } catch (error) {
            return {
                host: null,
                mediaId: url
            };
        }
    }

    validUrl(url, host = null) {
        // Universal resolver accepts any URL
        return url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('magnet:'));
    }

    // Authentication methods
    async login() {
        // This would handle authentication with debrid services
        console.log('Debrid service authentication required');
        return false;
    }

    async checkAuthStatus() {
        // Check if authenticated with debrid services
        return false;
    }

    // Static methods for plugin identification
    static isUniversal() {
        return true;
    }

    static isPopup() {
        return true; // Debrid services often require user interaction for OAuth
    }
}

module.exports = DebridResolver;