const cheerio = require('cheerio');

class SourceExtractor {
    constructor() {
        // Common patterns for source extraction
        this.genericPatterns = [
            // JWPlayer style
            /["']?file\s*["']?\s*[:=]\s*["']([^"']+)(?:["']?\s*,\s*["']?label\s*["']?\s*[:=]\s*["']([^"']+))?/gi,
            // Video.js style
            /["']?src\s*["']?\s*[:=]\s*["']([^"']+)(?:["']?\s*,\s*["']?type\s*["']?\s*[:=]\s*["'][^"']*["'])?/gi,
            // Sources array
            /sources\s*:\s*\[\s*\{[^}]*["']?(?:file|src)\s*["']?\s*[:=]\s*["']([^"']+)/gi,
            // Direct URL patterns
            /["']?(?:file|src|url|video)\s*["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:mp4|avi|mkv|mov|wmv|flv|webm|m3u8|mpd)[^"']*)/gi,
            // Embed patterns
            /["']?(?:embed|iframe|player)\s*["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi
        ];

        // Additional patterns for specific players
        this.specificPatterns = [
            // Clappr player
            /sources\s*:\s*\[\s*\{\s*["']?(?:file|src)\s*["']?\s*[:=]\s*["']([^"']+)/gi,
            // Flowplayer
            /clip\s*:\s*\{\s*["']?(?:file|src|url)\s*["']?\s*[:=]\s*["']([^"']+)/gi,
            // VideoJS with quality
            /{\s*["']?src\s*["']?\s*[:=]\s*["']([^"']+)\s*,\s*["']?label\s*["']?\s*[:=]\s*["']([^"']+)\s*,\s*["']?type\s*["']?\s*[:=]\s*["'][^"']*["']/gi,
            // Simple object notation
            /\{[^}]*["']?(?:file|src|url|video)\s*["']?\s*[:=]\s*["']([^"']+)[^}]*\}/gi,
            // Function calls with URL parameter
            /\w+\s*\(\s*["'](https?:\/\/[^"']+)["']/gi
        ];

        // Regex for extracting quality labels
        this.qualityPatterns = [
            /(\d+)p/i,
            /(4K|UHD|UltraHD)/i,
            /(HD|FHD|FullHD)/i,
            /(SD|DVD)/i,
            /(CAM|TS|SCR)/i
        ];
    }

    async scrapeSources(html, options = {}) {
        const {
            patterns = null,
            genericPatterns = true,
            blacklist = ['.mpd', '.m3u8', '.smil'],
            subtitles = false,
            referer = null,
            minSources = 1
        } = options;

        const sources = [];
        const $ = cheerio.load(html);

        // Use custom patterns if provided, otherwise use defaults
        const patternsToUse = patterns || [
            ...(genericPatterns ? this.genericPatterns : []),
            ...this.specificPatterns
        ];

        // Extract sources using regex patterns
        for (const pattern of patternsToUse) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const url = this.cleanUrl(match[1] || match[2]);
                if (url && this.isValidUrl(url) && !this.isBlacklisted(url, blacklist)) {
                    const label = match[2] || this.extractLabelFromUrl(url);
                    const quality = this.extractQualityFromLabel(label);

                    sources.push({
                        url: url,
                        label: label,
                        quality: quality,
                        headers: referer ? { Referer: referer } : {},
                        type: this.getContentType(url)
                    });
                }
            }
        }

        // Look for direct video links in the DOM
        this.extractVideoLinks($, sources, referer);

        // Look for embed/iframe elements
        this.extractEmbedElements($, sources, referer);

        // Look for script tags with sources
        this.extractFromScripts($, sources, referer);

        // Extract subtitles if requested
        if (subtitles) {
            await this.extractSubtitles($, sources, referer);
        }

        // Remove duplicates and sort
        const uniqueSources = this.removeDuplicates(sources);
        const sortedSources = this.sortSources(uniqueSources);

        return sortedSources.slice(0, minSources > 0 ? undefined : minSources);
    }

    cleanUrl(url) {
        if (!url) return null;

        // Remove backslashes and extra quotes
        let cleaned = url.replace(/\\/, '').trim();

        // Remove surrounding quotes if present
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.slice(1, -1);
        } else if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
            cleaned = cleaned.slice(1, -1);
        }

        // Remove HTML entities
        cleaned = cleaned.replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        return cleaned;
    }

    isValidUrl(url) {
        try {
            new URL(url);
            return url.startsWith('http://') || url.startsWith('https://');
        } catch {
            return false;
        }
    }

    isBlacklisted(url, blacklist) {
        return blacklist.some(extension =>
            url.toLowerCase().includes(extension.toLowerCase())
        );
    }

    extractLabelFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();

            if (filename) {
                // Extract quality from filename
                const qualityMatch = filename.match(/(\d+)p|4K|UHD|HD|SD|CAM|TS|SCR/i);
                if (qualityMatch) {
                    return qualityMatch[0];
                }
            }

            return filename || 'Unknown';
        } catch {
            return 'Unknown';
        }
    }

    extractQualityFromLabel(label) {
        if (!label) return 'Unknown';

        for (const pattern of this.qualityPatterns) {
            const match = label.match(pattern);
            if (match) {
                const quality = match[0];
                // Normalize quality names
                if (quality === 'HD' || quality === 'FHD') return '720p';
                if (quality === '4K' || quality === 'UHD') return '4K';
                return quality;
            }
        }

        return 'Unknown';
    }

    getContentType(url) {
        const extension = url.split('.').pop()?.toLowerCase();

        const videoTypes = {
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'ogg': 'video/ogg',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime',
            'wmv': 'video/x-ms-wmv',
            'flv': 'video/x-flv',
            'mkv': 'video/x-matroska',
            'm4v': 'video/mp4',
            '3gp': 'video/3gpp'
        };

        const playlistTypes = {
            'm3u8': 'application/x-mpegURL',
            'mpd': 'application/dash+xml'
        };

        return videoTypes[extension] || playlistTypes[extension] || 'application/octet-stream';
    }

    extractVideoLinks($, sources, referer) {
        $('a[href*="mp4"], a[href*="avi"], a[href*="mkv"], a[href*="mov"]').each((i, element) => {
            const url = $(element).attr('href');
            if (url && !sources.some(s => s.url === url)) {
                sources.push({
                    url: this.cleanUrl(url),
                    label: $(element).text() || this.extractLabelFromUrl(url),
                    quality: this.extractQualityFromLabel($(element).text()),
                    headers: referer ? { Referer: referer } : {},
                    type: this.getContentType(url)
                });
            }
        });
    }

    extractEmbedElements($, sources, referer) {
        $('iframe[src], embed[src], video source').each((i, element) => {
            const url = $(element).attr('src') || $(element).attr('data-src');
            if (url && !sources.some(s => s.url === url)) {
                sources.push({
                    url: this.cleanUrl(url),
                    label: $(element).attr('title') || this.extractLabelFromUrl(url),
                    quality: this.extractQualityFromLabel($(element).attr('title') || ''),
                    headers: referer ? { Referer: referer } : {},
                    type: this.getContentType(url)
                });
            }
        });
    }

    extractFromScripts($, sources, referer) {
        $('script').each((i, element) => {
            const scriptContent = $(element).html() || '';

            // Look for JSON data in scripts
            const jsonMatch = scriptContent.match(/(?:sources|video|file)\s*:\s*(\[[^\]]+\])/i);
            if (jsonMatch) {
                try {
                    const data = JSON.parse(jsonMatch[1]);
                    if (Array.isArray(data)) {
                        data.forEach(item => {
                            const url = item.file || item.src || item.url;
                            if (url && !sources.some(s => s.url === url)) {
                                sources.push({
                                    url: this.cleanUrl(url),
                                    label: item.label || item.title,
                                    quality: this.extractQualityFromLabel(item.label || item.title),
                                    headers: referer ? { Referer: referer } : {},
                                    type: this.getContentType(url)
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.error('Failed to parse JSON from script:', error.message);
                }
            }

            // Apply regex patterns to script content
            const patternsToUse = [...this.genericPatterns, ...this.specificPatterns];
            for (const pattern of patternsToUse) {
                const matches = scriptContent.matchAll(pattern);
                for (const match of matches) {
                    const url = this.cleanUrl(match[1] || match[2]);
                    if (url && this.isValidUrl(url) && !sources.some(s => s.url === url)) {
                        const label = match[2] || this.extractLabelFromUrl(url);
                        sources.push({
                            url: url,
                            label: label,
                            quality: this.extractQualityFromLabel(label),
                            headers: referer ? { Referer: referer } : {},
                            type: this.getContentType(url)
                        });
                    }
                }
            }
        });
    }

    async extractSubtitles($, sources, referer) {
        $('track[src][kind="subtitles"]').each((i, element) => {
            const url = $(element).attr('src');
            const label = $(element).attr('label');
            const lang = $(element).attr('srclang') || 'unknown';

            if (url && (url.endsWith('.vtt') || url.endsWith('.srt'))) {
                // Add subtitle to each source or create subtitle sources
                const subtitle = {
                    url: this.cleanUrl(url),
                    label: label || `${lang} subtitles`,
                    language: lang,
                    headers: referer ? { Referer: referer } : {},
                    type: 'subtitle'
                };

                // Add subtitle to existing sources or create new subtitle source
                if (sources.length > 0) {
                    sources[0].subtitles = sources[0].subtitles || [];
                    sources[0].subtitles.push(subtitle);
                }
            }
        });
    }

    removeDuplicates(sources) {
        const seen = new Set();
        return sources.filter(source => {
            const key = source.url;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    sortSources(sources) {
        return sources.sort((a, b) => {
            // Sort by quality score
            const aScore = this.getQualityScore(a.quality);
            const bScore = this.getQualityScore(b.quality);

            if (aScore !== bScore) {
                return bScore - aScore;
            }

            // Prefer direct video files
            const aIsDirect = this.isDirectVideoFile(a.url);
            const bIsDirect = this.isDirectVideoFile(b.url);

            if (aIsDirect && !bIsDirect) return -1;
            if (!aIsDirect && bIsDirect) return 1;

            // Sort by label preference
            return a.label.localeCompare(b.label);
        });
    }

    getQualityScore(quality) {
        const scores = {
            '4K': 100,
            '2160p': 100,
            '1080p': 80,
            '720p': 60,
            '480p': 40,
            '360p': 20,
            'HD': 60,
            'SD': 40,
            'CAM': 10,
            'TS': 5,
            'SCR': 5,
            'Unknown': 0
        };

        return scores[quality] || 0;
    }

    isDirectVideoFile(url) {
        const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'];
        return videoExtensions.some(ext => url.toLowerCase().includes(ext));
    }
}

module.exports = SourceExtractor;