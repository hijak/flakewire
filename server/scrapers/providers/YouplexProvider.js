const BaseProvider = require('./BaseProvider');
const cheerio = require('cheerio');

class YouplexProvider extends BaseProvider {
    constructor() {
        super('YouPlex', {
            baseURL: 'https://torrents.youplex.site',
            priority: 12,
            supportsMovies: true,
            supportsTV: true,
            minRequestInterval: 2000, // 2 seconds between requests
            minSeeders: 0
        });

        // Alternative mirrors if main site is down
        this.mirrors = [
            'https://torrents.youplex.site',
            'https://youplex.site',
            'https://www.youplex.site'
        ];
        this.currentMirrorIndex = 0;
    }

    async search(data) {
        try {
            const { title, year, type, season, episode } = data;

            console.log(`DEBUG: YouPlex searching for: ${title} (type: ${type})`);

            // Build search query - clean format (NO YEARS for YouPlex)
            let searchQuery = this.cleanSearchQuery(title);

            // Add season/episode info for TV shows
            if (type === 'tv' && season !== null && episode !== null) {
                searchQuery += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            } else if (type === 'tv' && season !== null) {
                searchQuery += ` S${season.toString().padStart(2, '0')}`;
            }

            // Note: YouPlex does NOT include years in search URLs
            // Example: https://torrents.youplex.site/search/the%20matrix/

            const searchURL = `${this.baseURL}/search/${encodeURIComponent(searchQuery)}/`;
            console.log(`DEBUG: YouPlex URL: ${searchURL}`);

            const response = await this.client.get(searchURL, {
                timeout: 15000,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Referer': this.baseURL,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            console.log(`DEBUG: YouPlex response status: ${response.status}`);
            const results = this.parseSearchResults(response.data, data);
            console.log(`DEBUG: YouPlex found ${results.length} results`);
            return results;

        } catch (error) {
            console.error('YouPlex search error:', error.message);

            // Try alternative mirrors
            if (this.currentMirrorIndex < this.mirrors.length - 1) {
                this.currentMirrorIndex++;
                this.baseURL = this.mirrors[this.currentMirrorIndex];
                console.log(`Trying YouPlex mirror: ${this.baseURL}`);
                return this.search(data); // Retry with next mirror
            }

            return [];
        }
    }

    parseSearchResults(html, searchData) {
        const $ = cheerio.load(html);
        const results = [];

        // YouPlex might use different CSS selectors - let's try common ones
        const selectors = [
            '.post-item',
            '.movie-item',
            '.torrent-item',
            '.item',
            'article',
            '.result',
            '.post'
        ];

        for (const selector of selectors) {
            $(selector).each((index, element) => {
                try {
                    const item = $(element);
                    const result = this.parseItem(item, searchData);
                    if (result && result.seeders >= this.minSeeders) {
                        results.push(result);
                    }
                } catch (error) {
                    console.error(`Error parsing YouPlex item with selector ${selector}:`, error.message);
                }
            });

            // If we found results with this selector, don't try others
            if (results.length > 0) {
                break;
            }
        }

        return results;
    }

    parseItem(item, searchData) {
        // Extract title and link
        const titleLink = item.find('h2 a, h3 a, .title a, .post-title a').first();
        const title = titleLink.text().trim();
        const detailLink = titleLink.attr('href');

        if (!title) {
            return null;
        }

        // Extract download/magnet links
        let magnetLink = null;
        let downloadLink = null;

        // Look for magnet links
        item.find('a').each((i, element) => {
            const link = $(element);
            const href = link.attr('href');
            if (href && href.startsWith('magnet:')) {
                magnetLink = href;
            } else if (href && (href.includes('.torrent') || href.includes('/download/'))) {
                downloadLink = href;
            }
        });

        const finalUrl = magnetLink || downloadLink;
        if (!finalUrl) {
            return null;
        }

        // Make sure the URL is absolute
        const absoluteUrl = finalUrl.startsWith('http') ? finalUrl : `${this.baseURL}${finalUrl}`;

        // Extract metadata from item content
        const metadata = this.extractMetadata(item);
        const seeders = metadata.seeders || 0;
        const leechers = metadata.leechers || 0;
        const size = metadata.size || 0;
        const sizeStr = metadata.sizeStr || '';
        const quality = metadata.quality || this.filters.detectQuality(title);

        // Check if this result matches our search criteria
        if (!this.isResultMatch(title, searchData)) {
            return null;
        }

        // Extract hash from magnet link
        let hash = '';
        if (magnetLink) {
            const hashMatch = magnetLink.match(/btih:([a-fA-F0-9]{40})/i);
            hash = hashMatch ? hashMatch[1].toLowerCase() : '';
        }

        return this.createResult({
            name: title,
            title: this.extractTitleFromName(title),
            year: this.extractYearFromName(title),
            quality: quality,
            size: size,
            sizeStr: sizeStr,
            seeders: seeders,
            leechers: leechers,
            hash: hash,
            url: absoluteUrl,
            magnet: magnetLink,
            type: this.determineContentType(title, searchData.type),
            language: 'en', // Default to English for YouPlex
            verified: seeders > 3, // Consider lightly seeded torrents as verified
            uploadedAt: metadata.uploadedAt || null,
            detailLink: detailLink ? `${this.baseURL}${detailLink}` : null,
            uploader: metadata.uploader || 'Unknown',
            category: this.determineCategory(title, searchData.type),
            info: `YouPlex • ${seeders} seeders`
        });
    }

    extractMetadata(item) {
        const metadata = {
            seeders: 0,
            leechers: 0,
            size: 0,
            sizeStr: '',
            quality: '',
            uploadedAt: null,
            uploader: 'Unknown'
        };

        // Try to extract information from common patterns
        const itemText = item.text();

        // Extract seeders/leechers from text
        const seederMatch = itemText.match(/seeders?\s*:?\s*(\d+)/i);
        if (seederMatch) {
            metadata.seeders = parseInt(seederMatch[1]);
        }

        const leecherMatch = itemText.match(/leechers?\s*:?\s*(\d+)/i);
        if (leecherMatch) {
            metadata.leechers = parseInt(leecherMatch[1]);
        }

        // Extract size
        const sizeMatch = itemText.match(/(\d+(?:\.\d+)?)\s*([KMGT]?B)/i);
        if (sizeMatch) {
            metadata.sizeStr = sizeMatch[0];
            metadata.size = this.filters.parseSize(metadata.sizeStr);
        }

        // Extract quality
        const qualityMatch = itemText.match(/\b(4K|1080p|720p|480p|2160p|HD|BluRay|BRRip|DVDRip|WEBRip|WEB-DL|HDTV)\b/i);
        if (qualityMatch) {
            metadata.quality = qualityMatch[1];
        }

        // Extract upload date
        const dateMatch = itemText.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            metadata.uploadedAt = dateMatch[1];
        }

        // Extract uploader
        const uploaderMatch = itemText.match(/by\s+(\w+)/i);
        if (uploaderMatch) {
            metadata.uploader = uploaderMatch[1];
        }

        return metadata;
    }

    isResultMatch(title, searchData) {
        // Check title match
        if (!this.filters.checkTitleMatch(
            searchData.title,
            title,
            searchData.year,
            searchData.aliases || []
        )) {
            return false;
        }

        // Check for undesirable content
        if (this.filters.hasUndesirableContent(title)) {
            return false;
        }

        return true;
    }

    determineContentType(title, searchType) {
        // Prioritize search type
        if (searchType === 'tv') {
            return 'tv';
        }
        if (searchType === 'movie') {
            return 'movie';
        }

        // Determine from title patterns
        const tvPatterns = /S\d{1,2}E\d{1,2}|Season|Episode|\d+x\d+/i;
        if (tvPatterns.test(title)) {
            return 'tv';
        }

        return 'movie';
    }

    determineCategory(title, searchType) {
        if (searchType === 'tv') {
            return 'TV Shows';
        }
        if (searchType === 'movie') {
            return 'Movies';
        }

        // Determine from title
        const tvPatterns = /S\d{1,2}E\d{1,2}|Season|Episode|\d+x\d+/i;
        if (tvPatterns.test(title)) {
            return 'TV Shows';
        }

        return 'Movies';
    }

    extractTitleFromName(fullName) {
        // Remove common patterns like quality, year, etc.
        return fullName
            .replace(/\d{4}/g, '')
            .replace(/\b(1080p|720p|480p|4K|HD|BluRay|BRRip|DVDRip|WEBRip|WEB-DL|HDTV|Cam|TS|SCR)\b/gi, '')
            .replace(/\b(S\d{1,2}E\d{1,2})\b/gi, '')
            .replace(/\[.*?\]/g, '') // Remove brackets content
            .replace(/\(.*?\)/g, '') // Remove parentheses content
            .replace(/[._-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    extractYearFromName(name) {
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }

    cleanSearchQuery(title) {
        return title
            .replace(/[,:]/g, '') // Remove colons and commas
            .replace(/\s+/g, ' ') // Normalize spaces
            .replace(/\s*:\s*/g, ' ') // Clean up colon spacing
            .trim();
    }

    // Override availability check to try multiple mirrors
    async isAvailable() {
        for (let i = 0; i < this.mirrors.length; i++) {
            try {
                const mirror = this.mirrors[i];
                const response = await this.client.get(mirror, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });

                if (response.status === 200) {
                    this.baseURL = mirror;
                    this.currentMirrorIndex = i;
                    console.log(`YouPlex available at: ${mirror}`);
                    return true;
                }
            } catch (error) {
                console.log(`YouPlex mirror ${this.mirrors[i]} not available:`, error.message);
                continue;
            }
        }

        console.error('All YouPlex mirrors are unavailable');
        return false;
    }
}

module.exports = YouplexProvider;