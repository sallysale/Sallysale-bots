// ════════════════════════════════════════════════════════════
// BOT-56 — Bundle Detector
// תפקיד: מזהה דילים מסוג חבילה (Buy X Get Y, BOGO, combo packs, multi-buy).
//
// לוגיקה:
//   1. שולף דילים פעילים שטרם עברו זיהוי חבילה
//   2. סורק title + description לתבניות bundle
//   3. מחשב סוג חבילה, כמות, ציון בונוס
//   4. מעדכן deals: bundle_flag, bundle_type, bundle_quantity, bundle_badge
//   5. מכניס/מעדכן ב-bundles table
//   6. כותב ל-bots_log
//
// תדירות: כל 12 שעות (Railway cron: 0 */12 * * *)
//
// Env vars:
//   SUPABASE_URL        — מ-Supabase
//   SUPABASE_SERVICE_KEY — service role key
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID          = 'BOT-56';
const MAX_DEALS_PER_RUN = 1000;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * isBundleDeal — בודק אם דיל הוא עסקת חבילה.
 * @param {string} title
 * @param {string} [description]
 * @returns {boolean}
 */
export function isBundleDeal(title, description = '') {
  const text = `${title || ''} ${description || ''}`.toLowerCase();

  const bundlePatterns = [
    /\bbuy\s+(one|1|two|2|three|3)\s+get\s+(one|1|two|2|free)\b/,
    /\bbogo\b/,
    /\bbundle\b/,
    /\bcombo\s*(pack|deal|set|offer)?\b/,
    /\bpack\s+of\s+\d+/,
    /\bset\s+of\s+\d+/,
    /\bmultipack\b/,
    /\bmulti[\s-]?pack\b/,
    /\b2\s+for\s+1\b/,
    /\b3\s+for\s+2\b/,
    /\b\d+\s+for\s+the\s+price\s+of\s+\d+/,
    /\bbuy\s+one\s+get\s+one\b/,
    /\bgift\s+with\s+purchase\b/,
    /\bvalue\s+(set|pack|bundle)\b/,
    /\bdual\s+pack\b/,
    /\btwin\s+pack\b/,
    /\bfamily\s+pack\b/,
    /\bbulk\s+(buy|deal|pack)\b/,
  ];

  return bundlePatterns.some(p => p.test(text));
}

/**
 * parseBundleType — מזהה את סוג החבילה.
 * @param {string} text
 * @returns {'bogo'|'multi_buy'|'combo_pack'|'gift_with_purchase'|'value_set'|'unknown'}
 */
export function parseBundleType(text) {
  const t = (text || '').toLowerCase();

  if (/\bbogo\b|\bbuy\s+(one|1)\s+get\s+(one|1|free)\b|\bbuy\s+one\s+get\s+one\b/.test(t)) {
    return 'bogo';
  }
  if (/\b\d+\s+for\s+\d+\b|\b2\s+for\s+1\b|\b3\s+for\s+2\b|\bmultipack\b|\bmulti[\s-]?pack\b|\bbulk\s+(buy|deal)\b/.test(t)) {
    return 'multi_buy';
  }
  if (/\bcombo\b|\bpack\s+of\s+\d+|\bset\s+of\s+\d+|\bdual\s+pack\b|\btwin\s+pack\b|\bfamily\s+pack\b/.test(t)) {
    return 'combo_pack';
  }
  if (/\bgift\s+with\s+purchase\b/.test(t)) {
    return 'gift_with_purchase';
  }
  if (/\bvalue\s+(set|pack|bundle)\b|\bbundle\b/.test(t)) {
    return 'value_set';
  }
  return 'unknown';
}

/**
 * extractBundleQuantity — מחלץ כמות מהטקסט.
 * @param {string} text
 * @returns {number|null}
 */
export function extractBundleQuantity(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // "pack of 6", "set of 3 items", "bundle of 4"
  const packMatch = t.match(/\b(?:pack|set|bundle|multipack|multi-?pack)\s+of\s+(\d+)/);
  if (packMatch) return parseInt(packMatch[1], 10);

  // "6 pack", "3-pack", "4pack"
  const nPackMatch = t.match(/\b(\d+)[\s-]?pack\b/);
  if (nPackMatch) return parseInt(nPackMatch[1], 10);

  // "3 for 2", "2 for 1" — take the first number as quantity
  const forMatch = t.match(/\b(\d+)\s+for\s+(?:the\s+price\s+of\s+)?\d+/);
  if (forMatch) return parseInt(forMatch[1], 10);

  // "buy 2 get 1" — quantity = buy + get
  const buyGetMatch = t.match(/\bbuy\s+(\d+)\s+get\s+(\d+)/);
  if (buyGetMatch) {
    return parseInt(buyGetMatch[1], 10) + parseInt(buyGetMatch[2], 10);
  }

  // "dual pack" = 2, "twin pack" = 2, "family pack" = 4
  if (/\bdual\s+pack\b/.test(t)) return 2;
  if (/\btwin\s+pack\b/.test(t)) return 2;
  if (/\bfamily\s+pack\b/.test(t)) return 4;

  return null;
}

/**
 * computeBundleValue — חישוב חיסכון לפי מחיר יחידה, כמות ומחיר חבילה.
 * @param {number} unitPrice — מחיר יחידה בודדת
 * @param {number} quantity — כמות יחידות בחבילה
 * @param {number} bundlePrice — מחיר החבילה הכולל
 * @returns {{ totalSavings: number, savingsPerUnit: number }}
 */
export function computeBundleValue(unitPrice, quantity, bundlePrice) {
  if (!unitPrice || !quantity || !bundlePrice || quantity <= 0) {
    return { totalSavings: 0, savingsPerUnit: 0 };
  }
  const fullPrice = unitPrice * quantity;
  const totalSavings = Math.max(0, fullPrice - bundlePrice);
  const savingsPerUnit = totalSavings / quantity;
  return {
    totalSavings: Math.round(totalSavings * 100) / 100,
    savingsPerUnit: Math.round(savingsPerUnit * 100) / 100,
  };
}

/**
 * formatBundleDisplay — מחזיר תגית תצוגה לחבילה.
 * @param {string} bundleType
 * @param {number|null} quantity
 * @returns {string}
 */
export function formatBundleDisplay(bundleType, quantity) {
  switch (bundleType) {
    case 'bogo':
      return '🎁 BOGO';
    case 'multi_buy':
      return quantity ? `2️⃣ Buy ${quantity - 1} Get ${1}` : '2️⃣ Multi-Buy';
    case 'combo_pack':
      return quantity ? `📦 Pack of ${quantity}` : '📦 Combo Pack';
    case 'gift_with_purchase':
      return '🎁 Gift with Purchase';
    case 'value_set':
      return quantity ? `📦 Value Set of ${quantity}` : '📦 Value Set';
    default:
      return quantity ? `📦 Bundle (${quantity} items)` : '📦 Bundle Deal';
  }
}

/**
 * scoreBundleDeal — ציון בונוס לפי סוג חבילה.
 * @param {Object} deal — אובייקט דיל (עם score קיים)
 * @param {string} bundleType
 * @returns {number} — בונוס נקודות (0-20)
 */
export function scoreBundleDeal(deal, bundleType) {
  const bonusMap = {
    bogo: 20,
    multi_buy: 15,
    gift_with_purchase: 18,
    value_set: 12,
    combo_pack: 10,
    unknown: 0,
  };
  return bonusMap[bundleType] ?? 0;
}

// ════════════════════════════════════════════════════════════
// DB helpers
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
    finished_at: new Date().toISOString(),
    status: stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    errors: stats.errors || [],
  }).eq('id', id);
}

/**
 * fetchDealsForBundleDetection — שולף דילים לסריקה.
 */
async function fetchDealsForBundleDetection() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, description, price, currency, score, store_id')
    .eq('status', 'active')
    .or('bundle_flag.is.null,bundle_detected_at.is.null')
    .limit(MAX_DEALS_PER_RUN);

  if (error) {
    log.err(`fetchDealsForBundleDetection: ${error.message}`);
    return [];
  }
  return data || [];
}

/**
 * updateDealBundle — מעדכן שדות bundle על דיל.
 */
async function updateDealBundle(dealId, bundleData) {
  const { error } = await supabase
    .from('deals')
    .update({
      bundle_flag: bundleData.bundle_flag,
      bundle_type: bundleData.bundle_type || null,
      bundle_quantity: bundleData.bundle_quantity || null,
      bundle_badge: bundleData.bundle_badge || null,
      bundle_detected_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) {
    log.err(`updateDealBundle ${dealId}: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * upsertBundle — מכניס/מעדכן רשומה ב-bundles table.
 */
async function upsertBundle(bundleRecord) {
  const { error } = await supabase
    .from('bundles')
    .upsert(bundleRecord, { onConflict: 'deal_id' });

  if (error) {
    log.err(`upsertBundle deal ${bundleRecord.deal_id}: ${error.message}`);
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════

export async function runBot56() {
  log.log('BOT-56 Bundle Detector — start');
  const logId = await logStart();

  const stats = { updated: 0, bundlesFound: 0, errors: [] };

  try {
    const deals = await fetchDealsForBundleDetection();
    log.log(`Scanning ${deals.length} deals for bundle patterns`);

    for (const deal of deals) {
      const textToSearch = [deal.title, deal.description].filter(Boolean).join(' ');
      const isBundle = isBundleDeal(deal.title, deal.description);

      if (isBundle) {
        const bundleType = parseBundleType(textToSearch);
        const quantity = extractBundleQuantity(textToSearch);
        const badge = formatBundleDisplay(bundleType, quantity);
        const bonus = scoreBundleDeal(deal, bundleType);

        log.log(`Deal ${deal.id}: "${deal.title}" → ${bundleType} (qty=${quantity ?? 'n/a'}, badge="${badge}")`);

        // Update deal
        const okDeal = await updateDealBundle(deal.id, {
          bundle_flag: true,
          bundle_type: bundleType,
          bundle_quantity: quantity,
          bundle_badge: badge,
        });

        if (okDeal) {
          // Upsert into bundles table
          const bundleRecord = {
            deal_id: deal.id,
            bundle_type: bundleType,
            quantity: quantity || null,
            unit_price: deal.price || null,
            bundle_price: deal.price || null,
            savings_per_unit: null,
            display_text: badge,
            updated_at: new Date().toISOString(),
          };

          // If we have unit_price and quantity, attempt compute
          if (deal.price && quantity && quantity > 1) {
            // Assume the listed price is the bundle price; estimate unit price
            const estimatedUnit = deal.price / quantity;
            // We can't know true unit price without external data, so just store for reference
            bundleRecord.unit_price = Math.round(estimatedUnit * 100) / 100;
            bundleRecord.bundle_price = deal.price;
            bundleRecord.savings_per_unit = null; // unknown without original unit price
          }

          await upsertBundle(bundleRecord);
          stats.bundlesFound++;
          stats.updated++;
        }
      } else {
        // Mark as checked (not a bundle)
        const okDeal = await updateDealBundle(deal.id, {
          bundle_flag: false,
          bundle_type: null,
          bundle_quantity: null,
          bundle_badge: null,
        });
        if (okDeal) stats.updated++;
      }
    }

    log.ok(`Done — scanned ${deals.length} deals, found ${stats.bundlesFound} bundles`);
  } catch (e) {
    log.err(`Unexpected error: ${e.message}`);
    stats.errors.push(e.message);
  }

  await logFinish(logId, stats);
  return stats;
}

// ════════════════════════════════════════════════════════════
// Entry point
// ════════════════════════════════════════════════════════════
const isMain = process.argv[1] && process.argv[1].endsWith('bot56.mjs');
if (isMain) {
  runBot56().then(stats => {
    console.log('\nStats:', stats);
    process.exit(stats.errors.length > 0 ? 1 : 0);
  }).catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
