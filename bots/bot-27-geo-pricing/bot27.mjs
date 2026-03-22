// ════════════════════════════════════════════════════════════
// BOT-27 — Geo-Pricing
// תפקיד: לכל דיל פעיל — מחשב ומאחסן מחירים בכל המטבעות
//         הנתמכים, כדי שה-frontend יוכל להציג מחיר מקומי
//         מבלי לחשב בזמן אמת.
//
// תזרים: deals (price + currency) → exchange_rates → deal_prices
//
// תדירות: כל 6 שעות (Railway cron: 0 */6 * * *)
//         (תלוי ב-BOT-26 שמרוץ כל שעה ומעדכן שערים)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-27';
const BATCH_SIZE = 100;
const DELAY_MS   = 200;

// ── bots_log ───────────────────────────────────────────────────

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`logStart failed: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats, status = 'done') {
  await supabase
    .from('bots_log')
    .update({
      finished_at:   new Date().toISOString(),
      status,
      deals_scanned: stats.scanned,
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── טעינת שערי חליפין מה-DB ───────────────────────────────────

/**
 * שולף את כל שערי החליפין ב-USD כבסיס.
 * מחזיר Map: target → rate (למשל EUR → 0.92)
 */
export async function loadRates(logger) {
  const { data, error } = await supabase.rpc('get_all_rates', { p_base: 'USD' });
  if (error) throw new Error(`loadRates נכשל: ${error.message}`);
  if (!data || data.length === 0) throw new Error('אין שערי חליפין — הרץ BOT-26 קודם');

  const map = new Map();
  for (const row of data) {
    map.set(row.target, parseFloat(row.rate));
  }
  logger.ok(`✅ נטענו ${map.size} שערי חליפין`);
  return map;
}

// ── המרת מחיר ─────────────────────────────────────────────────

/**
 * ממיר מחיר בין מטבעות דרך USD כ-pivot.
 * אם from=USD → משתמש בrate ישירות.
 * אם from=EUR → ממיר EUR→USD→target.
 */
export function convertPrice(amount, fromCurrency, toCurrency, rates) {
  if (!amount || amount <= 0) return null;
  if (fromCurrency === toCurrency) return amount;

  // המר ל-USD קודם
  let usdAmount;
  if (fromCurrency === 'USD') {
    usdAmount = amount;
  } else {
    const fromRate = rates.get(fromCurrency);
    if (!fromRate) return null;
    usdAmount = amount / fromRate;  // X fromCurrency = usdAmount USD
  }

  if (toCurrency === 'USD') return Math.round(usdAmount * 100) / 100;

  const toRate = rates.get(toCurrency);
  if (!toRate) return null;

  return Math.round(usdAmount * toRate * 100) / 100;
}

// ── שמירת מחירים גיאוגרפיים ───────────────────────────────────

/**
 * לכל batch של דילים — מחשב מחירים בכל המטבעות.
 * שומר ב-deal_prices (אם קיים) או מעדכן ישירות ב-deals עם שדה prices_json.
 *
 * כיוון שdeal_prices אינו בmigrations הקודמים, נשמור כ-jsonb
 * בעמודת geo_prices על deals — נוסיף אותה פה.
 */
async function processBatch(deals, rates, stats, logger) {
  // מגדיר את המטבעות הנתמכים (אלו שיש לנו CCM records עבורם)
  const { data: ccmRows } = await supabase
    .from('country_currency_map')
    .select('currency, country_code, locale');

  const currencies = [...new Set((ccmRows || []).map(r => r.currency))];

  for (const deal of deals) {
    const prices = {};

    for (const currency of currencies) {
      const converted = convertPrice(deal.price, deal.currency || 'USD', currency, rates);
      if (converted !== null) {
        prices[currency] = converted;
      }
    }

    // שמור geo_prices על הדיל
    const { error } = await supabase
      .from('deals')
      .update({
        geo_prices:       prices,
        geo_prices_at:    new Date().toISOString(),
      })
      .eq('id', deal.id);

    if (error) {
      logger.warn(`geo_prices נכשל לדיל ${deal.id}: ${error.message}`);
      stats.errors.push(`deal ${deal.id}: ${error.message}`);
    } else {
      stats.updated++;
    }
  }
}

// ── main loop ──────────────────────────────────────────────────

async function processAllDeals(rates, logger, stats) {
  let from = 0;

  logger.log('מחשב geo_prices לכל הדילים...');

  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, price, currency')
      .eq('status', 'published')
      .range(from, from + BATCH_SIZE - 1)
      .order('id');

    if (error) {
      logger.err(`שגיאה בשליפה (from=${from}): ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;
    await processBatch(deals, rates, stats, logger);

    logger.log(`batch ${from}: ${deals.length} דילים, ${stats.updated} עודכנו`);

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
    await sleep(DELAY_MS);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-27 Geo-Pricing — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, updated: 0, errors: [] };

  try {
    // טען שערי חליפין
    const rates = await loadRates(logger);

    // חשב ועדכן geo_prices לכל הדילים
    await processAllDeals(rates, logger, stats);

    logger.ok(`=== BOT-27 סיים — ${stats.scanned} נסרקו, ${stats.updated} עודכנו ===`);
    logger.ok(`🌍 ${logger.elapsed()}`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) {
      await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
    }
  }
}

main();
