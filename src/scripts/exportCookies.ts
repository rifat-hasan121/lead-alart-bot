import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';

// Apply stealth plugin
chromium.use(stealthPlugin());

async function run() {
  console.log('==================================================');
  console.log('Facebook Cookie Exporter Tool');
  console.log('==================================================');
  console.log('This script will launch a headed browser.');
  console.log('Please log in to your Facebook account manually.');
  console.log('The script will automatically detect when you are logged in,');
  console.log(`and save your cookies to: ${config.fbCookiePath}`);
  console.log('==================================================\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  });

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  
  // Go to Facebook
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

  console.log('Waiting for successful login...');
  
  let loggedIn = false;
  
  // Poll every 3 seconds to check if logged in
  while (!loggedIn) {
    try {
      await page.waitForTimeout(3000);
      
      // Check if page closed or browser disconnected
      if (page.isClosed()) {
        console.log('Browser window was closed. Exiting...');
        break;
      }
      
      const currentUrl = page.url();
      
      // Check if we are logged in
      const loginButtonExists = await page.$('input[name="email"], button[name="login"]');
      const profileButtonExists = await page.$('[aria-label="Your profile"], [role="navigation"] [aria-label="Facebook"], [role="feed"]');
      
      if (profileButtonExists && !loginButtonExists && !currentUrl.includes('checkpoint')) {
        loggedIn = true;
        console.log('\nSuccess! Logged in state detected.');
        break;
      }
    } catch (e) {
      console.log('Browser window may have been closed.');
      break;
    }
  }

  if (loggedIn) {
    const cookies = await context.cookies();
    // Ensure parent directories exist
    const dir = path.dirname(config.fbCookiePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(config.fbCookiePath, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`Cookies saved successfully to: ${config.fbCookiePath}`);
  } else {
    console.log('Failed to export cookies. Make sure you complete login before closing the browser.');
  }

  await browser.close();
}

run().catch((err) => {
  console.error('Error exporting cookies:', err);
});
