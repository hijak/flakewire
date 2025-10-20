const { chromium } = require('playwright');

async function testPlaywright() {
  console.log('Testing Playwright installation...');

  try {
    // Try to launch browser
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    console.log('✓ Browser launched successfully');

    // Create a page
    const page = await browser.newPage();
    console.log('✓ Page created successfully');

    // Navigate to a simple site
    await page.goto('https://example.com');
    console.log('✓ Navigation successful');

    // Get page title
    const title = await page.title();
    console.log('✓ Page title:', title);

    // Close browser
    await browser.close();
    console.log('✓ Browser closed successfully');

    console.log('\n🎉 Playwright test completed successfully!');

  } catch (error) {
    console.error('❌ Playwright test failed:', error.message);
    process.exit(1);
  }
}

testPlaywright();