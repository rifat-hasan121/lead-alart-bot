import http from 'http';
import { createBrowserContext, verifySession } from './scrapers/sessionManager.js';
import { scrapeGroupFeed, checkLeadMatch } from './scrapers/groupScraper.js';
import { sendLeadAlert } from './services/telegramService.js';
import { prisma } from './db/prisma.js';
import { sleep } from './utils/index.js';

async function main() {
  console.log(`[${new Date().toISOString()}] INFO: Facebook Group Web Lead Monitoring Bot started.`);

  // Start lightweight HTTP health check server for Render.com
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[${new Date().toISOString()}] WARN: Port ${PORT} is already in use. Skipping server listen, bot will continue running.`);
    } else {
      console.error(`[${new Date().toISOString()}] ERROR: Health check server error:`, err);
    }
  });

  server.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] INFO: Health Check Server listening on port ${PORT}`);
  });
  
  while (true) {
    console.log(`\n[${new Date().toISOString()}] INFO: --- Starting check cycle ---`);
    
    try {
      // 1. Fetch active keywords with retry logic for cold-start database connections
      let activeKeywords: any[] = [];
      let retries = 3;
      while (retries > 0) {
        try {
          activeKeywords = await prisma.keyword.findMany({
            where: { isActive: true },
          });
          break;
        } catch (dbErr) {
          retries--;
          if (retries === 0) throw dbErr;
          console.warn(`[${new Date().toISOString()}] WARN: Database connection retry (${3 - retries}/3)...`);
          await sleep(2000);
        }
      }
      
      if (activeKeywords.length === 0) {
        console.warn(`[${new Date().toISOString()}] WARN: No active keywords found. Skipping this cycle.`);
      } else {
        console.log(`[${new Date().toISOString()}] INFO: Loaded ${activeKeywords.length} active keywords.`);
        
        // 2. Fetch active monitored groups
        const monitoredGroups = await prisma.monitoredGroup.findMany({
          where: { isActive: true },
        });
        
        if (monitoredGroups.length === 0) {
          console.warn(`[${new Date().toISOString()}] WARN: No active monitored groups found.`);
        } else {
          // 3. Process each group sequentially
          for (const group of monitoredGroups) {
            console.log(`\n[${new Date().toISOString()}] INFO: Processing group: ${group.name} (${group.groupUrl})`);
            
            let browser;
            let context;
            try {
              // Open browser context
              const session = await createBrowserContext(true); // Run headless in production
              browser = session.browser;
              context = session.context;
              
              const page = await context.newPage();
              
              // Verify session
              const sessionCheck = await verifySession(page);
              if (!sessionCheck.isLoggedIn) {
                console.error(`[${new Date().toISOString()}] ERROR: Facebook session is invalid! Checkpoint or Login required.`);
                await sendLeadAlert({
                  groupName: 'SYSTEM ALERT',
                  groupUrl: 'https://facebook.com',
                  authorName: 'System Bot',
                  matchedKeywords: ['SESSION_EXPIRED'],
                  content: sessionCheck.needsVerification 
                    ? 'Facebook session requires checkpoint verification (2FA/approval). Please log in manually using the exporter script.' 
                    : 'Facebook session cookies have expired. Please log in again using the exporter script.',
                  postUrl: 'https://facebook.com',
                });
                break; // Exit group loop to avoid spamming Facebook with failing login pages
              }
              
              // Scrape feed
              const posts = await scrapeGroupFeed(page, group.groupUrl);
              console.log(`[${new Date().toISOString()}] INFO: Extracted ${posts.length} candidate posts.`);
              
              // Process posts
              for (const post of posts) {
                const matchResult = checkLeadMatch(post.content, activeKeywords);
                if (matchResult.isMatch) {
                  console.log(`[${new Date().toISOString()}] MATCH FOUND! Post ${post.fbPostId} matched roles: [${matchResult.matchedRoles.join(', ')}], intents: [${matchResult.matchedIntents.join(', ')}]`);
                  
                  // Check if already stored and notified in database
                  const existing = await prisma.trackedPost.findUnique({
                    where: { fbPostId: post.fbPostId },
                  });
                  
                  if (!existing || !existing.notifiedAt) {
                    console.log(`[${new Date().toISOString()}] INFO: Sending Telegram alert for lead: ${post.fbPostId}`);
                    
                    const sent = await sendLeadAlert({
                      groupName: group.name,
                      groupUrl: group.groupUrl,
                      authorName: post.authorName,
                      matchedKeywords: [...matchResult.matchedRoles, ...matchResult.matchedIntents],
                      content: post.content,
                      postUrl: post.postUrl,
                      postCreatedAt: post.postCreatedAt,
                      rawTimestampText: post.rawTimestampText,
                    });

                    if (sent) {
                      if (!existing) {
                        await prisma.trackedPost.create({
                          data: {
                            fbPostId: post.fbPostId,
                            groupUrl: group.groupUrl,
                            authorName: post.authorName,
                            content: post.content,
                            postUrl: post.postUrl,
                            isMatched: true,
                            notifiedAt: new Date(),
                            postCreatedAt: post.postCreatedAt,
                          },
                        });
                      } else {
                        await prisma.trackedPost.update({
                          where: { id: existing.id },
                          data: {
                            isMatched: true,
                            notifiedAt: new Date(),
                          },
                        });
                      }
                      console.log(`[${new Date().toISOString()}] SUCCESS: TrackedPost stored and Telegram alert sent for ${post.fbPostId}`);
                    }
                  } else {
                    console.log(`[${new Date().toISOString()}] INFO: Lead ${post.fbPostId} was already notified on Telegram. Skipping duplicate alert.`);
                  }
                } else {
                  const snippet = post.content.replace(/\s+/g, ' ').substring(0, 60);
                  if (matchResult.matchedNegatives.length > 0) {
                    console.log(`[${new Date().toISOString()}] REJECTED: Post ${post.fbPostId} blocked by negative keywords: [${matchResult.matchedNegatives.join(', ')}]. Snippet: "${snippet}..."`);
                  } else {
                    console.log(`[${new Date().toISOString()}] NO MATCH: Post ${post.fbPostId} - Matched roles: [${matchResult.matchedRoles.join(', ')}], intents: [${matchResult.matchedIntents.join(', ')}]. Snippet: "${snippet}..."`);
                  }
                }
              }
            } catch (err) {
              console.error(`[${new Date().toISOString()}] ERROR: Error during scraping group "${group.name}":`, err);
            } finally {
              if (browser) {
                await browser.close();
              }
            }
            
            // Random delay between groups (e.g. 15 to 45 seconds) to mimic human behavior
            const interGroupDelay = Math.floor(Math.random() * 31) + 15;
            console.log(`[${new Date().toISOString()}] INFO: Waiting ${interGroupDelay} seconds before next group...`);
            await sleep(interGroupDelay * 1000);
          }
        }
      }
    } catch (cycleError) {
      console.error(`[${new Date().toISOString()}] ERROR: Critical error during current check cycle:`, cycleError);
    }
    
    // 4. Random delay before the next cycle (3 to 7 minutes)
    const delayMinutes = Math.floor(Math.random() * 5) + 3; // 3 to 7 minutes
    const delayMs = delayMinutes * 60 * 1000;
    console.log(`\n[${new Date().toISOString()}] INFO: Check cycle finished. Sleeping for ${delayMinutes} minutes...`);
    await sleep(delayMs);
  }
}

main().catch((err) => {
  console.error('CRITICAL FATAL: Application crashed in main loop:', err);
  process.exit(1);
});
