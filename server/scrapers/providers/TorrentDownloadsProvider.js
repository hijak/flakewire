const BaseProvider = require('./BaseProvider');
const cheerio = require('cheerio');

class TorrentDownloadsProvider extends BaseProvider {
    constructor() {
        super('TorrentDownloads', {
            baseURL: 'https://www.torrentdownloads.pro',
            priority: 8,
            supportsMovies: true,
            supportsTV: true,
            minRequestInterval: 3000, // 3 seconds between requests
            minSeeders: 0
        });

        // Alternative mirrors if main site is down
        this.mirrors = [
            'https://www.torrentdownloads.pro',
            'https://torrentdownloads.pro',
            'https://torrentdownloads.unblockit.ink',
            'https://www.torrentdownloads.unblockit.ink'
        ];
        this.currentMirrorIndex = 0;
    }

    async search(data) {
        try {
            const { title, year, type, season, episode } = data;

            console.log(`DEBUG: TorrentDownloads searching for: ${title} (type: ${type})`);

            // Build search query - clean format
            let searchQuery = this.cleanSearchQuery(title);

            // Add season/episode info for TV shows
            if (type === 'tv' && season !== null && episode !== null) {
                searchQuery += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            } else if (type === 'tv' && season !== null) {
                searchQuery += ` S${season.toString().padStart(2, '0')}`;
            }

            // Only add year if it's reasonable (not future years)
            if (year && year <= new Date().getFullYear() + 1) {
                searchQuery += ` ${year}`;
            }

            const searchURL = `${this.baseURL}/search/?search=${encodeURIComponent(searchQuery)}`;
            console.log(`DEBUG: TorrentDownloads URL: ${searchURL}`);

            const response = await this.client.get(searchURL, {
                timeout: 15000,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Referer': this.baseURL,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            console.log(`DEBUG: TorrentDownloads response status: ${response.status}`);
            const results = this.parseSearchResults(response.data, data);
            console.log(`DEBUG: TorrentDownloads found ${results.length} results`);
            return results;

        } catch (error) {
            console.error('TorrentDownloads search error:', error.message);

            // Try alternative mirrors
            if (this.currentMirrorIndex < this.mirrors.length - 1) {
                this.currentMirrorIndex++;
                this.baseURL = this.mirrors[this.currentMirrorIndex];
                console.log(`Trying TorrentDownloads mirror: ${this.baseURL}`);
                return this.search(data); // Retry with next mirror
            }

            return [];
        }
    }

    parseSearchResults(html, searchData) {
        const $ = cheerio.load(html);
        const results = [];

        // TorrentDownloads uses different CSS selectors
        $('.grey_bar3 table tr').each((index, element) => {
            try {
                const row = $(element);

                // Skip header row
                if (row.find('th').length > 0) {
                    return;
                }

                const result = this.parseTorrentRow(row, searchData);
                if (result && result.seeders >= this.minSeeders) {
                    results.push(result);
                }
            } catch (error) {
                console.error('Error parsing TorrentDownloads row:', error.message);
            }
        });

        return results;
    }

    parseTorrentRow(row, searchData) {
        // Extract title and link
        const titleLink = row.find('td:nth-child(2) a').first();
        const title = titleLink.text().trim();
        const detailLink = titleLink.attr('href');

        if (!title) {
            return null;
        }

        // Extract download link
        const downloadLink = row.find('td:nth-child(4) a').first();
        const downloadUrl = downloadLink.attr('href');

        if (!downloadUrl) {
            return null;
        }

        // Make sure the download URL is absolute
        const finalUrl = downloadUrl.startsWith('http') ? downloadUrl : `${this.baseURL}${downloadUrl}`;

        // Extract seeders and leechers
        const seedersText = row.find('td:nth-child(5)').text().trim();
        const leechersText = row.find('td:nth-child(6)').text().trim();

        const seeders = parseInt(seedersText) || 0;
        const leechers = parseInt(leechersText) || 0;

        // Extract size
        const sizeStr = row.find('td:nth-child(3)').text().trim();
        const size = this.filters.parseSize(sizeStr);

        // Extract upload date
        const uploadedAt = row.find('td:nth-child(1)').text().trim() || null;

        // Check if this result matches our search criteria
        if (!this.isResultMatch(title, searchData)) {
            return null;
        }

        return this.createResult({
            name: title,
            title: this.extractTitleFromName(title),
            year: this.extractYearFromName(title),
            quality: this.filters.detectQuality(title),
            size: size,
            sizeStr: sizeStr,
            seeders: seeders,
            leechers: leechers,
            hash: '', // TorrentDownloads doesn't easily provide hash
            url: finalUrl,
            magnet: null, // TorrentDownloads usually provides direct download links
            type: this.determineContentType(title, searchData.type),
            language: 'en', // Default to English for TorrentDownloads
            verified: seeders > 5, // Consider moderately seeded torrents as verified
            uploadedAt: uploadedAt,
            detailLink: detailLink ? `${this.baseURL}${detailLink}` : null,
            uploader: 'Unknown',
            category: this.determineCategory(title, searchData.type),
            info: `TorrentDownloads • ${seeders} seeders`
        });
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

        // Default to movie for most content
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
                    console.log(`TorrentDownloads available at: ${mirror}`);
                    return true;
                }
            } catch (error) {
                console.log(`TorrentDownloads mirror ${this.mirrors[i]} not available:`, error.message);
                continue;
            }
        }

        console.error('All TorrentDownloads mirrors are unavailable');
        return false;
    }
}

module.exports = TorrentDownloadsProvider;