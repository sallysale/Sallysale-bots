// ════════════════════════════════════════════════════════════
// BOT-31 — Telegram Bot
// תפקיד: שולח דילים עם ציון ≥ 80 לערוץ Telegram.
//
// כללי שליחה:
//   • מקסימום 20 דילים ליום (04:00–23:59 UTC)
//   • ממוין לפי score DESC
//   • רק דילים שלא נשלחו עדיין (telegram_sent_at IS NULL)
//   • רק דילים פעילים (status = 'active')
//   • הפוגה 3 שניות בין הודעות (מניעת flood)
//
// API: Telegram Bot API (sendMessage)
// פורמט: Markdown V2 עם emoji
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
//         אבל מגביל שליחה ל-20/יום בפנים
//
// Env vars:
//   TELEGRAM_BOT_TOKEN   — מ-@BotFather
//   TELEGRAM_CHANNEL_ID  — @channelname או -100XXXXXXXXXX
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID         = 'BOT-31';
const MIN_SCORE      = 80;         // ציון מינימלי לשליחה
const MAX_PER_DAY    = 20;         // מקסימום הודעות ביום
const DELAY_BETWEEN  = 3000;       // מ"ש בין הודעות — מניעת rate limit
const TELEGRAM_API   = 'https://api.telegram.org/bot';

const log = createLogger(BOT_ID);

// ── Credentials ──────────────────────────────────────────────

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN   || '';
const CHANNEL_ID   = process.env.TELEGRAM_CHANNEL_ID  || '';

// ── sleep ────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — formatMessage, escape וכו'
// ════════════════════════════════════════════════════════════

/**
 * escapeMd — מבריח תווים מיוחדים ל-Telegram MarkdownV2.
 * דרישת API: חובה לברוח מ: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeMd(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, c => `\\${c}`);
}

/**
 * formatDiscount — "37%" או "חינם" לפי הנחה.
 * @param {number|null} pct
 * @returns {string}
 */
export function formatDiscount(pct) {
  if (!pct || pct <= 0) return '🔥 Deal';
  if (pct >= 90) return '🆓 FREE';
  return `${Math.round(pct)}% OFF`;
}

/**
 * formatPrice — "$49.99" / "₪189" לפי מטבע.
 * @param {number|null} price
 * @param {string} currency
 * @returns {string}
 */
export function formatPrice(price, currency = 'USD') {
  if (!price) return '';
  const symbols = { USD: '$', EUR: '€', GBP: '£', ILS: '₪', JPY: '¥' };
  const sym = symbols[currency] || currency + ' ';
  return `${sym}${price.toFixed(2).replace(/\.00$/, '')}`;
}

/**
 * scoreEmoji — emoji לפי ציון.
 * @param {number} score
 * @returns {string}
 */
export function scoreEmoji(score) {
  if (score >= 95) return '🏆';
  if (score >= 90) return '🔥';
  if (score >= 85) return '⭐';
  return '✅';
}

/**
 * formatTelegramMessage — בונה הודעת Telegram בMarkdownV2.
 *
 * דוגמת פלט:
 *   🔥 *37% OFF* — Sony WH-1000XM5
 *   💰 ~~$399~~ → *$249*
 *   🏪 Amazon · 📦 Electronics
 *   ⭐ ציון: 87/100
 *   [🛒 לדיל](https://...)
 *
 * @param {object} deal — שורה מ-deals
 * @returns {string}
 */
export function formatTelegramMessage(deal) {
  const discountLabel = formatDiscount(deal.discount);
  const titleClean    = escapeMd(deal.title?.substring(0, 100) || 'Deal');
  const store         = escapeMd(deal.store_name || 'Store');
  const category      = escapeMd(deal.category || '');
  const score         = deal.score || 0;
  const emoji         = scoreEmoji(score);

  const priceNow  = formatPrice(deal.price, deal.currency);
  const priceWas  = deal.original_price ? formatPrice(deal.original_price, deal.currency) : null;

  const priceBlock = priceWas
    ? `💰 ~${escapeMd(priceWas)}~ → \\*${escapeMd(priceNow)}\\*`
    : `💰 ${escapeMd(priceNow)}`;

  const url = deal.url || deal.product_url || '';

  let msg = `${emoji} \\*${escapeMd(discountLabel)}\\* — ${titleClean}\n`;
  if (priceNow) msg += `${priceBlock}\n`;
  if (store)    msg += `🏪 ${store}`;
  if (category) msg += ` · 📦 ${category}`;
  msg += `\n`;
  msg += `⭐ ציון: ${score}/100\n`;
  if (url) msg += `[🛒 לדיל](${url})`;

  return msg;
}

/**
 * countSentToday — סופר כמה דילים נשלחו היום.
 * "היום" = מאז תחילת היום ב-UTC.
 *
 * @param {Array<object>} deals — מערך דילים עם telegram_sent_at
 * @returns {number}
 */
export function countSentToday(deals) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  return deals.filter(d =>
    d.telegram_sent_at && new Date(d.telegram_sent_at) >= startOfDay
  ).length;
}

/**
 * pickDealsToSend — בוחר דילים לשליחה מהרשימה.
 * מסנן לפי:
 *   - status = 'active'
 *   - score >= MIN_SCORE
 *   - telegram_sent_at IS NULL
 *   - לא יותר מ-MAX_PER_DAY-כבר-נשלחו
 *
 * @param {Array<object>} candidates — דילים ממויינים לפי score DESC
 * @param {number} alreadySentToday  — כמה כבר נשלחו היום
 * @returns {Array<object>}
 */
export function pickDealsToSend(candidates, alreadySentToday = 0) {
  const remaining = MAX_PER_DAY - alreadySentToday;
  if (remaining <= 0) return [];

  return candidates
    .filter(d =>
      d.status === 'active' &&
      (d.score || 0) >= MIN_SCORE &&
      !d.telegram_sent_at
    )
    .slice(0, remaining);
}

// ════════════════════════════════════════════════════════════
// Telegram API calls
// ════════════════════════════════════════════════════════════

/**
 * sendTelegramMessage — שולח הודעה לערוץ.
 * @param {string} botToken
 * @param {string} chatId
 * @param {string} text       — MarkdownV2
 * @returns {{ ok: boolean, message_id?: number, error?: string }}
 */
export async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) {
    return { ok: false, error: 'missing token or chat_id' };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    chatId,
        text:       text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();

    if (!data.ok) {
      return { ok: false, error: data.description || 'telegram error' };
    }
    return { ok: true, message_id: data.result?.message_id };

  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`logStart: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats, status = 'done') {
  await supabase
    .from('bots_log')
    .update({
      finished_at:   new Date().toISOString(),
      status,
      deals_updated: stats.sent,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB — שליפת דילים וסימון
// ════════════════════════════════════════════════════════════

/**
 * fetchCandidates — דילים עם ציון >= MIN_SCORE שלא נשלחו.
 * @returns {Array<object>}
 */
async function fetchCandidates() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, currency, discount, score, category, store_name, url, product_url, status, telegram_sent_at')
    .eq('status', 'active')
    .gte('score', MIN_SCORE)
    .is('telegram_sent_at', null)
    .order('score', { ascending: false })
    .limit(50);                    // מקסימום 50 candidates להרצה

  if (error) throw new Error(`fetchCandidates: ${error.message}`);
  return data || [];
}

/**
 * fetchSentToday — כמה דילים כבר נשלחו היום.
 */
async function fetchSentTodayCount() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .gte('telegram_sent_at', startOfDay.toISOString());

  if (error) { log.warn(`fetchSentToday: ${error.message}`); return 0; }
  return count || 0;
}

/**
 * markSent — מסמן דיל כנשלח.
 * @param {string} dealId
 * @param {number} messageId — Telegram message_id
 */
async function markSent(dealId, messageId) {
  const { error } = await supabase
    .from('deals')
    .update({
      telegram_sent_at:    new Date().toISOString(),
      telegram_message_id: messageId || null,
    })
    .eq('id', dealId);

  if (error) log.warn(`markSent error for ${dealId}: ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.info(`🚀 ${BOT_ID} — Telegram Deal Sender`);

  if (!BOT_TOKEN) {
    log.warn('TELEGRAM_BOT_TOKEN חסר — לא שולח');
    return { sent: 0, skipped: 0, errors: ['missing TELEGRAM_BOT_TOKEN'] };
  }

  if (!CHANNEL_ID) {
    log.warn('TELEGRAM_CHANNEL_ID חסר — לא שולח');
    return { sent: 0, skipped: 0, errors: ['missing TELEGRAM_CHANNEL_ID'] };
  }

  let logId;
  const stats = { sent: 0, skipped: 0, errors: [] };

  try { logId = await logStart(); } catch (err) {
    log.error(`bots_log: ${err.message}`);
  }

  try {
    // בדוק כמה כבר נשלחו היום
    const sentTodayCount = await fetchSentTodayCount();
    log.info(`📊 נשלחו היום: ${sentTodayCount}/${MAX_PER_DAY}`);

    if (sentTodayCount >= MAX_PER_DAY) {
      log.info('✅ הגענו למקסימום יומי — לא שולח עוד');
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    // שלוף candidates
    const candidates = await fetchCandidates();
    log.info(`📋 נמצאו ${candidates.length} candidates`);

    const toSend = pickDealsToSend(candidates, sentTodayCount);
    log.info(`📤 לשליחה: ${toSend.length} דילים`);

    for (const deal of toSend) {
      const text = formatTelegramMessage(deal);
      const result = await sendTelegramMessage(BOT_TOKEN, CHANNEL_ID, text);

      if (result.ok) {
        await markSent(deal.id, result.message_id);
        stats.sent++;
        log.info(`✅ נשלח: ${deal.title?.substring(0, 50)} (score=${deal.score})`);
      } else {
        stats.errors.push(`deal ${deal.id}: ${result.error}`);
        log.warn(`⚠️ שגיאה בשליחה: ${result.error}`);
      }

      await sleep(DELAY_BETWEEN);
    }

  } catch (err) {
    log.error(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  }

  log.info(`✅ סיום: ${stats.sent} נשלחו, ${stats.skipped} דולגו`);

  if (logId) await logFinish(logId, stats);
  return stats;
}

// ── הרצה ישירה ──────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('bot31.mjs');
if (isMain) {
  main().catch(err => {
    console.error('❌ BOT-31 crashed:', err);
    process.exit(1);
  });
}
