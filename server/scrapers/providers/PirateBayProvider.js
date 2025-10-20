const BaseProvider = require('./BaseProvider');

class PirateBayProvider extends BaseProvider {
  constructor() {
    super('PirateBay', {
      baseURL: 'https://apibay.org',
      priority: 1, // Highest priority for comprehensive content
      supportsMovies: true,
      supportsTV: true,
      minRequestInterval: 2000,
      minSeeders: 0
    });

    // Alternative API endpoints if main one is down
    this.mirrors = [
      'https://apibay.org',
      'https://thepiratebay.org',
      'https://pirateproxy.wtf'
    ];
    this.currentMirrorIndex = 0;
    this.apiPath = '/q.php';
  }

  async search(data) {
    try {
      const { title, type, season, episode, year } = data;
      console.log(`DEBUG: PirateBay searching for: ${title} (type: ${type})`);

      // Build search query - clean format
      let searchQuery = this.cleanSearchQuery(title);

      // Add season/episode info for TV shows
      if (type === 'tv' && season !== null && episode !== null) {
        searchQuery += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
      } else if (type === 'tv' && season !== null) {
        searchQuery += ` S${season.toString().padStart(2, '0')}`;
      }

      // Don't include year in search queries for better ApiBay results

      const results = await this.searchAPI(searchQuery, data);
      console.log(`DEBUG: PirateBay found ${results.length} results`);
      return results;

    } catch (error) {
      console.error('PirateBay search error:', error.message);

      // Try alternative mirrors
      if (this.currentMirrorIndex < this.mirrors.length - 1) {
        this.currentMirrorIndex++;
        this.baseURL = this.mirrors[this.currentMirrorIndex];
        console.log(`Trying PirateBay mirror: ${this.baseURL}`);
        return this.search(data); // Retry with next mirror
      }

      return [];
    }
  }

  async searchAPI(query, searchData) {
    try {
      const url = `${this.baseURL}${this.apiPath}?q=${encodeURIComponent(query)}`;
      console.log(`DEBUG: PirateBay API URL: ${url}`);

      const response = await this.client.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': this.baseURL
        }
      });

      console.log(`DEBUG: PirateBay response status: ${response.status}`);
      return this.parseAPIResponse(response.data, searchData);

    } catch (error) {
      console.error('PirateBay API search error:', error.message);
      return [];
    }
  }

  parseAPIResponse(responseData, searchData) {
    const results = [];

    if (!Array.isArray(responseData) || responseData.length === 0) {
      console.log('DEBUG: PirateBay No valid torrent data in response');
      return results;
    }

    console.log(`DEBUG: PirateBay parsing ${responseData.length} torrents`);

    for (const torrent of responseData) {
      try {
        const result = this.parseTorrentItem(torrent, searchData);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error('Error parsing PirateBay torrent:', error.message);
      }
    }

    return results;
  }

  parseTorrentItem(torrent, searchData) {
    const title = torrent.name || '';
    const hash = torrent.info_hash || '';
    const seeders = parseInt(torrent.seeders) || 0;
    const leechers = parseInt(torrent.leechers) || 0;
    const size = parseInt(torrent.size) || 0;

    if (!title || !hash) {
      return null;
    }

    // Check if this result matches our search criteria
    if (!this.isResultMatch(title, searchData)) {
      return null;
    }

    // Extract season/episode from title
    const seasonInfo = this.extractSeasonEpisode(title);

    // For specific episode searches, filter by season/episode
    if (searchData.season != null && searchData.episode != null) {
      if (seasonInfo.season !== searchData.season || seasonInfo.episode !== searchData.episode) {
        return null;
      }
    }

    // Determine content type
    const contentType = this.determineContentType(title, searchData.type, torrent.category);

    // Detect quality
    const quality = this.detectQuality(title);

    // Detect language from title
    const language = this.detectLanguage(title);

    // Format size
    const sizeStr = this.formatSize(size);

    // Create magnet URL from hash
    const magnetUrl = this.createMagnetUrl(hash, title);

    // Extract year from title or use provided year
    const extractedYear = this.extractYearFromName(title) || searchData.year;

    return this.createResult({
      name: title,
      title: this.extractTitleFromName(title),
      year: extractedYear,
      quality: quality,
      size: size,
      sizeStr: sizeStr,
      seeders: seeders,
      leechers: leechers,
      hash: hash.toLowerCase(),
      url: magnetUrl,
      magnet: magnetUrl,
      type: contentType,
      language: language,
      verified: seeders > 5, // Consider well-seeded torrents as verified
      uploadedAt: torrent.added ? new Date(parseInt(torrent.added) * 1000).toISOString() : null,
      detailLink: `https://thepiratebay.org/description.php?id=${torrent.id}`,
      uploader: torrent.username || 'Anonymous',
      category: this.getCategoryName(torrent.category),
      info: `PirateBay • ${seeders} seeders`,
      season: seasonInfo.season,
      episode: seasonInfo.episode
    });
  }

  isResultMatch(title, searchData) {
    // Check title match using existing filters
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

  extractSeasonEpisode(title) {
    // Extract season and episode from title
    const patterns = [
      /S(\d{1,2})E(\d{1,2})/i,           // S01E01
      /(\d{1,2})x(\d{1,2})/i,            // 1x01
      /Season\s+(\d{1,2}).*?Episode\s+(\d{1,2})/i,  // Season 1 Episode 1
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        return {
          season: parseInt(match[1]),
          episode: parseInt(match[2])
        };
      }
    }

    return { season: null, episode: null };
  }

  determineContentType(title, searchType, category) {
    // Prioritize search type
    if (searchType === 'tv') {
      return 'tv';
    }
    if (searchType === 'movie') {
      return 'movie';
    }

    // Based on category numbers from PirateBay API
    const videoCategories = {
      '200': 'movie',   // Movies
      '201': 'movie',   // Movies DVDR
      '202': 'movie',   // Movies HD
      '203': 'movie',   // Movies 3D
      '204': 'movie',   // Movies 4K
      '205': 'tv',      // TV episodes
      '206': 'tv',      // TV HD episodes
      '207': 'tv',      // TV/HD shows
      '208': 'tv',      // TV shows
      '209': 'other',   // UHD/4K movies
    };

    // Determine from category
    if (category && videoCategories[category]) {
      return videoCategories[category];
    }

    // Determine from title patterns
    const tvPatterns = /S\d{1,2}E\d{1,2}|Season|Episode|\d+x\d+/i;
    if (tvPatterns.test(title)) {
      return 'tv';
    }

    return 'movie';
  }

  getCategoryName(categoryCode) {
    const categories = {
      '100': 'Audio',
      '101': 'Music',
      '102': 'Audio books',
      '103': 'Sound clips',
      '104': 'FLAC',
      '105': 'Movies',
      '106': 'Movies DVDR',
      '107': 'Music videos',
      '108': 'Movies DVDR',
      '109': 'Ogg',
      '110': 'Movies',
      '111': 'Movies',
      '112': 'Movies',
      '113': 'Movies',
      '114': 'Movies',
      '115': 'Movies',
      '116': 'Movies',
      '117': 'Movies',
      '118': 'Movies',
      '199': 'Other',
      '200': 'Movies',
      '201': 'Movies DVDR',
      '202': 'Movies HD',
      '203': 'Movies 3D',
      '204': 'Movies 4K',
      '205': 'TV episodes',
      '206': 'TV HD episodes',
      '207': 'TV/HD shows',
      '208': 'TV shows',
      '209': 'UHD/4K movies',
      '299': 'Other',
      '300': 'Video',
      '301': 'Movies DVDR',
      '302': 'Movies',
      '303': 'Movies',
      '304': 'Movies',
      '305': 'Movies',
      '306': 'Movies',
      '307': 'Movies',
      '308': 'Movies',
      '309': 'Movies',
      '310': 'Movies',
      '311': 'Movies',
      '312': 'Movies',
      '313': 'Movies',
      '399': 'Other',
      '400': 'XXX',
      '401': 'XXX',
      '402': 'XXX',
      '403': 'XXX',
      '404': 'XXX',
      '405': 'XXX',
      '406': 'XXX',
      '407': 'XXX',
      '408': 'XXX',
      '409': 'XXX',
      '410': 'XXX',
      '411': 'XXX',
      '412': 'XXX',
      '413': 'XXX',
      '414': 'XXX',
      '415': 'XXX',
      '416': 'XXX',
      '417': 'XXX',
      '418': 'XXX',
      '419': 'XXX',
      '420': 'XXX',
      '421': 'XXX',
      '422': 'XXX',
      '423': 'XXX',
      '424': 'XXX',
      '425': 'XXX',
      '426': 'XXX',
      '427': 'XXX',
      '428': 'XXX',
      '429': 'XXX',
      '430': 'XXX',
      '431': 'XXX',
      '432': 'XXX',
      '433': 'XXX',
      '434': 'XXX',
      '435': 'XXX',
      '436': 'XXX',
      '437': 'XXX',
      '438': 'XXX',
      '439': 'XXX',
      '440': 'XXX',
      '441': 'XXX',
      '442': 'XXX',
      '443': 'XXX',
      '444': 'XXX',
      '445': 'XXX',
      '446': 'XXX',
      '447': 'XXX',
      '448': 'XXX',
      '499': 'Other',
      '500': 'Games',
      '501': 'Games PC',
      '502': 'Games Mac',
      '503': 'Games PSx',
      '504': 'Games Xbox',
      '505': 'Games Wii',
      '506': 'Games handheld',
      '507': 'Games IOS (iPad/iPhone)',
      '508': 'Games Android',
      '509': 'Games Other',
      '599': 'Other',
      '600': 'Applications',
      '601': 'Applications Windows',
      '602': 'Applications Mac',
      '603': 'Applications UNIX',
      '604': 'Applications handheld',
      '605': 'Applications IOS (iPad/iPhone)',
      '606': 'Applications Android',
      '607': 'Applications Other OS',
      '699': 'Other'
    };

    return categories[categoryCode] || 'Other';
  }

  extractTitleFromName(fullName) {
    return fullName
      .replace(/\d{4}/g, '')
      .replace(/\b(1080p|720p|480p|4K|HD|BluRay|BRRip|DVDRip|WEBRip|WEB-DL|HDTV|HEVC|x265|x264)\b/gi, '')
      .replace(/\b(S\d{1,2}E\d{1,2})\b/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[._-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractYearFromName(name) {
    const yearMatch = name.match(/\b(19|20)\d{2}\b/);
    return yearMatch ? parseInt(yearMatch[0]) : null;
  }

  detectQuality(title) {
    const titleLower = title.toLowerCase();

    if (titleLower.includes('2160p') || titleLower.includes('4k')) return '4K';
    if (titleLower.includes('1080p')) return '1080p';
    if (titleLower.includes('720p')) return '720p';
    if (titleLower.includes('480p')) return '480p';

    return 'Unknown';
  }

  formatSize(bytes) {
    if (!bytes || bytes === 0) return '';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  createMagnetUrl(hash, title) {
    const encodedTitle = encodeURIComponent(title);
    const trackers = [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://9.rarbg.me:2970/announce',
      'udp://p4p.arenabg.com:1337/announce',
      'udp://tracker.torrent.eu.org:451/announce',
      'udp://tracker.dler.org:6969/announce',
      'udp://open.stealth.si:80/announce',
      'udp://ipv4.tracker.harry.lu:80/announce',
      'https://opentracker.i2p.rocks:443/announce'
    ];

    const trackerParams = trackers.map(tracker => `&tr=${encodeURIComponent(tracker)}`).join('');
    return `magnet:?xt=urn:btih:${hash}&dn=${encodedTitle}${trackerParams}`;
  }

  // Override availability check to try multiple mirrors
  async isAvailable() {
    for (let i = 0; i < this.mirrors.length; i++) {
      try {
        const mirror = this.mirrors[i];
        let testUrl;

        if (mirror.includes('apibay.org')) {
          // Test API endpoint
          testUrl = `${mirror}${this.apiPath}?q=test`;
        } else {
          // Test web endpoint
          testUrl = mirror;
        }

        const response = await this.client.get(testUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (response.status === 200) {
          this.baseURL = mirror;
          this.currentMirrorIndex = i;
          console.log(`PirateBay available at: ${mirror}`);
          return true;
        }
      } catch (error) {
        console.log(`PirateBay mirror ${this.mirrors[i]} not available:`, error.message);
        continue;
      }
    }

    console.error('All PirateBay mirrors are unavailable');
    return false;
  }

  detectLanguage(title) {
    const titleLower = title.toLowerCase();

    // Check for multi-language releases first (filter these out)
    if (titleLower.match(/multi|multilang|multisub/i)) return 'multi';

    // Check for explicit language indicators
    if (titleLower.match(/german|deut[sch]|\.ger\./i)) return 'de';
    if (titleLower.match(/french|fran[cais]/i)) return 'fr';
    if (titleLower.match(/spanish|esp[añol]/i)) return 'es';
    if (titleLower.match(/italian|italiano/i)) return 'it';
    if (titleLower.match(/portuguese|portugu[eê]s/i)) return 'pt';
    if (titleLower.match(/russian|\\u0440\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439/i)) return 'ru';

    // Default to English for most content
    return 'en';
  }
}

module.exports = PirateBayProvider;