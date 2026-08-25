import { parseFacebookTimestamp } from '../scrapers/groupScraper.js';

function testTimestamp() {
  console.log('Testing Facebook Timestamp Parser...\n');

  const testCases = [
    'Just now',
    'now',
    '5 mins',
    '15m',
    '2 hrs',
    '12h',
    '2 days',
    '1d',
    'Yesterday at 4:30 PM',
    'Yesterday at 11:24 am',
    'August 22 at 11:24 AM',
    '25 August 2026 at 14:45',
    'Tuesday, August 25, 2026 at 2:45 PM',
  ];

  const nowStr = new Date().toLocaleString();
  console.log(`Current Local Time: ${nowStr}\n`);

  for (const tc of testCases) {
    const date = parseFacebookTimestamp(tc);
    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
    const formatted = date.toLocaleString('en-US', options);
    const ageInHours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
    const isOld = ageInHours > 24;
    console.log(`Input: "${tc}"`);
    console.log(`Parsed: ${formatted}`);
    console.log(`Age: ${ageInHours.toFixed(2)} hours (Skip: ${isOld})\n`);
  }
}

testTimestamp();
