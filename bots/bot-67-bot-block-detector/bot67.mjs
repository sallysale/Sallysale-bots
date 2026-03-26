// ════════════════════════════════════════════════════════════
// BOT-67 — Bot Block Detector
// תפקיד: מזהה חסימות של הסקרייפרים שלנו ע"י אתרי מטרה.
//
// לוגיקה:
//   • קורא scrape_attempts מ-24 השעות האחרונות per store
//   • מחשב block rate per store
//   • מעדכן scraping_health
//   • שולח התראת Telegram אם blockRate >= threshold
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
//
// Env vars:
//   TELEGRAM_BOT_TOKEN     — לשליחת התראות
//   TELEGRAM_ALERT_CHAT_ID — chat/channel לקבלת alerts
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-67';
const log = createLogger(BOT_ID);

const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN     || '';
const ALERT_CHAT_ID   = process.env.TELEGRAM_ALERT_CHAT_ID || '';
const TELEGRAM_API    = 'https://api.telegram.org/bot';

export const DEFAULT_ALERT_THRESHOLD = 25; // percent

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * isBlockedResponse — האם תגובה מצביעה על חסימה.
 * @param {number} statusCode
 * @param {string} body
 * @returns {boolean}
 */
export function isBlockedResponse(statusCode, body) {
  if ([403, 429, 503].includes(statusCode)) return true;
  if (!body) return false;
  const lower = body.toLowerCase();
  const blockSignals = [
    'access denied',
    'captcha',
    'bot detected',
    'cloudflare',
    'please verify',
  ];
  return blockSignals.some(signal => lower.includes(signal));
}

/**
 * computeBlockRate — אחוז החסימות מסך הניסיונות.
 * @param {number} attempts
 * @param {number} blocks
 * @returns {number} אחוז (0-100)
 */
export function computeBlockRate(attempts, blocks) {
  if (!attempts || attempts === 0) return 0;
  return (blocks / attempts) * 100;
}

/**
 * classifyBlockSeverity — רמת חומרת החסימה.
 * @param {number} blockRate — אחוז
 * @returns {'none'|'low'|'medium'|'high'|'full'}
 */
export function classifyBlockSeverity(blockRate) {
  if (blockRate === 0)    return 'none';
  if (blockRate < 10)     return 'low';
  if (blockRate <= 50)    return 'medium';
  if (blockRate < 100)    return 'high';
  return 'full';
}

/**
 * shouldAlert — האם לשלוח התראה.
 * @param {number} blockRate
 * @param {number} threshold
 * @returns {boolean}
 */
export function shouldAlert(blockRate, threshold = DEFAULT_ALERT_THRESHOLD) {
  return blockRate >= threshold;
}

/**
 * getRecommendation — המלצה לפי רמת חומרה.
 * @param {string} severity
 * @returns {string}
 */
export function getRecommendation(severity) {
  const map = {
    none:    'none',
    low:     'rotate_proxy',
    medium:  'reduce_frequency',
    high:    'pause_scraping',
    full:    'contact_support',
  };
  return map[severity] || 'none';
}

/**
 * buildBlockReport — בונה דוח חסימה לחנות.
 * @param {string} store — שם/מזהה החנות
 * @param {{ attempts: number, blocks: number }} results
 * @returns {object}
 */
export function buildBlockReport(store, results) {
  const blockRate     = computeBlockRate(results.attempts, results.blocks);
  const severity      = classifyBlockSeverity(blockRate);
  const recommendation = getRecommendation(severity);
  return {
    store,
    blockRate:      Math.round(blockRate * 100) / 100,
    severity,
    recommendation,
    attempts:       results.attempts,
    blocks:         results.blocks,
  };
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchScrapeAttempts() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('scrape_attempts')
    .select('store_id, was_blocked, attempted_at')
    .gte('attempted_at', since);

  if (error) throw new Error(`fetchScrapeAttempts: ${error.message}`);
  return data || [];
}

function groupByStore(attempts) {
  const map = {};
  for (const row of attempts) {
    const sid = row.store_id;
    if (!map[sid]) map[sid] = { attempts: 0, blocks: 0 };
    map[sid].attempts++;
    if (row.was_blocked) map[sid].blocks++;
  }
  return map;
}

async function upsertScrapingHealth(storeId, report) {
  const { error } = await supabase
    .from('scraping_health')
    .upsert({
      store_id:        storeId,
      block_rate:      report.blockRate,
      severity:        report.severity,
      last_blocked_at: report.blocks > 0 ? new Date().toISOString() : undefined,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'store_id' });

  if (error) log.warn(`upsertScrapingHealth(${storeId}): ${error.message}`);
}

async function sendTelegramAlert(message) {
  if (!TELEGRAM_TOKEN || !ALERT_CHAT_ID) return;
  try {
    await fetch(`${TELEGRAM_API}${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: ALERT_CHAT_ID, text: message }),
      signal:  AbortSignal.timeout(8000),
    });
  } catch (e) {
    log.warn(`Telegram alert failed: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════
// bots_log helpers
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id').single();
  return data?.id;
}

async function logFinish(id, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    errors:        stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-67 — Bot Block Detector starting`);

  let logId;
  const stats = { updated: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const attempts = await fetchScrapeAttempts();
    log.log(`Fetched ${attempts.length} scrape attempts from last 24h`);

    const grouped = groupByStore(attempts);
    const storeIds = Object.keys(grouped);

    if (storeIds.length === 0) {
      log.log('No scrape attempts found — nothing to process');
    }

    const alerts = [];

    for (const storeId of storeIds) {
      const report = buildBlockReport(storeId, grouped[storeId]);
      log.log(`Store ${storeId}: ${report.attempts} attempts, ${report.blocks} blocked — ${report.blockRate}% (${report.severity})`);

      await upsertScrapingHealth(storeId, report);
      stats.updated++;

      if (shouldAlert(report.blockRate)) {
        alerts.push(report);
      }
    }

    if (alerts.length > 0) {
      const lines = alerts.map(r =>
        `• Store ${r.store}: ${r.blockRate}% blocked (${r.severity}) → ${r.recommendation}`
      ).join('\n');
      const msg = `🚨 SallySale — Scraper Block Alert\n\n${lines}\n\nTime: ${new Date().toISOString()}`;
      await sendTelegramAlert(msg);
      log.warn(`Telegram alert sent for ${alerts.length} stores`);
    }

    log.ok(`Done — processed ${storeIds.length} stores, ${alerts.length} alerts sent`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot67.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-67 crashed:', err); process.exit(1); });
}
