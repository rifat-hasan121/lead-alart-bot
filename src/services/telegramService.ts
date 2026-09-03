import { Telegram } from 'telegraf';
import { config } from '../config/index.js';

const telegram = new Telegram(config.telegramBotToken);

export interface LeadAlertData {
  groupName: string;
  groupUrl: string;
  authorName: string;
  matchedKeywords: string[];
  content: string;
  postUrl: string;
  postCreatedAt?: Date;
  rawTimestampText?: string;
}

/**
 * Escapes characters that interfere with Telegram's HTML parsing.
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a JavaScript Date to local string representation.
 */
function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };
  return date.toLocaleString('en-US', options);
}

/**
 * Formats and sends an HTML lead alert to Telegram.
 */
export async function sendLeadAlert(data: LeadAlertData): Promise<boolean> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.warn('[Telegram Service] Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured in .env.');
    return false;
  }

  const snippet = data.content.length > 300 
    ? `${data.content.substring(0, 300)}...` 
    : data.content;

  const matchedKeywordsStr = data.matchedKeywords.join(', ');

  let timeStr = 'Recent';
  if (data.postCreatedAt) {
    const formattedDate = formatDate(data.postCreatedAt);
    timeStr = data.rawTimestampText 
      ? `${formattedDate} (${data.rawTimestampText})`
      : formattedDate;
  }

  const message = [
    `🚨 <b>New Web Lead Found!</b>`,
    ``,
    `👥 <b>Group:</b> <a href="${data.groupUrl}">${escapeHtml(data.groupName)}</a>`,
    `👤 <b>Author:</b> ${escapeHtml(data.authorName)}`,
    `🕒 <b>Posted At:</b> ${escapeHtml(timeStr)}`,
    `🔍 <b>Matched Keywords:</b> <code>${escapeHtml(matchedKeywordsStr)}</code>`,
    `📝 <b>Snippet:</b> <i>"${escapeHtml(snippet)}"</i>`,
    ``,
    `🔗 <b>Direct Post Link:</b> <a href="${data.postUrl}">Open Post on Facebook</a>`
  ].join('\n');

  try {
    await telegram.sendMessage(config.telegramChatId, message, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    console.log(`[Telegram Service] Alert sent successfully for lead: ${data.postUrl}`);
    return true;
  } catch (error: any) {
    console.error('[Telegram Service] Error sending message to Telegram:', error);
    
    // Graceful rate-limit handling
    if (error.response && error.response.error_code === 429) {
      const retryAfter = error.response.parameters?.retry_after || 5;
      console.warn(`[Telegram Service] Rate limited by Telegram API. Retrying after ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return sendLeadAlert(data); // Retry sending
    }
    
    return false;
  }
}
