// ════════════════════════════════════════════════════════════
// BOT-29 — Affiliate Sorter
// תפקיד: עבור כל דיל published בDB, בוחר את רשת האפיליאציה
//         עם העמלה הגבוהה ביותר ומעדכן את affiliateUrl.
//
// לוגיקה:
//   1. שולף דילים published עם affiliateUrl
//   2. מזהה את רשת המקור מה-source field
//   3. בודק אם יש רשת טובה יותר לאותה חנות
//   4. אם כן — מעדכן affiliateUrl
//   5. מעבד 100 דילים בכל batch, עם השהייה של 200ms
//
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID = 'BOT-29';

// ── עמלות רשתות — קבוע (base + חנויות ספציפיות) ───────────
// base = עמלה בסיסית לכל חנות ברשת
// stores = עמלות ספציפיות לחנויות מסוימות

export const NETWORK_COMMISSIONS = {
  tradedoubler: { base: 0.08, stores: { 'hm': 0.10, 'zalando': 0.12 } },
  cj:           { base: 0.07, stores: { 'nike': 0.11, 'adidas': 0.09 } },
  awin:         { base: 0.06, stores: { 'zara': 0.08, 'mango': 0.09 } },
  impact:       { base: 0.08, stores: { 'target': 0.07, 'etsy': 0.04 } },
  rakuten:      { base: 0.05, stores: {} },
  ebay_epn:     { base: 0.04, stores: {} },
  skimlinks:    { base: 0.03, stores: {} },
};

const BATCH_SIZE      = 100;
const BATCH_DELAY_MS  = 200;

// ── ENV ────────────────────────────────────────────────────

const EBAY_CAMPAIGN_ID      = process.env.EBAY_CAMPAIGN_ID       || '';
const AWIN_PUBLISHER_ID     = process.env.AWIN_PUBLISHER_ID      || '';
const TRADEDOUBLER_TOKEN    = process.env.TRADEDOUBLER_TOKEN      || '';
const CJ_WEBSITE_ID         = process.env.CJ_WEBSITE_ID          || '';
const SKIMLINKS_PUBLISHER_ID = process.env.SKIMLINKS_PUBLISHER_ID || '300003X1787825';

// ── בניית קישורי אפיליאציה ─────────────────────────────────

/**
 * בונה קישור Tradedoubler.
 * @param {string} productUrl  — URL המוצר
 * @param {string} programId   — מזהה תוכנית Tradedoubler
 * @returns {string}
 */
export function buildTradeDoublerUrl(productUrl, programId = '123456') {
  return `https://clk.tradedoubler.com/click?p(${programId})a(${TRADEDOUBLER_TOKEN || 'REPLACE_ME'})g()url(${encodeURIComponent(productUrl)})`;
}

/**
 * בונה קישור CJ (Commission Junction).
 * @param {string} productUrl — URL המוצר
 * @param {string} websiteId  — CJ website ID
 * @returns {string}
 */
export function buildCJUrl(productUrl, websiteId) {
  const wid = websiteId || CJ_WEBSITE_ID || 'REPLACE_ME';
  return `https://www.anrdoezrs.net/click-${wid}-${Date.now()}?url=${encodeURIComponent(productUrl)}`;
}

/**
 * בונה קישור AWIN.
 * @param {string} productUrl — URL המוצר
 * @param {string} programId  — AWIN advertiser/program ID
 * @returns {string}
 */
export function buildAwinUrl(productUrl, programId) {
  const pid = programId || 'REPLACE_ME';
  const pub = AWIN_PUBLISHER_ID || 'REPLACE_ME';
  return `https://www.awin1.com/cread.php?awinmid=${pid}&awinaffid=${pub}&ued=${encodeURIComponent(productUrl)}`;
}

/**
 * בונה קישור eBay EPN.
 * @param {string} productUrl  — URL המוצר eBay
 * @param {string} campaignId  — eBay campaign ID
 * @returns {string}
 */
export function buildEbayUrl(productUrl, campaignId) {
  const cid = campaignId || EBAY_CAMPAIGN_ID || 'REPLACE_ME';
  return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${cid}&toolid=10001&type=2&ff3=4&pub=5575433651&mpre=${encodeURIComponent(productUrl)}`;
}

/**
 * בונה קישור Skimlinks (fallback — עובד עם כל URL).
 * @param {string} productUrl  — URL המוצר
 * @param {string} publisherId — Skimlinks publisher ID
 * @returns {string}
 */
export function buildSkimlinksUrl(productUrl, publisherId) {
  const pid = publisherId || SKIMLINKS_PUBLISHER_ID;
  return `https://go.skimresources.com/?id=${pid}&url=${encodeURIComponent(productUrl)}`;
}

// ── לוגיקת בחירת רשת ──────────────────────────────────────

/**
 * מחזיר את הרשת עם העמלה הגבוהה ביותר עבור חנות נתונה.
 * מתחשב בעמלות ספציפיות לחנות לפני עמלה בסיסית.
 *
 * @param {string} storeSlug     — שם החנות (lowercase, e.g. 'hm')
 * @param {string} currentNetwork — הרשת הנוכחית של הדיל
 * @returns {{ network: string, rate: number }}
 */
export function getBestNetwork(storeSlug, currentNetwork) {
  const slug = (storeSlug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = { network: 'skimlinks', rate: NETWORK_COMMISSIONS.skimlinks.base };

  for (const [network, config] of Object.entries(NETWORK_COMMISSIONS)) {
    // בדיקת עמלה ספציפית לחנות תחילה
    const storeRate   = config.stores?.[slug] ?? null;
    const effectiveRate = storeRate !== null ? storeRate : config.base;

    if (effectiveRate > best.rate) {
      best = { network, rate: effectiveRate };
    }
  }

  return best;
}

/**
 * מחלץ שם רשת אפיליאציה ממקור דיל (source field).
 * @param {string|null} source — ערך עמודת source בdeal
 * @returns {string|null}
 */
export function parseNetworkFromSource(source) {
  if (!source) return null;
  const s = source.toLowerCase();

  if (s.startsWith('tradedoubler')) return 'tradedoubler';
  if (s.startsWith('cj'))          return 'cj';
  if (s.startsWith('awin'))        return 'awin';
  if (s.startsWith('impact'))      return 'impact';
  if (s.startsWith('rakuten'))     return 'rakuten';
  if (s.startsWith('ebay'))        return 'ebay_epn';
  if (s.startsWith('skimlinks'))   return 'skimlinks';

  // מקורות scraping — אין אפיליאציה ישירה
  if (s.startsWith('scraper') || s.startsWith('manual') || s.startsWith('rss')) return null;

  return null;
}

/**
 * בודק אם יש צורך לעדכן את הרשת של דיל נתון.
 * @param {object} deal               — אובייקט דיל מSupabase
 * @param {{ network: string, rate: number }} bestNetwork — הרשת הטובה ביותר
 * @returns {boolean}
 */
export function shouldUpdateAffiliate(deal, bestNetwork) {
  const currentNetwork = parseNetworkFromSource(deal.source);

  // אין רשת נוכחית — תמיד עדכן
  if (!currentNetwork) return true;

  // כבר על הרשת הטובה ביותר
  if (currentNetwork === bestNetwork.network) return false;

  // יש רשת טובה יותר
  const currentRate = NETWORK_COMMISSIONS[currentNetwork]?.base ?? 0;
  return bestNetwork.rate > currentRate;
}

// ── בניית URL אפיליאציה לפי רשת ──────────────────────────

/**
 * בונה URL אפיליאציה חדש לפי הרשת הנבחרת.
 * @param {object} deal    — אובייקט דיל
 * @param {string} network — שם הרשת
 * @returns {string} URL אפיליאציה חדש
 */
function buildAffiliateUrl(deal, network) {
  const productUrl = deal.productUrl || deal.affiliateUrl;
  if (!productUrl) return deal.affiliateUrl;

  switch (network) {
    case 'tradedoubler': return buildTradeDoublerUrl(productUrl);
    case 'cj':           return buildCJUrl(productUrl, CJ_WEBSITE_ID);
    case 'awin':         return buildAwinUrl(productUrl, AWIN_PUBLISHER_ID);
    case 'ebay_epn':     return buildEbayUrl(productUrl, EBAY_CAMPAIGN_ID);
    case 'skimlinks':
    default:             return buildSkimlinksUrl(productUrl);
  }
}

// ── bots_log helpers ────────────────────────────────────────

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
      deals_added:   stats.added,
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── עיבוד batch של דילים ────────────────────────────────────

/**
 * מעבד batch אחד של דילים ומעדכן affiliateUrl במידת הצורך.
 * @param {object[]} deals  — batch של דילים
 * @param {object}   logger — logger instance
 * @returns {{ updated: number, skipped: number, errors: string[] }}
 */
async function processBatch(deals, logger) {
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const deal of deals) {
    try {
      const storeName   = (deal.storeName_en || '').toLowerCase().replace(/\s+/g, '');
      const bestNetwork = getBestNetwork(storeName, deal.source);

      if (!shouldUpdateAffiliate(deal, bestNetwork)) {
        skipped++;
        continue;
      }

      const newAffiliateUrl = buildAffiliateUrl(deal, bestNetwork.network);

      if (newAffiliateUrl === deal.affiliateUrl) {
        skipped++;
        continue;
      }

      const { error } = await supabase
        .from('deals')
        .update({ affiliateUrl: newAffiliateUrl })
        .eq('id', deal.id);

      if (error) throw new Error(error.message);
      updated++;

      logger.log(
        `עודכן דיל ${deal.id}: ${parseNetworkFromSource(deal.source) || 'none'} → ${bestNetwork.network} (${(bestNetwork.rate * 100).toFixed(0)}%)`
      );
    } catch (e) {
      logger.err(`שגיאה בדיל ${deal.id}: ${e.message}`);
      errors.push(e.message);
    }
  }

  return { updated, skipped, errors };
}

// ── main ───────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-29 Affiliate Sorter — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { added: 0, updated: 0, errors: [] };

  try {
    let offset       = 0;
    let totalScanned = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    while (true) {
      // שליפת batch של דילים published עם affiliateUrl
      const { data: deals, error } = await supabase
        .from('deals')
        .select('id, title_en, storeName_en, source, productUrl, affiliateUrl')
        .eq('status', 'published')
        .not('affiliateUrl', 'is', null)
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        logger.err(`שגיאה בשליפת deals: ${error.message}`);
        stats.errors.push(error.message);
        break;
      }

      if (!deals || deals.length === 0) break;

      totalScanned += deals.length;
      logger.log(`Batch offset=${offset}: ${deals.length} דילים לעיבוד`);

      const result = await processBatch(deals, logger);
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
      stats.updated += result.updated;
      stats.errors.push(...result.errors);

      logger.ok(`Batch: עודכנו ${result.updated}, דולגו ${result.skipped}, שגיאות ${result.errors.length}`);

      if (deals.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
      await sleep(BATCH_DELAY_MS);
    }

    logger.ok(`סיכום: נסרקו ${totalScanned} | עודכנו ${totalUpdated} | דולגו ${totalSkipped}`);
    logger.ok(`=== BOT-29 סיים בהצלחה — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) {
      await logFinish(logId, stats, stats.errors.length > 0 ? 'error' : 'done');
    }
  }
}

main();
