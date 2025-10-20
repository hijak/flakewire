const BaseProvider = require('./BaseProvider');

class EZTVProvider extends BaseProvider {
  constructor() {
    super('EZTV', {
      baseURL: 'https://eztvx.to',
      priority: 5, // Lower priority number = higher priority (good for TV shows)
      supportsMovies: false, // EZTV focuses on TV shows only
      supportsTV: true,
      minRequestInterval: 2000,
      minSeeders: 0
    });

    // Alternative domains/mirrors for EZTV
    this.mirrors = [
      'https://eztvx.to', // Primary working domain
      'https://eztv.wf',
      'https://eztv.re',
      'https://eztv.ag'
    ];
    this.currentMirrorIndex = 0;
    this.apiPath = '/api/get-torrents';
  }

  async search(data) {
    try {
      const { title, type, season, episode, imdb } = data;
      console.log(`DEBUG: EZTV searching for: ${title} (type: ${type})`);

      // EZTV API only supports TV shows
      if (type === 'movie') {
        console.log('EZTV: Skipping movie search - only TV shows supported');
        return [];
      }

      const results = [];

      // Method 1: Try IMDB ID search first (most accurate)
      if (imdb) {
        const imdbResults = await this.searchByIMDB(imdb, data);
        results.push(...imdbResults);
      }

      // Method 2: Try text-based search if no IMDB results
      if (results.length === 0) {
        const textResults = await this.searchByText(title, data);
        results.push(...textResults);
      }

      console.log(`DEBUG: EZTV found ${results.length} results`);
      return results;

    } catch (error) {
      console.error('EZTV search error:', error.message);

      // Try alternative mirrors
      if (this.currentMirrorIndex < this.mirrors.length - 1) {
        this.currentMirrorIndex++;
        this.baseURL = this.mirrors[this.currentMirrorIndex];
        console.log(`Trying EZTV mirror: ${this.baseURL}`);
        return this.search(data); // Retry with next mirror
      }

      return [];
    }
  }

  async searchByIMDB(imdbId, searchData) {
    try {
      // Remove 'tt' prefix from IMDB ID for EZTV API compatibility
      const cleanImdbId = imdbId.replace(/^tt/, '');
      const url = `${this.baseURL}${this.apiPath}?imdb_id=${cleanImdbId}&limit=50`;
      console.log(`DEBUG: EZTV IMDB search URL: ${url}`);

      const response = await this.client.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': this.baseURL
        }
      });

      console.log(`DEBUG: EZTV IMDB response status: ${response.status}`);
      return this.parseAPIResponse(response.data, searchData);

    } catch (error) {
      console.error('EZTV IMDB search error:', error.message);
      return [];
    }
  }

  async searchByText(title, searchData) {
    try {
      // Build search query - for specific episode if available
      let searchQuery = title;
      if (searchData.season != null && searchData.episode != null) {
        searchQuery = `${title} S${searchData.season.toString().padStart(2, '0')}E${searchData.episode.toString().padStart(2, '0')}`;
      }

      const url = `${this.baseURL}${this.apiPath}?q=${encodeURIComponent(searchQuery)}&limit=50`;
      console.log(`DEBUG: EZTV text search URL: ${url}`);

      const response = await this.client.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': this.baseURL
        }
      });

      console.log(`DEBUG: EZTV text response status: ${response.status}`);
      return this.parseAPIResponse(response.data, searchData);

    } catch (error) {
      console.error('EZTV text search error:', error.message);
      return [];
    }
  }

  parseAPIResponse(responseData, searchData) {
    const results = [];

    if (!responseData || !responseData.torrents || !Array.isArray(responseData.torrents)) {
      console.log('DEBUG: EZTV No valid torrent data in response');
      return results;
    }

    console.log(`DEBUG: EZTV parsing ${responseData.torrents.length} torrents`);

    for (const torrent of responseData.torrents) {
      try {
        const result = this.parseTorrentItem(torrent, searchData);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error('Error parsing EZTV torrent:', error.message);
      }
    }

    return results;
  }

  parseTorrentItem(torrent, searchData) {
    const title = torrent.title || torrent.filename || '';
    const magnetUrl = torrent.magnet_url || '';
    const torrentUrl = torrent.torrent_url || '';

    if (!title || (!magnetUrl && !torrentUrl)) {
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

    // Parse size
    const sizeBytes = parseInt(torrent.size_bytes) || 0;
    const sizeStr = this.formatSize(sizeBytes);

    // Extract seeders/peers
    const seeders = parseInt(torrent.seeds) || 0;
    const leechers = parseInt(torrent.peers) || 0;

    // Detect quality
    const quality = this.detectQuality(title);

    // Extract hash from magnet URL
    let hash = torrent.hash || '';
    if (!hash && magnetUrl) {
      const hashMatch = magnetUrl.match(/btih:([a-fA-F0-9]{40})/i);
      if (hashMatch) {
        hash = hashMatch[1].toLowerCase();
      }
    }

    return this.createResult({
      name: title,
      title: this.extractTitleFromName(title),
      year: this.extractYearFromName(title),
      quality: quality,
      size: sizeBytes,
      sizeStr: sizeStr,
      seeders: seeders,
      leechers: leechers,
      hash: hash,
      url: magnetUrl || torrentUrl,
      magnet: magnetUrl,
      type: 'tv',
      language: 'en', // EZTV content is primarily English
      verified: seeders > 0,
      uploadedAt: torrent.date_released_unix ? new Date(torrent.date_released_unix * 1000).toISOString() : null,
      detailLink: `https://eztvx.to/ep/${torrent.id}/`,
      uploader: 'EZTV',
      category: 'TV Shows',
      info: `EZTV • ${seeders} seeders`,
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

  // Override availability check to try multiple mirrors
  async isAvailable() {
    for (let i = 0; i < this.mirrors.length; i++) {
      try {
        const mirror = this.mirrors[i];
        const response = await this.client.get(`${mirror}${this.apiPath}?limit=1`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (response.status === 200) {
          this.baseURL = mirror;
          this.currentMirrorIndex = i;
          console.log(`EZTV available at: ${mirror}`);
          return true;
        }
      } catch (error) {
        console.log(`EZTV mirror ${this.mirrors[i]} not available:`, error.message);
        continue;
      }
    }

    console.error('All EZTV mirrors are unavailable');
    return false;
  }
}

module.exports = EZTVProvider;