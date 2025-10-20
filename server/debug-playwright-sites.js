const { chromium } = require('playwright');

async function debugSiteAccess() {
    console.log('Testing site access with Playwright...');

    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            executablePath: '/usr/bin/chromium',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();

        // Test RMZ
        console.log('\n=== Testing RMZ.cr ===');
        try {
            await page.goto('https://rmz.cr/?s=inception', {
                waitUntil: 'networkidle',
                timeout: 15000
            });

            const title = await page.title();
            console.log('Page title:', title);

            const url = page.url();
            console.log('Final URL:', url);

            // Check if we got blocked or redirected
            if (url.includes('cloudflare') || url.includes('captcha') || url.includes('blocked')) {
                console.log('⚠️  Likely blocked by Cloudflare/anti-bot');
            }

            // Look for any search results
            const searchResults = await page.$$eval('.post h2 a, .entry-title a, h2.entry-title a', links => {
                return links.map(link => ({
                    text: link.textContent?.trim(),
                    url: link.href
                }));
            });

            console.log(`Found ${searchResults.length} potential search result links:`);
            searchResults.slice(0, 5).forEach((link, i) => {
                console.log(`  ${i + 1}. ${link.text} -> ${link.url}`);
            });

            // Check page content for any indicators
            const bodyText = await page.$eval('body', el => el.textContent.substring(0, 500));
            console.log('Page content preview:', bodyText.replace(/\s+/g, ' ').substring(0, 200) + '...');

        } catch (error) {
            console.error('RMZ access failed:', error.message);
        }

        // Test HD-Encode
        console.log('\n=== Testing HD-Encode.com ===');
        try {
            await page.goto('https://hdencode.com/?s=inception', {
                waitUntil: 'networkidle',
                timeout: 15000
            });

            const title = await page.title();
            console.log('Page title:', title);

            const url = page.url();
            console.log('Final URL:', url);

            // Check if we got blocked
            if (url.includes('cloudflare') || url.includes('captcha') || url.includes('blocked')) {
                console.log('⚠️  Likely blocked by Cloudflare/anti-bot');
            }

            // Look for search results
            const searchResults = await page.$$eval('.post h2 a, .entry-title a, h2.entry-title a, article h2 a, article h3 a', links => {
                return links.map(link => ({
                    text: link.textContent?.trim(),
                    url: link.href
                }));
            });

            console.log(`Found ${searchResults.length} potential search result links:`);
            searchResults.slice(0, 5).forEach((link, i) => {
                console.log(`  ${i + 1}. ${link.text} -> ${link.url}`);
            });

            // Check page content
            const bodyText = await page.$eval('body', el => el.textContent.substring(0, 500));
            console.log('Page content preview:', bodyText.replace(/\s+/g, ' ').substring(0, 200) + '...');

        } catch (error) {
            console.error('HD-Encode access failed:', error.message);
        }

    } catch (error) {
        console.error('Browser initialization failed:', error);
    } finally {
        if (browser) await browser.close();
    }
}

debugSiteAccess();