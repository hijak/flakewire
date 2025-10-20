const BaseResolver = require('./BaseResolver');
const SourceExtractor = require('./utils/SourceExtractor');

class GenericResolver extends BaseResolver {
    constructor(name, config = {}) {
        super(name, config);
        this.sourceExtractor = new SourceExtractor();
        this.patterns = config.patterns || [];
        this.genericPatterns = config.genericPatterns !== false;
        this.blacklist = config.blacklist || ['.mpd', '.m3u8', '.smil'];
        this.subtitles = config.subtitles || false;
    }

    async getMediaUrl(host, mediaId, options = {}) {
        try {
            const url = this.getUrl(host, mediaId);
            const html = await this.makeRequest(url);

            // Extract sources using configured patterns
            const sources = await this.sourceExtractor.scrapeSources(html, {
                patterns: this.patterns.length > 0 ? this.patterns : undefined,
                genericPatterns: this.genericPatterns,
                blacklist: this.blacklist,
                subtitles: options.subtitles || this.subtitles,
                referer: url
            });

            if (sources.length === 0) {
                throw new Error(`No sources found for ${url}`);
            }

            // Return the highest quality source by default
            const bestSource = this.selectBestSource(sources);
            return this.appendHeaders(bestSource.url, bestSource.headers);

        } catch (error) {
            console.error(`${this.name} resolution failed:`, error.message);
            throw error;
        }
    }

    selectBestSource(sources) {
        // Sort sources by quality and preference
        const sortedSources = sources.sort((a, b) => {
            // Prefer direct video files over embeds
            const aIsDirect = this.isDirectVideo(a.url);
            const bIsDirect = this.isDirectVideo(b.url);

            if (aIsDirect && !bIsDirect) return -1;
            if (!aIsDirect && bIsDirect) return 1;

            // Sort by quality
            const aQuality = this.getQualityScore(a.quality);
            const bQuality = this.getQualityScore(b.quality);

            return bQuality - aQuality;
        });

        return sortedSources[0];
    }

    isDirectVideo(url) {
        const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
        return videoExtensions.some(ext => url.toLowerCase().includes(ext));
    }

    getQualityScore(quality) {
        const qualityScores = {
            '4K': 100,
            '1080p': 80,
            '720p': 60,
            '480p': 40,
            '360p': 20,
            'CAM': 10,
            'SCR': 5,
            'Unknown': 0
        };

        return qualityScores[quality] || 0;
    }

    getUrl(host, mediaId) {
        // Default URL construction - can be overridden by specific resolvers
        const protocol = 'https://';
        return `${protocol}${host}/${mediaId}`;
    }
}

module.exports = GenericResolver;