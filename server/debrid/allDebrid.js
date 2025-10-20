const axios = require('axios');
const BaseDebrid = require('./baseDebrid');

class AllDebrid extends BaseDebrid {
  constructor(apiKey) {
    super(apiKey);
    this.baseURL = 'https://api.alldebrid.com/v4';
  }

  async checkStatus() {
    try {
      const { data } = await axios.get(`${this.baseURL}/user`, {
        params: { apikey: this.apiKey, agent: process.env.ALLDEBRID_AGENT || 'flake-wire' },
        timeout: 10000
      });
      if (data.status !== 'success') {
        return { status: 'inactive', error: data?.error?.message || 'Unknown error' };
      }
      return { status: 'active', user: data.data?.user };
    } catch (error) {
      return { status: 'inactive', error: error.message };
    }
  }

  async addMagnet(magnetLink) {
    try {
      // AllDebrid magnet upload via GET with magnets[] param
      const { data } = await axios.get(`${this.baseURL}/magnet/upload`, {
        params: { apikey: this.apiKey, agent: process.env.ALLDEBRID_AGENT || 'flake-wire', 'magnets[]': magnetLink },
        timeout: 15000
      });
      if (data.status !== 'success' || !data.data?.magnets?.length) {
        throw new Error(data?.error?.message || 'Upload failed');
      }
      return data.data.magnets[0];
    } catch (error) {
      throw new Error(`AllDebrid addMagnet failed: ${error.message}`);
    }
  }

  async getTorrentInfo(id) {
    const maxAttempts = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data } = await axios.get(`${this.baseURL}/magnet/status`, {
          params: { apikey: this.apiKey, agent: process.env.ALLDEBRID_AGENT || 'flake-wire', id },
          timeout: 15000
        });
        if (data.status !== 'success') {
          throw new Error(data?.error?.message || 'Status failed');
        }
        return data.data?.magnets?.[0] || data.data;
      } catch (error) {
        lastErr = error;
        const code = error?.response?.status || 0;
        // Retry on 5xx/Cloudflare errors
        if (code >= 500 || code === 0) {
          await new Promise(r => setTimeout(r, 750 * attempt));
          continue;
        }
        break;
      }
    }
    throw new Error(`AllDebrid getTorrentInfo failed: ${lastErr?.message || 'Unknown error'}`);
  }

  async getStreamingLinks(id) {
    // For AllDebrid, ensure files are selected; then links appear in status
    try {
      await this.selectFiles(id, 'all');
    } catch (_) {}
    return this.getTorrentInfo(id);
  }

  async unrestrictLink(link) {
    try {
      const { data } = await axios.get(`${this.baseURL}/link/unlock`, {
        params: { apikey: this.apiKey, agent: process.env.ALLDEBRID_AGENT || 'flake-wire', link },
        timeout: 15000
      });
      if (data.status !== 'success') {
        throw new Error(data?.error?.message || 'Unlock failed');
      }
      return { download: data.data?.link, filename: data.data?.filename };
    } catch (error) {
      throw new Error(`AllDebrid unrestrict failed: ${error.message}`);
    }
  }

  async listRecentMagnets() {
    try {
      const { data } = await axios.get(`${this.baseURL}/magnet/status`, {
        params: { apikey: this.apiKey, agent: process.env.ALLDEBRID_AGENT || 'flake-wire' },
        timeout: 15000
      });
      if (data.status !== 'success') {
        throw new Error(data?.error?.message || 'Status list failed');
      }
      return data.data?.magnets || [];
    } catch (e) {
      console.warn('AllDebrid listRecentMagnets error:', e.message);
      return [];
    }
  }

  async selectFiles(id, files = 'all') {
    try {
      const { data } = await axios.get(`${this.baseURL}/magnet/selectFiles`, {
        params: { apikey: this.apiKey, agent: process.env.ALLDEBRID_AGENT || 'flake-wire', id, files },
        timeout: 15000
      });
      if (data.status !== 'success') {
        throw new Error(data?.error?.message || 'Select files failed');
      }
      return true;
    } catch (e) {
      console.warn('AllDebrid selectFiles error:', e.message);
      return false;
    }
  }

  async checkInstant(magnets = []) {
    try {
      if (!Array.isArray(magnets) || magnets.length === 0) return [];
      const params = new URLSearchParams();
      params.append('apikey', this.apiKey);
      params.append('agent', process.env.ALLDEBRID_AGENT || 'flake-wire');
      for (const m of magnets) params.append('magnets[]', m);
      const { data } = await axios.get(`${this.baseURL}/magnet/instant?${params.toString()}`, { timeout: 15000 });
      if (data.status !== 'success') return [];
      // data.data.magnets is array mapping given magnets -> {instant: boolean}
      return data.data?.magnets || [];
    } catch (e) {
      // Silently degrade if endpoint is not available or returns 404
      return [];
    }
  }
}

module.exports = AllDebrid;
