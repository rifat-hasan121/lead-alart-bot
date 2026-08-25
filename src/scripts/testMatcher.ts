import { checkLeadMatch } from '../scrapers/groupScraper.js';
import { prisma } from '../db/prisma.js';

async function test() {
  console.log('Testing Lead Matcher Logic...\n');
  
  const keywords = await prisma.keyword.findMany({ where: { isActive: true } });
  console.log(`Loaded ${keywords.length} active keywords from DB.\n`);

  const testCases = [
    {
      name: 'Valid lead (English)',
      text: 'Looking for a react developer to build our new website! Budget: $1000.',
      expected: true,
    },
    {
      name: 'Valid lead (Bengali)',
      text: 'একটি ই-কমার্স ওয়েবসাইট তৈরি করতে চাই। কে কে পারবেন? পোর্টফোলিও দিন।',
      expected: true,
    },
    {
      name: 'Invalid lead (No intent keyword)',
      text: 'React and wordpress are popular technologies for website front-end.',
      expected: false,
    },
    {
      name: 'Invalid lead (Contains negative keyword - Job seeker)',
      text: 'I am a web developer looking for a project to build custom website.',
      expected: false,
    },
    {
      name: 'Invalid lead (Bengali, no role keyword)',
      text: 'জরুরি ভিত্তিতে কাউকে খুঁজছি। ইনবক্স দিন।',
      expected: false,
    },
    {
      name: 'Invalid lead (Bengali negative keyword)',
      text: 'আমি ওয়েবসাইট বানিয়ে দেই, কাজ খুঁজছি। নতুন অফার চলছে!',
      expected: false,
    },
  ];

  for (const tc of testCases) {
    const result = checkLeadMatch(tc.text, keywords);
    const pass = result.isMatch === tc.expected;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] "${tc.name}":`);
    console.log(`  Text: "${tc.text}"`);
    console.log(`  Is Match: ${result.isMatch} (Expected: ${tc.expected})`);
    if (result.isMatch) {
      console.log(`  Matched Roles: ${result.matchedRoles.join(', ')}`);
      console.log(`  Matched Intents: ${result.matchedIntents.join(', ')}`);
    } else {
      // Find matches for negatives to display
      const normalized = tc.text.toLowerCase();
      const negativesMatched = keywords
        .filter((k: any) => k.type === 'negative' && normalized.includes(k.phrase.toLowerCase()))
        .map((k: any) => k.phrase);
      if (negativesMatched.length > 0) {
        console.log(`  Blocked by Negatives: ${negativesMatched.join(', ')}`);
      }
    }
    console.log();
  }
  
  await prisma.$disconnect();
}

test().catch(console.error);
