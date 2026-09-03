import { Page } from 'playwright';
import { prisma } from '../db/prisma.js';
import { sleep } from '../utils/index.js';

export interface ExtractedPost {
  fbPostId: string;
  authorName: string;
  content: string;
  postUrl: string;
  postCreatedAt?: Date;
  rawTimestampText?: string;
}

/**
 * Normalizes text to lowercase and removes extra whitespaces for resilient matching (Bengali/English).
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Helper to parse a time part (e.g. "11:24 AM", "16:30") on top of a base date.
 */
function parseTimePart(baseDate: Date, timeStr: string): Date | null {
  try {
    const cleanTime = timeStr.trim();
    const match = cleanTime.match(/^(\d+):(\d+)\s*(am|pm)?/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const ampm = match[3];

      if (ampm) {
        if (ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
        if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
      }
      
      const newDate = new Date(baseDate);
      newDate.setHours(hours, minutes, 0, 0);
      return newDate;
    }
  } catch (e) {
    // Ignore error
  }
  return null;
}

/**
 * Parses relative and absolute Facebook timestamp texts into a Javascript Date object.
 */
export function parseFacebookTimestamp(text: string): Date {
  const now = new Date();
  if (!text) return now;

  // Convert Bengali digits (০-৯) to English digits (0-9)
  let cleanText = text.trim().toLowerCase()
    .replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d).toString());

  // Replace Bengali relative time terms
  cleanText = cleanText
    .replace(/মিনিট|মি/g, 'mins')
    .replace(/ঘণ্টা|ঘন্টা|ঘ/g, 'hrs')
    .replace(/দিন/g, 'days')
    .replace(/গতকাল/g, 'yesterday');

  if (!cleanText || cleanText.includes('just now') || cleanText === 'now') {
    return now;
  }

  // Check for relative minutes: e.g. "5 mins", "5m", "1 min"
  const minMatch = cleanText.match(/^(\d+)\s*(m|min|mins|minute|minutes)/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    return new Date(now.getTime() - mins * 60 * 1000);
  }

  // Check for relative hours: e.g. "1h", "2 hrs", "2 hrs ago", "2h"
  const hourMatch = cleanText.match(/^(\d+)\s*(h|hr|hrs|hour|hours)/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return new Date(now.getTime() - hours * 60 * 60 * 1000);
  }

  // Check for relative days: e.g. "1d", "2d", "2 days"
  const dayMatch = cleanText.match(/^(\d+)\s*(d|day|days)/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  // Check for "Yesterday at 4:32 PM"
  if (cleanText.includes('yesterday')) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const timePart = cleanText.split('at')[1];
    if (timePart) {
      const parsedTime = parseTimePart(yesterday, timePart);
      if (parsedTime) return parsedTime;
    }
    return yesterday;
  }

  // Parse absolute dates (e.g., "August 22 at 11:24 AM")
  let standardDateStr = cleanText.replace(/\bat\b/g, ' ');
  
  const hasYear = /\b20\d{2}\b/.test(standardDateStr);
  if (!hasYear) {
    standardDateStr = `${standardDateStr} ${now.getFullYear()}`;
  }

  const parsedDate = new Date(standardDateStr);
  if (!isNaN(parsedDate.getTime())) {
    if (parsedDate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      parsedDate.setFullYear(parsedDate.getFullYear() - 1);
    }
    return parsedDate;
  }

  return now;
}

/**
 * Validates if the content matches any of the active keywords (case-insensitive substring check).
 */
export function isKeywordMatch(content: string, keywords: string[]): boolean {
  const normalizedContent = normalizeText(content);
  return keywords.some(keyword => {
    const normalizedKw = normalizeText(keyword);
    return normalizedContent.includes(normalizedKw);
  });
}

export interface KeywordInfo {
  phrase: string;
  type: string;
}

/**
 * Validates if a post is a valid lead:
 * Must contain at least one Role keyword AND one Intent keyword AND zero Negative keywords.
 */
export function checkLeadMatch(content: string, keywords: KeywordInfo[]) {
  const normalizedContent = normalizeText(content);
  
  const roleKeywords = keywords.filter(k => k.type === 'role').map(k => normalizeText(k.phrase));
  const intentKeywords = keywords.filter(k => k.type === 'intent').map(k => normalizeText(k.phrase));
  const negativeKeywords = keywords.filter(k => k.type === 'negative').map(k => normalizeText(k.phrase));

  // 1. Check for negative keywords (Early exit if any match)
  const matchedNegatives = negativeKeywords.filter(kw => normalizedContent.includes(kw));
  if (matchedNegatives.length > 0) {
    return {
      isMatch: false,
      matchedRoles: [],
      matchedIntents: [],
      matchedNegatives: keywords.filter(k => k.type === 'negative' && normalizedContent.includes(normalizeText(k.phrase))).map(k => k.phrase),
    };
  }

  // 2. Check for role keywords
  const matchedRoles = roleKeywords.filter(kw => normalizedContent.includes(kw));
  
  // 3. Check for intent keywords
  const matchedIntents = intentKeywords.filter(kw => normalizedContent.includes(kw));

  const isMatch = matchedRoles.length > 0 && matchedIntents.length > 0;

  return {
    isMatch,
    // Return original (un-normalized) case matching keywords for reporting
    matchedRoles: keywords.filter(k => k.type === 'role' && normalizedContent.includes(normalizeText(k.phrase))).map(k => k.phrase),
    matchedIntents: keywords.filter(k => k.type === 'intent' && normalizedContent.includes(normalizeText(k.phrase))).map(k => k.phrase),
    matchedNegatives: [],
  };
}

/**
 * Navigates to a target group, scrolls human-like, and extracts the recent posts.
 */
export async function scrapeGroupFeed(page: Page, groupUrl: string): Promise<ExtractedPost[]> {
  // Construct URL with chronological sorting (most recent activity first)
  const urlObj = new URL(groupUrl);
  urlObj.searchParams.set('sorting_setting', 'CHRONOLOGICAL');
  const targetUrl = urlObj.toString();

  console.log(`[Group Scraper] Navigating to group feed: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Wait for initial load
  await sleep(4000);

  // Try to force "New posts" sorting if not already selected
  try {
    const dropdownTrigger = page.locator('div[role="feed"] [role="button"]:has-text("Most relevant"), div[role="feed"] [role="button"]:has-text("Recent activity"), [role="button"]:has-text("Most relevant"), [role="button"]:has-text("Recent activity")').first();
    if (await dropdownTrigger.isVisible()) {
      console.log('[Group Scraper] Sorting dropdown trigger detected. Clicking to select chronological...');
      await dropdownTrigger.click();
      await page.waitForTimeout(1500);
      
      const newPostsOption = page.locator('[role="menuitem"] span:has-text("New posts"), [role="menuitem"] span:has-text("Recent activity"), [role="menuitem"] span:has-text("Recent Activity")').first();
      if (await newPostsOption.isVisible()) {
        await newPostsOption.click();
        console.log('[Group Scraper] Selected "New posts" / "Recent activity" sorting option.');
        await page.waitForTimeout(3000);
      } else {
        const generalOption = page.locator('span:has-text("New posts"), span:has-text("Recent activity")').first();
        if (await generalOption.isVisible()) {
          await generalOption.click();
          console.log('[Group Scraper] Selected general sorting option.');
          await page.waitForTimeout(3000);
        } else {
          await page.keyboard.press('Escape');
        }
      }
    }
  } catch (e) {
    console.warn('[Group Scraper] Non-blocking warning: Could not adjust sorting dropdown selector:', e);
  }

  const postsMap = new Map<string, ExtractedPost>();
  let consecutiveOldPosts = 0;
  const maxScrollPasses = 10;

  console.log('[Group Scraper] Starting incremental scroll and post evaluation...');

  for (let scrollPass = 1; scrollPass <= maxScrollPasses; scrollPass++) {
    // Query post container articles
    const articles = await page.$$('div[role="article"]');
    console.log(`[Group Scraper] [Pass ${scrollPass}/${maxScrollPasses}] Found ${articles.length} article elements on page.`);

    for (const article of articles) {
      try {
        // Ignore nested comment articles
        const isNestedComment = await article.evaluate((node) => {
          let parent = node.parentElement;
          while (parent) {
            if (parent.getAttribute('role') === 'article') {
              return true;
            }
            parent = parent.parentElement;
          }
          return false;
        });
        if (isNestedComment) continue;

        const links = await article.$$('a');
        let postUrl = '';
        let fbPostId = '';
        let authorName = 'Unknown';
        let timestampText = '';

        // 1. Find the post ID, URL and raw timestamp text from permalink links
        for (const link of links) {
          const href = await link.getAttribute('href');
          if (!href) continue;

          const isPermalink = href.includes('/permalink/') || href.includes('/posts/') || href.includes('multi_permalinks=') || href.includes('story_fbid=');
          if (isPermalink && !postUrl) {
            postUrl = href.split('?')[0]; // Strip tracking queries
            
            const permalinkMatch = href.match(/\/permalink\/([a-zA-Z0-9_-]+)/);
            const postsMatch = href.match(/\/posts\/([a-zA-Z0-9_-]+)/);
            const multiMatch = href.match(/multi_permalinks=([a-zA-Z0-9_-]+)/);
            const storyMatch = href.match(/story_fbid=([a-zA-Z0-9_-]+)/);

            if (permalinkMatch) {
              fbPostId = permalinkMatch[1];
            } else if (postsMatch) {
              fbPostId = postsMatch[1];
            } else if (multiMatch) {
              fbPostId = multiMatch[1];
            } else if (storyMatch) {
              fbPostId = storyMatch[1];
            }

            const ariaLabel = await link.getAttribute('aria-label');
            const innerText = (await link.innerText()).trim();
            timestampText = ariaLabel || innerText;
          }
        }

        // Skip parsing if we can't reliably isolate the Facebook Post ID or already processed
        if (!fbPostId || postsMap.has(fbPostId)) continue;

        // Fallback: check for standard <abbr> elements inside this article if timestampText is empty
        if (!timestampText) {
          const abbr = await article.$('abbr');
          if (abbr) {
            const innerText = (await abbr.innerText()).trim();
            const titleText = await abbr.getAttribute('title');
            timestampText = innerText || titleText || '';
          }
        }

        // Parse timestamp into standardised Date object
        const postCreatedAt = parseFacebookTimestamp(timestampText);
        const ageInMs = Date.now() - postCreatedAt.getTime();
        const ageInHours = ageInMs / (1000 * 60 * 60);

        // Check if post is pinned/featured
        const isPinned = await article.evaluate((node) => {
          const text = (node.innerText || '').toLowerCase();
          return text.includes('pinned post') || text.includes('featured') || text.includes('pin') || text.includes('পিন');
        });

        // AGE FILTER: Ignore if older than 24 hours (1 day)
        if (ageInHours > 24) {
          if (!isPinned) {
            consecutiveOldPosts++;
          }
          console.log(`[Group Scraper] Skipping post ${fbPostId} - published ${ageInHours.toFixed(1)} hours ago (>24h). Consecutive old posts: ${consecutiveOldPosts}/10. Timestamp: "${timestampText}"`);
          
          if (consecutiveOldPosts >= 10 && scrollPass >= 2) {
            console.log(`[Group Scraper] Reached 10 consecutive posts older than 24h. Stopping scroll and moving to next group.`);
            break;
          }
          continue;
        } else {
          // Found a post within 24 hours, reset count
          consecutiveOldPosts = 0;
        }

        // Click "See more" if present to expand full post text
        try {
          const seeMoreBtn = await article.$('div[role="button"]:has-text("See more"), div[role="button"]:has-text("See More"), div[role="button"]:has-text("আরও দেখুন")');
          if (seeMoreBtn) {
            await seeMoreBtn.click();
            await sleep(500);
          }
        } catch (e) {}

        // 2. Find Author Name
        for (const link of links) {
          const text = (await link.innerText()).trim();
          const href = await link.getAttribute('href');
          if (!href) continue;

          const isNotAuthorUrl = href.includes('/posts/') || href.includes('/permalink/') || href.includes('/groups/') || href.includes('/hashtag/');
          if (text && !isNotAuthorUrl && authorName === 'Unknown') {
            authorName = text;
            break;
          }
        }

        // 3. Extract Post Body content strictly (excluding comments)
        let content = '';
        const messageElem = await article.$('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
        if (messageElem) {
          content = (await messageElem.innerText()).trim();
        } else {
          const textContainers = await article.$$('div[dir="auto"]');
          for (const container of textContainers) {
            const isInsideComment = await container.evaluate((node) => {
              let p = node.parentElement;
              while (p) {
                const role = p.getAttribute('role');
                const ariaLabel = (p.getAttribute('aria-label') || '').toLowerCase();
                if ((role === 'article' && p !== node.closest('div[role="article"]')) || ariaLabel.includes('comment') || p.tagName === 'UL') {
                  return true;
                }
                p = p.parentElement;
              }
              return false;
            });

            if (!isInsideComment) {
              const text = (await container.innerText()).trim();
              if (text && text.length > content.length) {
                content = text;
              }
            }
          }
        }

        if (!content) continue;

        postsMap.set(fbPostId, {
          fbPostId,
          authorName,
          content,
          postUrl: postUrl || `${groupUrl}/posts/${fbPostId}`,
          postCreatedAt,
          rawTimestampText: timestampText,
        });

        console.log(`[Group Scraper] Extracted post ${fbPostId} by "${authorName}" (${ageInHours.toFixed(1)}h ago).`);
      } catch (e) {
        console.error('[Group Scraper] Error extracting post details:', e);
      }
    }

    if (consecutiveOldPosts >= 10 && scrollPass >= 2) {
      break;
    }

    // Scroll down feed using multiple methods (window, feed container, and PageDown keys) to trigger Facebook lazy loading
    const scrollAmount = Math.floor(Math.random() * 401) + 600; // 600px - 1000px
    await page.evaluate((y) => {
      const g = globalThis as any;
      if (g.scrollBy) g.scrollBy(0, y);
      const feedContainer = g.document?.querySelector('div[role="feed"]');
      if (feedContainer?.scrollBy) {
        feedContainer.scrollBy(0, y);
      }
    }, scrollAmount);

    try {
      await page.mouse.wheel(0, 1000);
      await sleep(500);
      await page.keyboard.press('PageDown');
      await sleep(500);
      await page.keyboard.press('PageDown');
    } catch (e) {}

    await sleep(3000);
  }

  const posts = Array.from(postsMap.values());
  console.log(`[Group Scraper] Total recent candidate posts extracted from group: ${posts.length}`);
  return posts;
}

/**
 * Main coordinator function to check all active monitored groups for keyword matches.
 */
export async function monitorActiveGroups(page: Page) {
  console.log('[Group Scraper] Fetching active keywords and groups...');
  
  const activeKeywords = await prisma.keyword.findMany({
    where: { isActive: true },
  });
  
  if (activeKeywords.length === 0) {
    console.warn('[Group Scraper] No active keywords in DB. Aborting scraper run.');
    return;
  }
  
  const keywordsList = activeKeywords.map((k: any) => k.phrase);
  console.log(`[Group Scraper] Active keywords: ${keywordsList.join(', ')}`);

  const monitoredGroups = await prisma.monitoredGroup.findMany({
    where: { isActive: true },
  });

  if (monitoredGroups.length === 0) {
    console.warn('[Group Scraper] No active groups to monitor. Aborting scraper run.');
    return;
  }

  for (const group of monitoredGroups) {
    console.log(`[Group Scraper] Checking group: ${group.name} (${group.groupUrl})`);
    try {
      const posts = await scrapeGroupFeed(page, group.groupUrl);
      console.log(`[Group Scraper] Scraped ${posts.length} posts from "${group.name}".`);

      for (const post of posts) {
        const matchResult = checkLeadMatch(post.content, activeKeywords);
        if (matchResult.isMatch) {
          console.log(`[Group Scraper] Keyword Match Found! Author: ${post.authorName}`);
          
          // Check for duplication in DB
          const existingPost = await prisma.trackedPost.findUnique({
            where: { fbPostId: post.fbPostId },
          });

          if (!existingPost) {
            await prisma.trackedPost.create({
              data: {
                fbPostId: post.fbPostId,
                groupUrl: group.groupUrl,
                authorName: post.authorName,
                content: post.content,
                postUrl: post.postUrl,
                isMatched: true,
                postCreatedAt: post.postCreatedAt,
              },
            });
            console.log(`[Group Scraper] Database saved new matched lead: ${post.fbPostId}`);
          } else {
            console.log(`[Group Scraper] Lead ${post.fbPostId} already tracked. Skipping.`);
          }
        }
      }
    } catch (error) {
      console.error(`[Group Scraper] Error scraping group "${group.name}":`, error);
    }
  }
}
