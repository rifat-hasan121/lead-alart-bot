import fs from 'fs/promises';
import { Page } from 'playwright';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from '../config/index.js';

// Apply stealth plugin to playwright-extra's chromium
chromium.use(stealthPlugin());

export interface SessionResult {
  isLoggedIn: boolean;
  needsVerification: boolean;
}

/**
 * Creates and configures a browser and context with Facebook session cookies if they exist.
 */
export async function createBrowserContext(headless = true) {
  const browser = await chromium.launch({
    headless,
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
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Attempt to load existing cookies
  try {
    let cookiesData = '';
    if (process.env.FB_COOKIES_JSON) {
      cookiesData = process.env.FB_COOKIES_JSON;
      console.log('Session Manager: Loaded Facebook cookies from environment variable.');
    } else {
      cookiesData = await fs.readFile(config.fbCookiePath, 'utf-8');
      console.log('Session Manager: Loaded Facebook cookies from file.');
    }
    const rawCookies = JSON.parse(cookiesData);
    
    const mappedCookies = Array.isArray(rawCookies) ? rawCookies.map((cookie: any) => {
      const mapped: any = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
      };

      if (typeof cookie.expirationDate === 'number') {
        mapped.expires = cookie.expirationDate;
      }

      if (cookie.sameSite === 'no_restriction') {
        mapped.sameSite = 'None';
      } else if (cookie.sameSite === 'lax') {
        mapped.sameSite = 'Lax';
      } else if (cookie.sameSite === 'strict') {
        mapped.sameSite = 'Strict';
      }

      return mapped;
    }) : [];

    await context.addCookies(mappedCookies);
    console.log('Session Manager: Loaded and formatted Facebook cookies.');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`Session Manager: Cookies file not found at "${config.fbCookiePath}". You must run the export-cookies script first.`);
    } else {
      console.error('Session Manager: Error reading cookies file:', error);
    }
  }

  return { browser, context };
}

/**
 * Verifies if the browser page is currently logged into Facebook.
 */
export async function verifySession(page: Page): Promise<SessionResult> {
  try {
    console.log('Session Manager: Checking Facebook session status...');
    
    // Navigate to Facebook main page
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Give elements a brief moment to settle/redirect
    await page.waitForTimeout(3000);
    
    const currentUrl = page.url();
    
    // Check if redirecting to a checkpoint/verification URL
    if (currentUrl.includes('checkpoint') || currentUrl.includes('confirmcontact')) {
      console.warn('Session Manager: Facebook checkpoint/verification required.');
      return { isLoggedIn: false, needsVerification: true };
    }
    
    // Check for login forms or elements
    const loginButtonExists = await page.$('input[name="email"], button[name="login"], [data-testid="royal_login_button"]');
    if (loginButtonExists) {
      console.log('Session Manager: Login fields detected. Session has expired or is invalid.');
      return { isLoggedIn: false, needsVerification: false };
    }
    
    // Check for indicators of being logged in (profile menu, home page feed, notifications, navigation bar)
    const loggedInIndicator = await page.$('[aria-label="Your profile"], [role="navigation"] [aria-label="Facebook"], [role="feed"]');
    if (loggedInIndicator) {
      console.log('Session Manager: Valid logged-in session verified.');
      return { isLoggedIn: true, needsVerification: false };
    }
    
    // Fallback: Check if URL still contains login pages
    if (currentUrl.includes('login.php') || currentUrl.includes('/login/')) {
      console.log('Session Manager: Redirected to login URL.');
      return { isLoggedIn: false, needsVerification: false };
    }
    
    // Default fallback: Check if email/pass forms are absent
    console.log('Session Manager: No login elements found. Assuming session is valid.');
    return { isLoggedIn: true, needsVerification: false };
  } catch (error) {
    console.error('Session Manager: Error during session verification:', error);
    return { isLoggedIn: false, needsVerification: false };
  }
}
