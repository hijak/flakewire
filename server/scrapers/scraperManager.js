const BaseScraper = require('./baseScraper');
const PosterService = require('../services/imdbService');

class ScraperManager {
  constructor(secureStorage) {
    this.scrapers = new Map();
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
    this.posterService = new PosterService(secureStorage);
    this.initializeScrapers();
  }

  initializeScrapers() {
    // In MVP, we'll create mock scrapers
    // In production, these would be actual scrapers for different sites
    this.scrapers.set('mock1', new MockScraper('Mock Site 1', 'https://mock-site1.com', this.posterService));
    this.scrapers.set('mock2', new MockScraper('Mock Site 2', 'https://mock-site2.com', this.posterService));
  }

  getCacheKey(query, scraperName) {
    return `${scraperName}:${query.toLowerCase().trim()}`;
  }

  getFromCache(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(cacheKey);
    return null;
  }

  setCache(cacheKey, data) {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
  }

  async searchAll(query) {
    const results = [];
    const promises = [];

    for (const [name, scraper] of this.scrapers) {
      promises.push(this.searchWithScraper(name, scraper, query));
    }

    try {
      const scraperResults = await Promise.allSettled(promises);

      scraperResults.forEach((result, index) => {
        const scraperName = Array.from(this.scrapers.keys())[index];
        if (result.status === 'fulfilled') {
          results.push({
            scraper: scraperName,
            results: result.value
          });
        } else {
          console.error(`Scraper ${scraperName} failed:`, result.reason);
        }
      });
    } catch (error) {
      console.error('Error in parallel scraping:', error);
    }

    return results;
  }

  async searchWithScraper(scraperName, scraper, query) {
    const cacheKey = this.getCacheKey(query, scraperName);

    // Check cache first
    const cachedResult = this.getFromCache(cacheKey);
    if (cachedResult) {
      console.log(`Returning cached result for ${scraperName}: ${query}`);
      return cachedResult;
    }

    try {
      const results = await scraper.scrapeWithFallback(query);
      this.setCache(cacheKey, results);
      return results;
    } catch (error) {
      console.error(`Scraper ${scraperName} failed:`, error.message);
      throw error;
    }
  }

  getAvailableScrapers() {
    return Array.from(this.scrapers.keys());
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheSize() {
    return this.cache.size;
  }
}

// Mock Scraper for MVP
class MockScraper extends BaseScraper {
  constructor(name, baseUrl, posterService) {
    super(name, baseUrl);
    this.posterService = posterService;
  }

  async search(query) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Generate better poster URLs
    const poster1 = this.posterService.getPlaceholderPoster(`${query} Result 1`);
    const poster2 = this.posterService.getPlaceholderPoster(`${query} Result 2`);

    // Mock search results
    const mockResults = [
      {
        title: `${query} - Result 1 (${this.name})`,
        year: 2023,
        type: 'movie',
        poster: poster1,
        url: `${this.baseUrl}/movie/${Math.random().toString(36).substring(7)}`,
        description: `Mock result for ${query} from ${this.name}`,
        quality: '1080p',
        size: '1.5GB'
      },
      {
        title: `${query} - Result 2 (${this.name})`,
        year: 2023,
        type: 'movie',
        poster: poster2,
        url: `${this.baseUrl}/movie/${Math.random().toString(36).substring(7)}`,
        description: `Another mock result for ${query} from ${this.name}`,
        quality: '720p',
        size: '1.2GB'
      }
    ];

    return mockResults;
  }

  async getMediaDetails(mediaUrl) {
    // Mock media details
    return {
      synopsis: 'This is a mock synopsis for the media.',
      genre: ['Action', 'Drama'],
      director: 'Mock Director',
      cast: ['Actor 1', 'Actor 2'],
      rating: 8.5,
      runtime: '120 min'
    };
  }

  async getStreamingLinks(mediaUrl) {
    // Mock streaming links
    return [
      {
        quality: '1080p',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        provider: this.name
      },
      {
        quality: '720p',
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
        provider: this.name
      }
    ];
  }
}

module.exports = ScraperManager;