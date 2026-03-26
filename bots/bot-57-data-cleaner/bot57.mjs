// ════════════════════════════════════════════════════════════
// BOT-57 — Data Cleaner
// תפקיד: מנקה בכל לילה נתונים פגומים/ישנים מה-DB.
//
// לוגיקה:
//   1. שולף דילים active ב-batches של 500
//   2. מזהה: תמונות שבורות, מחירים אנומליים, קישורים ישנים, פגי תוקף
//   3. מתקן: null תמונות, archive ישנים, false price_validated
//   4. מנקה: dedup_queue >30 ימים, click_log >90 ימים, bots_log >60 ימים
//   5. מעדכן last_cleaned_at
//
// תדירות: כל לילה 03:00 UTC (Railway cron: 0 3 * * *)
//
// Env vars:
//   SUPABASE_URL         — מ-Supabase
//   SUPABASE_SERVICE_KEY — service role key
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID      = 'BOT-57';
const BATCH_SIZE  = 500;
const MAX_AGE_LINK_DAYS    = 14;   // קישור ישן מעל 14 ימים = stale
const PRICE_ANOMALY_MULT   = 10;   // מחיר > avg * 10 = anomaly
const ARCHIVE_EXPIRED_DAYS = 30;   // פג תוקף מעל 30 ימים → archive
const ARCHIVE_INVALID_DAYS = 7;    // price_validated=false מעל 7 ימים → archive
const DEDUP_PURGE_DAYS     = 30;   // dedup_queue entries >30 ימים
const CLICK_PURGE_DAYS     = 90;   // click_log entries >90 ימים
const BOTS_LOG_PURGE_DAYS  = 60;   // bots_log entries >60 ימים

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — exported לטסטים
// ════════════════════════════════════════════════════════════

/**
 * isPriceAnomaly — true אם המחיר חריג (0.01 > price OR > avg*multiplier).
 * @param {number} price
 * @param {number} avgPrice — ממוצע הסטורי (0 = לא ידוע)
 * @param {number} multiplier — default 10
 * @returns {boolean}
 */
export function isPriceAnomaly(price, avgPrice, multiplier = 10) {
  if (typeof price !== 'number' || isNaN(price)) return true;
  if (price < 0.01) return true;
  if (avgPrice > 0 && price > avgPrice * multiplier) return true;
  return false;
}

/**
 * isStaleLink — true אם הקישור לא נבדק מעל maxAgeDays ימים.
 * null/undefined → never checked = stale.
 * @param {string|null} lastCheckedAt — ISO timestamp
 * @param {number} maxAgeDays
 * @param {Date} now
 * @returns {boolean}
 */
export function isStaleLink(lastCheckedAt, maxAgeDays, now = new Date()) {
  if (!lastCheckedAt) return true;
  const checked = new Date(lastCheckedAt);
  if (isNaN(checked.getTime())) return true;
  const diffMs   = now.getTime() - checked.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > maxAgeDays;
}

/**
 * isBrokenImage — true אם ה-URL פגום/ריק/data URI.
 * @param {string|null} imageUrl
 * @returns {boolean}
 */
export function isBrokenImage(imageUrl) {
  if (!imageUrl) return true;
  if (typeof imageUrl !== 'string') return true;
  if (imageUrl.trim() === '') return true;
  if (imageUrl.startsWith('data:')) return true;
  return false;
}

/**
 * classifyDeal — מסווג דיל לסיבת ניקוי.
 * בדיקת קדימות: broken_image → anomaly_price → stale_link → expired → clean
 * @param {object} deal
 * @param {Date} now
 * @returns {'clean'|'anomaly_price'|'stale_link'|'broken_image'|'expired'}
 */
export function classifyDeal(deal, now = new Date()) {
  if (!deal) return 'clean';

  if (isBrokenImage(deal.image_url)) return 'broken_image';

  const price    = typeof deal.price    === 'number' ? deal.price    : parseFloat(deal.price)    || 0;
  const original = typeof deal.original_price === 'number' ? deal.original_price : parseFloat(deal.original_price) || 0;
  if (isPriceAnomaly(price, original, PRICE_ANOMALY_MULT)) return 'anomaly_price';

  if (isStaleLink(deal.last_checked_at, MAX_AGE_LINK_DAYS, now)) return 'stale_link';

  if (deal.expires_at) {
    const exp = new Date(deal.expires_at);
    if (!isNaN(exp.getTime()) && exp < now) return 'expired';
  }

  return 'clean';
}

/**
 * buildCleanupReport — בונה דוח סיכום מתוצאות הניקוי.
 * @param {Array<{deal: object, action: string}>} results
 * @returns {{ total: number, cleaned: number, skipped: number, byReason: object }}
 */
export function buildCleanupReport(results) {
  const report = { total: 0, cleaned: 0, skipped: 0, byReason: {} };
  if (!Array.isArray(results)) return report;

  for (const r of results) {
    report.total++;
    if (!r.action || r.action === 'skip') {
      report.skipped++;
    } else {
      report.cleaned++;
      report.byReason[r.action] = (report.byReason[r.action] || 0) + 1;
    }
  }
  return report;
}

/**
 * shouldArchiveDeal — true אם הדיל צריך להיות archived.
 * תנאי 1: פג תוקף >30 ימים
 * תנאי 2: price_validated=false ויש לדיל >7 ימים
 * @param {object} deal
 * @param {Date} now
 * @returns {boolean}
 */
export function shouldArchiveDeal(deal, now = new Date()) {
  if (!deal) return false;

  // תנאי 1: expires_at עבר >30 ימים
  if (deal.expires_at) {
    const exp = new Date(deal.expires_at);
    if (!isNaN(exp.getTime())) {
      const diffDays = (now.getTime() - exp.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > ARCHIVE_EXPIRED_DAYS) return true;
    }
  }

  // תנאי 2: price_validated=false ועבר >7 ימים מיצירה
  if (deal.price_validated === false) {
    const created = new Date(deal.created_at);
    if (!isNaN(created.getTime())) {
      const diffDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > ARCHIVE_INVALID_DAYS) return true;
    }
  }

  return false;
}

// ════════════════════════════════════════════════════════════
// bots_log helpers
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  return data?.id;
}

async function logFinish(id, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    errors:        stats.errors  || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// פונקציות DB
// ════════════════════════════════════════════════════════════

/**
 * fetchActiveDealsBatch — שולף batch של דילים active.
 */
async function fetchActiveDealsBatch(offset) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, image_url, last_checked_at, expires_at, price_validated, created_at, status')
    .eq('status', 'active')
    .range(offset, offset + BATCH_SIZE - 1)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`fetchActiveDealsBatch: ${error.message}`);
  return data || [];
}

/**
 * fixBrokenImages — מאפס image_url=NULL לדילים עם תמונה שבורה.
 */
async function fixBrokenImages(ids) {
  if (!ids.length) return 0;
  const { error, count } = await supabase
    .from('deals')
    .update({ image_url: null, last_cleaned_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw new Error(`fixBrokenImages: ${error.message}`);
  return ids.length;
}

/**
 * archiveDeals — מעביר דילים ל-status='archived'.
 */
async function archiveDeals(ids) {
  if (!ids.length) return 0;
  const { error } = await supabase
    .from('deals')
    .update({ status: 'archived', last_cleaned_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw new Error(`archiveDeals: ${error.message}`);
  return ids.length;
}

/**
 * markPriceInvalid — מסמן price_validated=false לדילים עם מחיר אנומלי.
 */
async function markPriceInvalid(ids) {
  if (!ids.length) return 0;
  const { error } = await supabase
    .from('deals')
    .update({ price_validated: false, last_cleaned_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw new Error(`markPriceInvalid: ${error.message}`);
  return ids.length;
}

/**
 * purgeOldDedupQueue — מוחק רשומות dedup_queue ישנות.
 */
async function purgeOldDedupQueue() {
  const cutoff = new Date(Date.now() - DEDUP_PURGE_DAYS * 86400 * 1000).toISOString();
  const { error, count } = await supabase
    .from('dedup_queue')
    .delete()
    .lt('created_at', cutoff);
  if (error) throw new Error(`purgeOldDedupQueue: ${error.message}`);
  return count || 0;
}

/**
 * purgeOldClickLog — מוחק רשומות click_log ישנות.
 */
async function purgeOldClickLog() {
  const cutoff = new Date(Date.now() - CLICK_PURGE_DAYS * 86400 * 1000).toISOString();
  const { error, count } = await supabase
    .from('click_log')
    .delete()
    .lt('clicked_at', cutoff);
  if (error) throw new Error(`purgeOldClickLog: ${error.message}`);
  return count || 0;
}

/**
 * purgeOldBotsLog — מוחק רשומות bots_log ישנות (מלבד הרצה הנוכחית).
 */
async function purgeOldBotsLog(currentRunId) {
  const cutoff = new Date(Date.now() - BOTS_LOG_PURGE_DAYS * 86400 * 1000).toISOString();
  let query = supabase
    .from('bots_log')
    .delete()
    .lt('started_at', cutoff);

  if (currentRunId) {
    query = query.neq('id', currentRunId);
  }

  const { error, count } = await query;
  if (error) throw new Error(`purgeOldBotsLog: ${error.message}`);
  return count || 0;
}

// ════════════════════════════════════════════════════════════
// Main runner
// ════════════════════════════════════════════════════════════

export async function run() {
  log.info('Starting BOT-57 Data Cleaner...');
  const logId = await logStart();

  const stats = {
    updated:         0,
    brokenImages:    0,
    archivedDeals:   0,
    priceAnomalies:  0,
    dedupPurged:     0,
    clicksPurged:    0,
    botsLogPurged:   0,
    errors:          [],
  };

  const now = new Date();

  try {
    // ── שלב 1: עיבוד דילים active ──
    let offset      = 0;
    let totalDeals  = 0;
    let hasMore     = true;

    while (hasMore) {
      let batch;
      try {
        batch = await fetchActiveDealsBatch(offset);
      } catch (e) {
        stats.errors.push(`fetchBatch offset=${offset}: ${e.message}`);
        break;
      }

      if (batch.length === 0) { hasMore = false; break; }

      const brokenImageIds  = [];
      const archiveIds      = [];
      const anomalyPriceIds = [];

      for (const deal of batch) {
        const classification = classifyDeal(deal, now);

        if (shouldArchiveDeal(deal, now)) {
          archiveIds.push(deal.id);
        } else if (classification === 'broken_image') {
          brokenImageIds.push(deal.id);
        } else if (classification === 'anomaly_price') {
          anomalyPriceIds.push(deal.id);
        }
      }

      // בצע עדכונים ב-DB
      try {
        if (brokenImageIds.length) {
          const n = await fixBrokenImages(brokenImageIds);
          stats.brokenImages += n;
          stats.updated      += n;
        }
      } catch (e) { stats.errors.push(e.message); }

      try {
        if (archiveIds.length) {
          const n = await archiveDeals(archiveIds);
          stats.archivedDeals += n;
          stats.updated       += n;
        }
      } catch (e) { stats.errors.push(e.message); }

      try {
        if (anomalyPriceIds.length) {
          const n = await markPriceInvalid(anomalyPriceIds);
          stats.priceAnomalies += n;
          stats.updated        += n;
        }
      } catch (e) { stats.errors.push(e.message); }

      totalDeals += batch.length;
      offset     += BATCH_SIZE;
      if (batch.length < BATCH_SIZE) hasMore = false;
    }

    log.info(`Processed ${totalDeals} active deals`);

    // ── שלב 2: ניקוי טבלאות היסטוריה ──
    try {
      stats.dedupPurged   = await purgeOldDedupQueue();
    } catch (e) { stats.errors.push(e.message); }

    try {
      stats.clicksPurged  = await purgeOldClickLog();
    } catch (e) { stats.errors.push(e.message); }

    try {
      stats.botsLogPurged = await purgeOldBotsLog(logId);
    } catch (e) { stats.errors.push(e.message); }

  } catch (err) {
    stats.errors.push(err.message);
    log.error('Fatal error:', err.message);
  }

  log.info(`Done — broken_images=${stats.brokenImages}, archived=${stats.archivedDeals}, price_anomalies=${stats.priceAnomalies}, dedup_purged=${stats.dedupPurged}, clicks_purged=${stats.clicksPurged}, bots_log_purged=${stats.botsLogPurged}, errors=${stats.errors.length}`);

  await logFinish(logId, stats);
  return stats;
}

// ── Entry point ──
if (process.argv[1] && process.argv[1].endsWith('bot57.mjs')) {
  run().catch(err => {
    console.error('BOT-57 fatal:', err);
    process.exit(1);
  });
}
