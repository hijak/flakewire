class BaseDebrid {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = '';
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Debrid API request failed:', error);
      throw error;
    }
  }

  async checkStatus() {
    throw new Error('checkStatus method must be implemented by subclass');
  }

  async addMagnet(magnetLink) {
    throw new Error('addMagnet method must be implemented by subclass');
  }

  async getTorrentInfo(torrentId) {
    throw new Error('getTorrentInfo method must be implemented by subclass');
  }

  async getStreamingLinks(torrentId) {
    throw new Error('getStreamingLinks method must be implemented by subclass');
  }
}

module.exports = BaseDebrid;