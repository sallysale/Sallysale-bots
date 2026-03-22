// ════════════════════════════════════════════════════════════
// BOT-53 — Flash Sale Detector
// תפקיד: מזהה דילים עם זמן מוגבל (flash sales) ומוסיף badge עם ספירה לאחור.
//
// לוגיקה:
//   1. שולף דילים פעילים עם score>=60 או discount>=50
//   2. בודק title/description לסימנים של flash sale
//   3. מחלץ תאריך פקיעה מהטקסט (ends in X hours, expires at HH:MM, today only)
//   4. מעדכן deals: flash_sale, flash_expires_at, flash_badge, flash_reason
//   5. מנקה flash deals שפג תוקפם
//   6. כותב לbots_log
//
// תדירות: כל 30 דקות (Railway cron: */30 * * * *)
//
// Env vars:
//   SUPABASE_URL         — מ-Supabase dashboard
//   SUPABASE_SERVICE_KEY — service role key
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID        = 'BOT-53';
const SCORE_MIN     = 60;
const DISCOUNT_MIN  = 50;
const FLASH_DISCOUNT_THRESHOLD = 60;
const BATCH_SIZE    = 200;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — מיוצאות לטסטים
// ════════════════════════════════════════════════════════════

/**
 * isFlashSaleTitle — מזהה flash sale מכותרת הדיל.
 * בודק מילות מפתח: flash, lightning deal, deal of the day, today only, וכו'.
 * @param {string} title
 * @returns {boolean}
 */
export function isFlashSaleTitle(title) {
  if (!title || typeof title !== 'string') return false;

  const lower = title.toLowerCase();

  const patterns = [
    'flash sale',
    'flash offer',
    'flash deal',
    'flash',
    'lightning deal',
    'deal of the day',
    'today only',
    'limited time',
    'ends tonight',
    'hours only',
    'hour deal',
    '⚡',
  ];

  return patterns.some(p => lower.includes(p));
}

/**
 * isFlashSaleByDiscount — מזהה flash sale לפי עומק הנחה חריג.
 * הנחה >= threshold (ברירת מחדל 60%) בלי הקשר היסטורי = כנראה flash.
 * @param {number} discount     — אחוז הנחה
 * @param {number} [threshold]  — ברירת מחדל 60
 * @returns {boolean}
 */
export function isFlashSaleByDiscount(discount, threshold = FLASH_DISCOUNT_THRESHOLD) {
  if (typeof discount !== 'number' || isNaN(discount)) return false;
  return discount >= threshold;
}

/**
 * extractFlashExpiry — מחלץ תאריך פקיעה מטקסט חופשי.
 * תבניות נתמכות:
 *   "ends in X hours"   / "expires in X hours"
 *   "ends in X minutes" / "expires in X minutes"
 *   "expires at HH:MM"  / "ends at HH:MM"
 *   "today only"        → סוף יום (23:59)
 *   "X hours left"      / "X hours only"
 * @param {string} text
 * @param {Date}   [now]  — ברירת מחדל new Date()
 * @returns {Date|null}
 */
export function extractFlashExpiry(text, now = new Date()) {
  if (!text || typeof text !== 'string') return null;

  const lower = text.toLowerCase();

  // "ends in X hours" / "expires in X hours" / "X hours left" / "X hours only"
  const hoursMatch =
    lower.match(/(?:ends?|expires?)\s+in\s+(\d+(?:\.\d+)?)\s*h(?:ours?)?/) ||
    lower.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)\s+(?:left|only|remaining)/) ||
    lower.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)\s+deal/);

  if (hoursMatch) {
    const hours = parseFloat(hoursMatch[1]);
    if (!isNaN(hours) && hours > 0 && hours <= 72) {
      const expiry = new Date(now.getTime() + hours * 60 * 60 * 1000);
      return expiry;
    }
  }

  // "ends in X minutes" / "expires in X minutes"
  const minutesMatch =
    lower.match(/(?:ends?|expires?)\s+in\s+(\d+)\s*min(?:utes?)?/) ||
    lower.match(/(\d+)\s*min(?:utes?)?\s+(?:left|only|remaining)/);

  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1], 10);
    if (!isNaN(minutes) && minutes > 0 && minutes <= 4320) {
      const expiry = new Date(now.getTime() + minutes * 60 * 1000);
      return expiry;
    }
  }

  // "expires at HH:MM" / "ends at HH:MM"
  const atTimeMatch = lower.match(/(?:ends?|expires?)\s+at\s+(\d{1,2}):(\d{2})/);
  if (atTimeMatch) {
    const expiry = new Date(now);
    expiry.setHours(parseInt(atTimeMatch[1], 10), parseInt(atTimeMatch[2], 10), 0, 0);
    // אם השעה כבר עברה היום — מחר
    if (expiry <= now) expiry.setDate(expiry.getDate() + 1);
    return expiry;
  }

  // "today only" → סוף יום UTC
  if (lower.includes('today only') || lower.includes('ends tonight')) {
    const expiry = new Date(now);
    expiry.setUTCHours(23, 59, 59, 999);
    return expiry;
  }

  return null;
}

/**
 * computeFlashBadge — מחשב את כל שדות הflash לדיל.
 * @param {object} deal — { title, description, discount, score }
 * @param {Date}   [now]
 * @returns {{ is_flash: boolean, flash_expires_at: string|null, flash_reason: string }}
 */
export function computeFlashBadge(deal, now = new Date()) {
  if (!deal) return { is_flash: false, flash_expires_at: null, flash_reason: '' };

  const titleText = deal.title || '';
  const descText  = deal.description || '';
  const combined  = `${titleText} ${descText}`;

  const titleFlash    = isFlashSaleTitle(titleText);
  const discountFlash = isFlashSaleByDiscount(Number(deal.discount) || 0);

  if (!titleFlash && !discountFlash) {
    return { is_flash: false, flash_expires_at: null, flash_reason: '' };
  }

  // נסה לחלץ תאריך פקיעה מהטקסט
  const expiryFromTitle = extractFlashExpiry(titleText, now);
  const expiryFromDesc  = extractFlashExpiry(descText, now);
  const expiry          = expiryFromTitle || expiryFromDesc;

  let reason = '';
  if (titleFlash && discountFlash) {
    reason = 'title_and_discount';
  } else if (titleFlash) {
    reason = 'title_keyword';
  } else {
    reason = 'deep_discount';
  }

  return {
    is_flash:         true,
    flash_expires_at: expiry ? expiry.toISOString() : null,
    flash_reason:     reason,
  };
}

/**
 * formatCountdown — מחרוזת תצוגה לספירה לאחור.
 * @param {string|Date} expiresAt — ISO string או Date
 * @param {Date}        [now]
 * @returns {string}  "2h 30m left" | "45m left" | "Expired"
 */
export function formatCountdown(expiresAt, now = new Date()) {
  if (!expiresAt) return '';

  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (isNaN(expiry.getTime())) return '';

  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours        = Math.floor(totalMinutes / 60);
  const minutes      = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m left`;
  if (hours > 0)                 return `${hours}h left`;
  return `${minutes}m left`;
}

/**
 * isExpiredFlash — בודק אם flash deal פג תוקפו.
 * @param {string|Date|null} flash_expires_at
 * @param {Date}             [now]
 * @returns {boolean}
 */
export function isExpiredFlash(flash_expires_at, now = new Date()) {
  if (!flash_expires_at) return false;

  const expiry = flash_expires_at instanceof Date
    ? flash_expires_at
    : new Date(flash_expires_at);

  if (isNaN(expiry.getTime())) return false;
  return expiry.getTime() <= now.getTime();
}

/**
 * buildFlashBadgeText — בונה את הטקסט של הbadge לתצוגה.
 * @param {string|Date|null} expiresAt
 * @param {Date}             [now]
 * @returns {string}
 */
export function buildFlashBadgeText(expiresAt, now = new Date()) {
  if (!expiresAt) return '⚡ Flash Sale';

  const countdown = formatCountdown(expiresAt, now);
  if (!countdown || countdown === 'Expired') return '⚡ Flash Sale';
  return `⚡ Flash — ${countdown}`;
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

async function fetchCandidateDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, description, discount, score, flash_sale, flash_expires_at')
    .eq('status', 'active')
    .or(`score.gte.${SCORE_MIN},discount.gte.${DISCOUNT_MIN}`)
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetchCandidateDeals: ${error.message}`);
  return data || [];
}

async function fetchExpiredFlashDeals() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, flash_expires_at')
    .eq('flash_sale', true)
    .not('flash_expires_at', 'is', null)
    .lt('flash_expires_at', now);

  if (error) throw new Error(`fetchExpiredFlashDeals: ${error.message}`);
  return data || [];
}

async function updateDealFlash(dealId, badge) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('deals')
    .update({
      flash_sale:        badge.is_flash,
      flash_expires_at:  badge.flash_expires_at,
      flash_badge:       badge.is_flash ? buildFlashBadgeText(badge.flash_expires_at) : null,
      flash_reason:      badge.flash_reason || null,
      flash_detected_at: badge.is_flash ? now : null,
    })
    .eq('id', dealId);

  if (error) throw new Error(`updateDealFlash(${dealId}): ${error.message}`);
}

async function clearExpiredFlash(dealId) {
  const { error } = await supabase
    .from('deals')
    .update({
      flash_sale:        false,
      flash_expires_at:  null,
      flash_badge:       null,
      flash_reason:      'expired',
      flash_detected_at: null,
    })
    .eq('id', dealId);

  if (error) throw new Error(`clearExpiredFlash(${dealId}): ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-53 — Flash Sale Detector starting`);

  let logId;
  const stats = { updated: 0, cleared: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    // 1. נקה flash deals שפגו תוקפם
    const expired = await fetchExpiredFlashDeals();
    log.log(`Expired flash deals to clear: ${expired.length}`);

    for (const deal of expired) {
      try {
        await clearExpiredFlash(deal.id);
        stats.cleared++;
        log.ok(`Cleared expired flash: ${deal.title?.substring(0, 40)}`);
      } catch (e) {
        stats.errors.push(e.message);
        log.err(e.message);
      }
    }

    // 2. בדוק דילים מועמדים
    const candidates = await fetchCandidateDeals();
    log.log(`Candidate deals to check: ${candidates.length}`);

    const now = new Date();

    for (const deal of candidates) {
      try {
        const badge = computeFlashBadge(deal, now);

        // עדכן רק אם משהו השתנה
        const wasFlash = deal.flash_sale === true;
        const isFlash  = badge.is_flash;

        if (wasFlash !== isFlash || isFlash) {
          await updateDealFlash(deal.id, badge);
          stats.updated++;

          if (isFlash) {
            const countdown = badge.flash_expires_at
              ? formatCountdown(badge.flash_expires_at, now)
              : 'no expiry';
            log.ok(`Flash detected: ${deal.title?.substring(0, 40)} [${badge.flash_reason}] ${countdown}`);
          }
        }
      } catch (e) {
        stats.errors.push(e.message);
        log.err(e.message);
      }
    }

    log.ok(`Done: ${stats.updated} updated, ${stats.cleared} cleared, ${stats.errors.length} errors`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot53.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-53 crashed:', err); process.exit(1); });
}
