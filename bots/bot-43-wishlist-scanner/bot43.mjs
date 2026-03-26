// ════════════════════════════════════════════════════════════
// BOT-43 — Wishlist Scanner
// תפקיד: סורק wishlist של משתמשים ומחפש ירידות מחיר.
//         אם המחיר ירד מתחת ל-target_price או ב-10%+ → מכניס
//         ל-wishlist_alerts לשליחה על ידי BOT-44.
//
// לוגיקה:
//   1. שולף כל הwishlists הפעילות (join עם deals)
//   2. בודק כל פריט: מחיר מתחת target_price? ירד 10%+?
//   3. אם כן → מכניס wishlist_alerts (ב-cooldown של 24h)
//   4. מעדכן בוט-לוג
//
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID             = 'BOT-43';
const DROP_THRESHOLD_PCT = 10;
const ALERT_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // 24 hours

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * isPriceDropped — בדוק אם המחיר ירד ב-thresholdPct אחוזים לפחות.
 * @param {number} currentPrice
 * @param {number} originalPrice
 * @param {number} thresholdPct
 * @returns {boolean}
 */
export function isPriceDropped(currentPrice, originalPrice, thresholdPct = DROP_THRESHOLD_PCT) {
  if (
    typeof currentPrice  !== 'number' || currentPrice  <= 0 ||
    typeof originalPrice !== 'number' || originalPrice <= 0 ||
    typeof thresholdPct  !== 'number' || thresholdPct  <= 0
  ) return false;

  const dropPct = ((originalPrice - currentPrice) / originalPrice) * 100;
  return dropPct >= thresholdPct;
}

/**
 * isBelowTarget — בדוק אם המחיר הנוכחי <= target_price.
 * @param {number} currentPrice
 * @param {number|null} targetPrice
 * @returns {boolean}
 */
export function isBelowTarget(currentPrice, targetPrice) {
  if (
    targetPrice  == null ||
    typeof currentPrice !== 'number' || currentPrice <= 0 ||
    typeof targetPrice  !== 'number' || targetPrice  <= 0
  ) return false;

  return currentPrice <= targetPrice;
}

/**
 * shouldSendAlert — בדוק אם עבר cooldown מספיק מאז ההתראה האחרונה.
 * @param {string|null} lastAlertAt  — ISO string או null
 * @param {number}      cooldownMs
 * @returns {boolean}
 */
export function shouldSendAlert(lastAlertAt, cooldownMs = ALERT_COOLDOWN_MS) {
  if (!lastAlertAt) return true; // מעולם לא נשלחה התראה
  const last = new Date(lastAlertAt).getTime();
  if (isNaN(last)) return true;
  return Date.now() - last >= cooldownMs;
}

/**
 * calcSavingsPct — חישוב אחוז חיסכון (עגול).
 * @param {number} oldPrice
 * @param {number} newPrice
 * @returns {number}
 */
export function calcSavingsPct(oldPrice, newPrice) {
  if (
    typeof oldPrice !== 'number' || oldPrice <= 0 ||
    typeof newPrice !== 'number' || newPrice <  0
  ) return 0;

  if (newPrice >= oldPrice) return 0;
  return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
}

/**
 * formatDropPct — מחרוזת תצוגה לאחוז ירידה.
 * @param {number} oldPrice
 * @param {number} newPrice
 * @returns {string}
 */
export function formatDropPct(oldPrice, newPrice) {
  const pct = calcSavingsPct(oldPrice, newPrice);
  if (pct <= 0) return '0% off';
  return `${pct}% off`;
}

/**
 * buildAlertData — בונה אובייקט להכנסה ל-wishlist_alerts.
 * @param {object} wishlist
 * @param {object} deal
 * @param {string} reason   — 'price_drop' | 'below_target'
 * @returns {object}
 */
export function buildAlertData(wishlist, deal, reason) {
  const oldPrice = wishlist.added_at_price ?? deal.original_price ?? deal.price;
  const newPrice = deal.price;

  return {
    wishlist_id:  wishlist.id,
    user_id:      wishlist.user_id,
    deal_id:      deal.id,
    alert_type:   reason,
    old_price:    oldPrice,
    new_price:    newPrice,
    savings_pct:  calcSavingsPct(oldPrice, newPrice),
    status:       'pending',
  };
}

/**
 * filterTriggeredWishlists — מסנן wishlists שעומדות בתנאי ההתראה.
 * @param {Array}  wishlists    — מערך { id, user_id, deal_id, target_price, added_at_price, deal: {...} }
 * @param {object} dealsMap     — { [deal_id]: deal }
 * @param {object} lastAlertsMap — { [wishlist_id]: ISO string של lastAlertAt }
 * @returns {Array<{ wishlist, deal, reason }>}
 */
export function filterTriggeredWishlists(wishlists, dealsMap, lastAlertsMap) {
  if (!Array.isArray(wishlists)) return [];

  const results = [];

  for (const wl of wishlists) {
    const deal = dealsMap[wl.deal_id] || wl.deal;
    if (!deal) continue;

    const currentPrice  = deal.price;
    const originalPrice = wl.added_at_price || deal.original_price;
    const lastAlertAt   = lastAlertsMap[wl.id] || null;

    if (!shouldSendAlert(lastAlertAt)) continue;

    // בדוק below_target קודם (עדיפות גבוהה יותר)
    if (isBelowTarget(currentPrice, wl.target_price)) {
      results.push({ wishlist: wl, deal, reason: 'below_target' });
      continue;
    }

    // בדוק price_drop
    if (isPriceDropped(currentPrice, originalPrice, DROP_THRESHOLD_PCT)) {
      results.push({ wishlist: wl, deal, reason: 'price_drop' });
    }
  }

  return results;
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

async function logFinish(logId, stats, status = 'done') {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status,
    deals_updated: stats.alertsInserted,
    errors:        stats.errors,
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchWishlists() {
  const { data, error } = await supabase
    .from('wishlists')
    .select(`
      id,
      user_id,
      deal_id,
      target_price,
      added_at_price,
      currency,
      created_at,
      deal:deals (
        id,
        title,
        price,
        original_price,
        currency,
        discount,
        score,
        status,
        seo_slug,
        store_name
      )
    `)
    .not('deal_id', 'is', null);

  if (error) throw new Error(`fetchWishlists: ${error.message}`);
  return (data || []).filter(wl => wl.deal && wl.deal.status === 'active' && typeof wl.deal.price === 'number');
}

async function fetchLastAlerts(wishlistIds) {
  if (wishlistIds.length === 0) return {};

  const { data, error } = await supabase
    .from('wishlist_alerts')
    .select('wishlist_id, created_at')
    .in('wishlist_id', wishlistIds)
    .order('created_at', { ascending: false });

  if (error) {
    log.warn(`fetchLastAlerts: ${error.message}`);
    return {};
  }

  // מפה: wishlist_id → created_at הכי חדש
  const map = {};
  for (const row of (data || [])) {
    if (!map[row.wishlist_id]) {
      map[row.wishlist_id] = row.created_at;
    }
  }
  return map;
}

async function insertAlerts(alertsData) {
  if (alertsData.length === 0) return 0;

  const { error } = await supabase
    .from('wishlist_alerts')
    .insert(alertsData);

  if (error) throw new Error(`insertAlerts: ${error.message}`);
  return alertsData.length;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Wishlist Scanner`);

  let logId;
  const stats = { wishlistsChecked: 0, alertsInserted: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const wishlists = await fetchWishlists();
    stats.wishlistsChecked = wishlists.length;
    log.log(`📋 ${wishlists.length} wishlists פעילות`);

    if (wishlists.length === 0) {
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    // בנה dealsMap
    const dealsMap = {};
    for (const wl of wishlists) {
      if (wl.deal) dealsMap[wl.deal_id] = wl.deal;
    }

    // שלוף last alerts
    const wishlistIds  = wishlists.map(wl => wl.id);
    const lastAlertsMap = await fetchLastAlerts(wishlistIds);

    // סנן triggered
    const triggered = filterTriggeredWishlists(wishlists, dealsMap, lastAlertsMap);
    log.log(`🎯 ${triggered.length} wishlists מקיימות תנאי התראה`);

    // בנה ושמור alerts
    const alertsData = triggered.map(({ wishlist, deal, reason }) =>
      buildAlertData(wishlist, deal, reason)
    );

    if (alertsData.length > 0) {
      stats.alertsInserted = await insertAlerts(alertsData);
      log.ok(`✅ ${stats.alertsInserted} התראות נוספו לתור`);
    }

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot43.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-43 crashed:', err); process.exit(1); });
}
