// Playwright scraper disabled - not using playwright anymore
class PlaywrightScraper {
    constructor() {
        this.disabled = true;
    }

    async initialize() {
        console.log('Playwright scraper is disabled');
        return true;
    }

    async scrapeUrl(url, options = {}) {
        console.log('Playwright scraper disabled - cannot scrape:', url);
        return null;
    }

    async close() {
        console.log('Playwright scraper disabled - nothing to close');
    }
}

module.exports = PlaywrightScraper;