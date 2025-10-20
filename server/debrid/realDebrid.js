const BaseDebrid = require('./baseDebrid');
const axios = require('axios');

class RealDebrid extends BaseDebrid {
  constructor(apiKey) {
    super(apiKey);
    this.baseURL = 'https://api.real-debrid.com/rest/1.0';
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers
      },
      ...options
    };

    try {
      const response = await axios(url, config);
      return response.data;
    } catch (error) {
      console.error('Real-Debrid API request failed:', error.response?.data || error.message);
      throw error;
    }
  }

  async checkStatus() {
    try {
      const data = await this.request('/user');
      return {
        status: 'active',
        user: data.username,
        premium: data.premium > 0,
        expiration: data.expiration
      };
    } catch (error) {
      return { status: 'inactive', error: error.message };
    }
  }

  async addMagnet(magnetLink) {
    try {
      const data = await this.request('/torrents/addMagnet', {
        method: 'POST',
        data: { magnet: magnetLink }
      });
      return data;
    } catch (error) {
      throw new Error(`Failed to add magnet: ${error.message}`);
    }
  }

  async getTorrentInfo(torrentId) {
    try {
      const data = await this.request(`/torrents/info/${torrentId}`);
      return data;
    } catch (error) {
      throw new Error(`Failed to get torrent info: ${error.message}`);
    }
  }

  async getStreamingLinks(torrentId) {
    try {
      const data = await this.request(`/torrents/selectFiles/${torrentId}`, {
        method: 'POST',
        data: { files: 'all' }
      });
      return data;
    } catch (error) {
      throw new Error(`Failed to get streaming links: ${error.message}`);
    }
  }

  async unrestrictLink(link) {
    try {
      const data = await this.request('/unrestrict/link', {
        method: 'POST',
        data: { link }
      });
      return data;
    } catch (error) {
      throw new Error(`Failed to unrestrict link: ${error.message}`);
    }
  }
}

module.exports = RealDebrid;