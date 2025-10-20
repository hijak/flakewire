const BaseProvider = require('./BaseProvider');
const cheerio = require('cheerio');

class LeetxProvider extends BaseProvider {
    constructor() {
        super('1337x', {
            baseURL: 'https://1337x.to',
            priority: 5,
            supportsMovies: true,
            supportsTV: true,
            minRequestInterval: 2500, // 2.5 seconds between requests
            minSeeders: 0
        });

        // Alternative mirrors if main site is down
        this.mirrors = [
            'https://1337x.to',
            'https://1337x.st',
            'https://x1337x.ws',
            'https://1337x.gd',
            'https://1337x.se'
        ];
        this.currentMirrorIndex = 0;
    }

    async search(data) {
        try {
            const { title, year, type, season, episode } = data;

            console.log(`DEBUG: 1337x searching for: ${title} (type: ${type})`);

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

            const searchURL = `${this.baseURL}/search/${encodeURIComponent(searchQuery)}/1/`;
            console.log(`DEBUG: 1337x URL: ${searchURL}`);

            const response = await this.client.get(searchURL, {
                timeout: 20000, // Increased timeout
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Upgrade-Insecure-Requests': '1',
                    'Referer': this.baseURL,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'DNT': '1',
                    'Connection': 'keep-alive'
                }
            });

            console.log(`DEBUG: 1337x response status: ${response.status}`);
            const results = this.parseSearchResults(response.data, data);
            console.log(`DEBUG: 1337x found ${results.length} results`);
            return results;

        } catch (error) {
            console.error('1337x search error:', error.message);

            // Try alternative mirrors
            if (this.currentMirrorIndex < this.mirrors.length - 1) {
                this.currentMirrorIndex++;
                this.baseURL = this.mirrors[this.currentMirrorIndex];
                console.log(`Trying 1337x mirror: ${this.baseURL}`);
                return this.search(data); // Retry with next mirror
            }

            return [];
        }
    }

    parseSearchResults(html, searchData) {
        const $ = cheerio.load(html);
        const results = [];

        $('.table tbody tr').each((index, element) => {
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
                console.error('Error parsing 1337x row:', error.message);
            }
        });

        return results;
    }

    parseTorrentRow(row, searchData) {
        // Extract title and link
        const titleLink = row.find('td.name a').first();
        const title = titleLink.text().trim();
        const detailLink = titleLink.attr('href');

        if (!title) {
            return null;
        }

        // Extract magnet and torrent links
        const links = row.find('td a');
        let magnetLink = null;
        let torrentLink = null;

        links.each((i, element) => {
            const link = $(element);
            const href = link.attr('href');
            const text = link.text().trim();

            if (href && href.startsWith('magnet:')) {
                magnetLink = href;
            } else if (href && href.includes('/torrent/')) {
                torrentLink = href;
            }
        });

        const finalUrl = magnetLink || torrentLink;
        if (!finalUrl) {
            return null;
        }

        // Extract seeders and leechers
        const seeders = parseInt(row.find('td.seeds').text().trim()) || 0;
        const leechers = parseInt(row.find('td.leeches').text().trim()) || 0;

        // Extract size
        const sizeStr = row.find('td.size').text().trim();
        const size = this.filters.parseSize(sizeStr);

        // Extract upload date
        const uploadedAt = row.find('td.coll-date').text().trim() || null;

        // Extract uploader
        const uploader = row.find('td.user').text().trim() || 'Anonymous';

        // Extract category from icon or class
        const categoryElement = row.find('td.icons .coll-1');
        let category = 'Unknown';
        if (categoryElement.length > 0) {
            const categoryClass = categoryElement.attr('class') || '';
            if (categoryClass.includes('icon-nfo')) {
                category = 'Applications';
            } else if (categoryClass.includes('icon-top')) {
                category = 'Movies';
            } else if (categoryClass.includes('icon-tv')) {
                category = 'TV';
            } else if (categoryClass.includes('icon-music')) {
                category = 'Music';
            } else if (categoryClass.includes('icon-game')) {
                category = 'Games';
            } else if (categoryClass.includes('icon-xxx')) {
                category = 'XXX';
            } else if (categoryClass.includes('icon-other')) {
                category = 'Other';
            }
        }

        // Check if this result matches our search criteria
        if (!this.isResultMatch(title, searchData, category)) {
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
            quality: this.filters.detectQuality(title),
            size: size,
            sizeStr: sizeStr,
            seeders: seeders,
            leechers: leechers,
            hash: hash,
            url: finalUrl,
            magnet: magnetLink,
            type: this.determineContentType(category, title, searchData.type),
            verified: seeders > 10, // Consider well-seeded torrents as verified
            uploadedAt: uploadedAt,
            detailLink: detailLink ? `${this.baseURL}${detailLink}` : null,
            uploader: uploader,
            category: category,
            info: `1337x • ${seeders} seeders`
        });
    }

    isResultMatch(title, searchData, category) {
        // Check if content type matches
        const searchType = searchData.type || 'movie';

        // Map categories to content types
        const categoryMap = {
            'Movies': 'movie',
            'TV': 'tv',
            'Applications': 'software',
            'Music': 'music',
            'Games': 'games',
            'XXX': 'xxx',
            'Other': 'other'
        };

        const contentType = categoryMap[category] || 'other';

        // Filter based on search type
        if (searchType === 'movie' && contentType !== 'movie') {
            return false;
        }

        if (searchType === 'tv' && contentType !== 'tv') {
            return false;
        }

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

    determineContentType(category, title, searchType) {
        //优先根据搜索类型判断
        if (searchType === 'tv') {
            return 'tv';
        }
        if (searchType === 'movie') {
            return 'movie';
        }

        // 根据分类判断
        if (category === 'TV') {
            return 'tv';
        }
        if (category === 'Movies') {
            return 'movie';
        }

        // 根据标题模式判断
        const tvPatterns = /S\d{1,2}E\d{1,2}|Season|Episode|\d+x\d+/i;
        if (tvPatterns.test(title)) {
            return 'tv';
        }

        return 'movie';
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
                    console.log(`1337x available at: ${mirror}`);
                    return true;
                }
            } catch (error) {
                console.log(`1337x mirror ${this.mirrors[i]} not available:`, error.message);
                continue;
            }
        }

        console.error('All 1337x mirrors are unavailable');
        return false;
    }
}

module.exports = LeetxProvider;