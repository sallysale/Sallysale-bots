// ════════════════════════════════════════════════════════════
// BOT-54 — Stock Monitor
// תפקיד: מזהה אותות מלאי נמוך בתיאורי דילים ומוסיף badge FOMO.
//
// לוגיקה:
//   1. שולף דילים פעילים
//   2. בודק description/metadata_json לסימני מלאי נמוך
//   3. מחלץ מספר פריטים ("only 5 left", "3 remaining")
//   4. מסווג רמת מלאי: critical/low/medium/plenty/unknown
//   5. מעדכן deals: stock_count, stock_status, stock_badge, stock_updated_at
//   6. כותב לbots_log
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
//
// Env vars:
//   SUPABASE_URL         — מ-Supabase dashboard
//   SUPABASE_SERVICE_KEY — service role key
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID      = 'BOT-54';
const BATCH_SIZE  = 300;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — מיוצאות לטסטים
// ════════════════════════════════════════════════════════════

/**
 * detectLowStock — מזהה סימני מלאי נמוך בטקסט.
 * תבניות: "only X left", "X in stock", "limited stock", "almost gone",
 *         "selling fast", "last X items", "X remaining", "X left in stock"
 * הערה: "100 items in stock" → false (כמות גדולה = לא נמוך)
 * @param {string} text
 * @returns {boolean}
 */
export function detectLowStock(text) {
  if (!text || typeof text !== 'string') return false;

  const lower = text.toLowerCase();

  // מילות מפתח ישירות ללא מספר
  const directKeywords = [
    'limited stock',
    'almost gone',
    'selling fast',
    'low stock',
    'going fast',
    'nearly gone',
    'last chance',
    'few left',
    'hurry',
  ];

  if (directKeywords.some(k => lower.includes(k))) return true;

  // תבניות עם מספרים — רק אם המספר קטן מ-11
  const numberPatterns = [
    /only\s+(\d+)\s+(?:left|remaining|in\s+stock|available)/i,
    /(\d+)\s+(?:left|remaining)\s+in\s+stock/i,
    /(\d+)\s+(?:items?|units?|pieces?)\s+(?:left|remaining|in\s+stock|available)/i,
    /last\s+(\d+)\s+(?:items?|units?|pieces?)/i,
    /(\d+)\s+(?:in\s+stock|available)\s*(?:only|!)?$/i,
    /stock[:\s]+(\d+)/i,
    /(\d+)\s+remaining/i,
    /(\d+)\s+left/i,
  ];

  for (const pattern of numberPatterns) {
    const match = lower.match(pattern);
    if (match) {
      const count = parseInt(match[1], 10);
      // "100 items in stock" → לא מלאי נמוך
      if (count <= 10) return true;
    }
  }

  return false;
}

/**
 * parseStockCount — מחלץ מספר פריטים מטקסט.
 * "only 5 left" → 5, "3 remaining" → 3, "limited stock" → null
 * @param {string} text
 * @returns {number|null}
 */
export function parseStockCount(text) {
  if (!text || typeof text !== 'string') return null;

  const lower = text.toLowerCase();

  const patterns = [
    /only\s+(\d+)\s+(?:left|remaining|in\s+stock|available)/i,
    /(\d+)\s+(?:left|remaining)\s+in\s+stock/i,
    /(\d+)\s+(?:items?|units?|pieces?)\s+(?:left|remaining|in\s+stock|available)/i,
    /last\s+(\d+)\s+(?:items?|units?|pieces?)/i,
    /(\d+)\s+remaining/i,
    /(\d+)\s+left/i,
    /stock[:\s]+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num)) return num;
    }
  }

  return null;
}

/**
 * classifyStockLevel — מסווג רמת מלאי לפי מספר.
 * critical: <= 3
 * low:      4-10
 * medium:   11-50
 * plenty:   > 50
 * unknown:  null
 * @param {number|null} count
 * @returns {'critical'|'low'|'medium'|'plenty'|'unknown'}
 */
export function classifyStockLevel(count) {
  if (count === null || count === undefined || isNaN(count)) return 'unknown';
  if (count <= 3)  return 'critical';
  if (count <= 10) return 'low';
  if (count <= 50) return 'medium';
  return 'plenty';
}

/**
 * buildStockBadge — בונה את הטקסט של badge לתצוגה.
 * @param {'critical'|'low'|'medium'|'plenty'|'unknown'} stockLevel
 * @param {number|null} count
 * @returns {string}
 */
export function buildStockBadge(stockLevel, count) {
  switch (stockLevel) {
    case 'critical':
      if (count !== null && count !== undefined) return `🔥 Only ${count} left!`;
      return '🔥 Almost gone!';
    case 'low':
      if (count !== null && count !== undefined) return `⚡ Only ${count} left`;
      return '⚡ Low stock';
    case 'medium':
      return '📦 Low stock';
    case 'plenty':
      return '';
    default:
      return '';
  }
}

/**
 * isStockCritical — בודק אם מלאי ברמה קריטית.
 * @param {'critical'|'low'|'medium'|'plenty'|'unknown'} stockLevel
 * @returns {boolean}
 */
export function isStockCritical(stockLevel) {
  return stockLevel === 'critical';
}

/**
 * shouldBoostScore — האם להגביר ציון הדיל בגלל מלאי נמוך.
 * מחזיר true לrמות critical ו-low.
 * @param {'critical'|'low'|'medium'|'plenty'|'unknown'} stockLevel
 * @returns {boolean}
 */
export function shouldBoostScore(stockLevel) {
  return stockLevel === 'critical' || stockLevel === 'low';
}

/**
 * analyzeStockFromText — ניתוח מלא של מלאי מטקסט.
 * מחזיר אובייקט עם כל שדות המלאי.
 * @param {string} text
 * @returns {{ stock_count: number|null, stock_status: string, stock_badge: string }}
 */
export function analyzeStockFromText(text) {
  const hasSignal   = detectLowStock(text);
  const count       = hasSignal ? parseStockCount(text) : null;

  // אם אין סיגנל, בדוק אם יש מספר בכלל
  const finalCount  = count !== null ? count : (detectLowStock(text) ? null : null);
  const stockLevel  = hasSignal
    ? (count !== null ? classifyStockLevel(count) : 'low')
    : 'unknown';

  const badge = buildStockBadge(stockLevel, count);

  return {
    stock_count:  count,
    stock_status: stockLevel,
    stock_badge:  badge,
  };
}

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id').single();
  if (error) throw new Error(`logStart: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated,
    errors:        stats.errors,
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchActiveDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, description, metadata_json, stock_status, stock_count')
    .eq('status', 'active')
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetchActiveDeals: ${error.message}`);
  return data || [];
}

async function updateDealStock(dealId, stockData) {
  const { error } = await supabase
    .from('deals')
    .update({
      stock_count:      stockData.stock_count,
      stock_status:     stockData.stock_status,
      stock_badge:      stockData.stock_badge || null,
      stock_updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) throw new Error(`updateDealStock(${dealId}): ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-54 — Stock Monitor starting`);

  let logId;
  const stats = { updated: 0, critical: 0, low: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const deals = await fetchActiveDeals();
    log.log(`Active deals to check: ${deals.length}`);

    for (const deal of deals) {
      try {
        // בנה טקסט לניתוח מ-description ומ-metadata_json
        const descText = deal.description || '';

        let metaText = '';
        if (deal.metadata_json) {
          try {
            const meta = typeof deal.metadata_json === 'string'
              ? JSON.parse(deal.metadata_json)
              : deal.metadata_json;
            // חפש שדות stock-related ב-metadata
            const stockFields = ['stock', 'availability', 'stockText', 'inventory', 'quantityLeft'];
            for (const field of stockFields) {
              if (meta[field]) metaText += ` ${meta[field]}`;
            }
          } catch {
            // JSON parse failed — ignore
          }
        }

        const combinedText = `${descText} ${metaText}`.trim();
        const stockData    = analyzeStockFromText(combinedText);

        // עדכן רק אם משהו השתנה
        const changed =
          stockData.stock_count  !== deal.stock_count ||
          stockData.stock_status !== (deal.stock_status || 'unknown');

        if (changed) {
          await updateDealStock(deal.id, stockData);
          stats.updated++;

          if (stockData.stock_status === 'critical') {
            stats.critical++;
            log.ok(`Critical stock: ${deal.title?.substring(0, 40)} [${stockData.stock_count} left]`);
          } else if (stockData.stock_status === 'low') {
            stats.low++;
            log.ok(`Low stock: ${deal.title?.substring(0, 40)} [${stockData.stock_badge}]`);
          }
        }

      } catch (e) {
        stats.errors.push(e.message);
        log.err(e.message);
      }
    }

    log.ok(
      `Done: ${stats.updated} updated (${stats.critical} critical, ${stats.low} low), ` +
      `${stats.errors.length} errors`
    );

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot54.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-54 crashed:', err); process.exit(1); });
}
