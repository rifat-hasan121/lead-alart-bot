import { Page } from 'playwright';
import { prisma } from '../db/prisma.js';
import { sleep } from '../utils/index.js';

export interface ExtractedPost {
  fbPostId: string;
  authorName: string;
  content: string;
  postUrl: string;
}

/**
 * Normalizes text to lowercase and removes extra whitespaces for resilient matching (Bengali/English).
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
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
    return { isMatch: false, matchedRoles: [], matchedIntents: [], matchedNegatives };
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

  // Human-like scrolling loop (scrolling down 3 times)
  console.log('[Group Scraper] Scrolling down feed to fetch recent activity...');
  const scrolls = 3;
  for (let i = 0; i < scrolls; i++) {
    const scrollAmount = Math.floor(Math.random() * 401) + 400; // random scroll step: 400px - 800px
    await page.evaluate((y) => (globalThis as any).scrollBy(0, y), scrollAmount);
    
    // Human-like delay of 2 to 5 seconds
    const delay = Math.floor(Math.random() * 3001) + 2000;
    await sleep(delay);
  }

  const posts: ExtractedPost[] = [];

  // Query post container articles
  const articles = await page.$$('div[role="article"]');
  console.log(`[Group Scraper] Found ${articles.length} article elements. Parsing posts...`);

  for (const article of articles) {
    try {
      const links = await article.$$('a');
      let postUrl = '';
      let fbPostId = '';
      let authorName = 'Unknown';

      // 1. Find the post ID and URL
      for (const link of links) {
        const href = await link.getAttribute('href');
        if (!href) continue;

        const isPermalink = href.includes('/permalink/') || href.includes('/posts/') || href.includes('multi_permalinks=');
        if (isPermalink && !postUrl) {
          postUrl = href.split('?')[0]; // Strip tracking queries
          
          // Regex extraction for common post ID configurations
          const permalinkMatch = href.match(/\/permalink\/(\d+)/);
          const postsMatch = href.match(/\/posts\/(\d+)/);
          const multiMatch = href.match(/multi_permalinks=(\d+)/);

          if (permalinkMatch) {
            fbPostId = permalinkMatch[1];
          } else if (postsMatch) {
            fbPostId = postsMatch[1];
          } else if (multiMatch) {
            fbPostId = multiMatch[1];
          }
        }
      }

      // Skip parsing if we can't reliably isolate the Facebook Post ID
      if (!fbPostId) continue;

      // 2. Find Author Name
      for (const link of links) {
        const text = (await link.innerText()).trim();
        const href = await link.getAttribute('href');
        if (!href) continue;

        // Skip non-profile links
        const isNotAuthorUrl = href.includes('/posts/') || href.includes('/permalink/') || href.includes('/groups/') || href.includes('/hashtag/');
        if (text && !isNotAuthorUrl && authorName === 'Unknown') {
          authorName = text;
          break;
        }
      }

      // 3. Find Post Text content
      let content = '';
      const textContainers = await article.$$('div[dir="auto"], div[data-ad-preview="message"]');
      for (const container of textContainers) {
        const text = (await container.innerText()).trim();
        // Take the longest block of text in the post (usually the body)
        if (text && text.length > content.length) {
          content = text;
        }
      }

      if (!content) continue;

      posts.push({
        fbPostId,
        authorName,
        content,
        postUrl: postUrl || `${groupUrl}/posts/${fbPostId}`,
      });
    } catch (e) {
      console.error('[Group Scraper] Error extracting post details:', e);
    }
  }

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
  
  const keywordsList = activeKeywords.map(k => k.phrase);
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
