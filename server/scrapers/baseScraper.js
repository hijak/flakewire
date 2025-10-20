const axios = require('axios');
const cheerio = require('cheerio');

class BaseScraper {
  constructor(name, baseUrl) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.timeout = 10000;
  }

  async request(url, options = {}) {
    const config = {
      timeout: this.timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...options.headers
      },
      ...options
    };

    try {
      const response = await axios(url, config);
      return response.data;
    } catch (error) {
      console.error(`Scraper request failed for ${this.name}:`, error.message);
      throw error;
    }
  }

  async search(query) {
    throw new Error('search method must be implemented by subclass');
  }

  async getMediaDetails(mediaUrl) {
    throw new Error('getMediaDetails method must be implemented by subclass');
  }

  async getStreamingLinks(mediaUrl) {
    throw new Error('getStreamingLinks method must be implemented by subclass');
  }

  async scrapeWithFallback(query) {
    try {
      return await this.search(query);
    } catch (error) {
      console.error(`Primary scraping failed for ${this.name}, trying fallback:`, error.message);
      // Fallback logic can be implemented here
      throw error;
    }
  }
}

module.exports = BaseScraper;