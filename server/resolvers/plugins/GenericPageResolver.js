const GenericResolver = require('../GenericResolver');

class GenericPageResolver extends GenericResolver {
  constructor() {
    super('GenericPage', {
      isUniversal: true,
      priority: 999, // very low priority
      genericPatterns: true,
      blacklist: ['.mpd', '.smil']
    });
  }

  validUrl(url) {
    // As a fallback, attempt to handle any http(s) page
    try { const u = new URL(url); return u.protocol.startsWith('http'); } catch { return false; }
  }

  getHostAndId(url) {
    try {
      const u = new URL(url);
      return { host: u.hostname, id: u.pathname.replace(/^\//, '') + (u.search || '') };
    } catch { return { host: '', id: url }; }
  }

  getUrl(host, id) {
    if (id.startsWith('http')) return id;
    return `https://${host}/${id}`;
  }
}

module.exports = GenericPageResolver;

