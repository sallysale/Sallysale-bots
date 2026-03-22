// ════════════════════════════════════════════════════════════
// BOT-63 — Cashback Detector
// תפקיד: מזהה הצעות cashback בדילים ושומר אותן.
//         סורק title + description + metadata_json לכל דיל פעיל.
//
// לוגיקה:
//   1. שולף דילים פעילים
//   2. סורק טקסט ל-cashback keywords
//   3. Upsert ל-cashback_offers
//   4. מעדכן deals: has_cashback=true, cashback_badge
//   5. כותב ל-bots_log
//
// תדירות: כל 6 שעות (Railway cron: 0 */6 * * *)
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-63';
const BATCH_SIZE = 200;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — exported
// ════════════════════════════════════════════════════════════

/**
 * CASHBACK_KEYWORDS — רשימת ביטויי cashback לזיהוי.
 */
const CASHBACK_KEYWORDS = [
  'cashback',
  'cash back',
  'rebate',
  '% back',
  'money back',
  'reward points',
  'earn',       // 'earn X%', 'earn points'
  'get back',
  ' back on',   // 'get $5 back on purchase'
];

/**
 * detectCashback — מזהה אם title/description מכיל הצעת cashback.
 * @param {string} title
 * @param {string} [description]
 * @returns {boolean}
 */
export function detectCashback(title, description = '') {
  const text = `${title || ''} ${description || ''}`.toLowerCase();

  return CASHBACK_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * parseCashbackAmount — מחלץ סכום cashback מטקסט.
 * @param {string} text
 * @returns {{ amount: number, type: 'percent'|'fixed' } | null}
 */
export function parseCashbackAmount(text) {
  if (!text || typeof text !== 'string') return null;

  const lower = text.toLowerCase();

  // Percent patterns: "10% cashback", "earn 3% back", "get 5% back", "3% back"
  const percentMatch = lower.match(/(\d+(?:\.\d+)?)\s*%\s*(?:cashback|cash\s+back|back|rebate|reward)/i)
    || lower.match(/earn\s+(\d+(?:\.\d+)?)\s*%/i)
    || lower.match(/get\s+(\d+(?:\.\d+)?)\s*%\s+back/i);

  if (percentMatch) {
    return { amount: parseFloat(percentMatch[1]), type: 'percent' };
  }

  // Fixed amount patterns: "$5 cash back", "$10 rebate", "get $5 back"
  const fixedMatch = lower.match(/\$(\d+(?:\.\d+)?)\s*(?:cash\s+back|cashback|rebate|back)/i)
    || lower.match(/get\s+\$(\d+(?:\.\d+)?)\s+back/i)
    || lower.match(/(\d+(?:\.\d+)?)\s*(?:dollar|usd)\s*(?:back|cashback|rebate)/i);

  if (fixedMatch) {
    return { amount: parseFloat(fixedMatch[1]), type: 'fixed' };
  }

  return null;
}

/**
 * normalizeCashbackType — מנרמל סוג cashback לאחד מ-4 ערכים.
 * @param {string} text
 * @returns {'percent'|'fixed'|'points'|'unknown'}
 */
export function normalizeCashbackType(text) {
  if (!text || typeof text !== 'string') return 'unknown';

  const lower = text.toLowerCase();

  if (lower.includes('point') || lower.includes('reward point') || lower.includes('mile')) {
    return 'points';
  }
  if (lower === 'percent' || lower.includes('%') || lower.includes('percentage')) {
    return 'percent';
  }
  if (lower === 'fixed' || lower.includes('dollar') || lower.includes('$') || lower.includes('flat')) {
    return 'fixed';
  }

  return 'unknown';
}

/**
 * computeEffectiveDiscount — מחשב הנחה אפקטיבית משולבת (מכירה + cashback).
 * נוסחה: 1 - (1 - saleDiscount/100) * (1 - cashbackPercent/100)
 * @param {number} saleDiscount    — אחוז הנחה (0-100)
 * @param {number} cashbackPercent — אחוז cashback (0-100)
 * @returns {number} — אחוז הנחה אפקטיבי (מעוגל לספרה אחת)
 */
export function computeEffectiveDiscount(saleDiscount, cashbackPercent) {
  if (typeof saleDiscount    !== 'number' || saleDiscount    < 0) saleDiscount    = 0;
  if (typeof cashbackPercent !== 'number' || cashbackPercent < 0) cashbackPercent = 0;

  const effective = 1 - (1 - saleDiscount / 100) * (1 - cashbackPercent / 100);
  return Math.round(effective * 1000) / 10; // e.g. 0.28 → 28.0
}

/**
 * formatCashbackBadge — מחרוזת badge לתצוגה.
 * @param {number} amount
 * @param {'percent'|'fixed'|'points'|'unknown'} type
 * @returns {string}
 */
export function formatCashbackBadge(amount, type) {
  if (type === 'percent') return `\uD83D\uDCB0 ${amount}% Cashback`;
  if (type === 'fixed')   return `\uD83D\uDCB0 $${amount} Back`;
  if (type === 'points')  return `\uD83D\uDCB0 ${amount} Points Back`;
  return `\uD83D\uDCB0 Cashback`;
}

/**
 * isCashbackValid — בודק אם הצעת cashback תקפה.
 * @param {{ amount: number, expires_at?: string|null }} cashback
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isCashbackValid(cashback, now = new Date()) {
  if (!cashback) return false;
  if (!cashback.amount || cashback.amount <= 0) return false;

  if (cashback.expires_at) {
    const expiry = new Date(cashback.expires_at);
    if (!isNaN(expiry.getTime()) && expiry < now) return false;
  }

  return true;
}

// ════════════════════════════════════════════════════════════
// bots_log
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
    errors:        stats.errors  || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchActiveDeals(offset = 0) {
  const { data, error } = await supabase
    .from('deals')
    .select(`
      id,
      title,
      description,
      discount,
      store_id,
      metadata_json,
      status
    `)
    .eq('status', 'active')
    .range(offset, offset + BATCH_SIZE - 1)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`fetchActiveDeals: ${error.message}`);
  return data || [];
}

async function upsertCashbackOffer(dealId, storeId, amount, type) {
  const { error } = await supabase
    .from('cashback_offers')
    .upsert({
      deal_id:         dealId,
      store_id:        storeId || null,
      cashback_amount: amount,
      cashback_type:   type,
      is_active:       true,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'deal_id' });

  if (error) throw new Error(`upsertCashbackOffer(${dealId}): ${error.message}`);
}

async function updateDealCashback(dealId, badge) {
  const { error } = await supabase
    .from('deals')
    .update({
      has_cashback:   true,
      cashback_badge: badge,
    })
    .eq('id', dealId);

  if (error) throw new Error(`updateDealCashback(${dealId}): ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Cashback Detector`);

  let logId;
  const stats = { updated: 0, detected: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    let offset  = 0;
    let fetched = 0;

    do {
      const deals = await fetchActiveDeals(offset);
      fetched = deals.length;
      log.log(`📦 Batch offset=${offset}: ${fetched} דילים`);

      for (const deal of deals) {
        try {
          // בנה טקסט לסריקה: title + description + metadata_json
          const metaText = deal.metadata_json
            ? JSON.stringify(deal.metadata_json)
            : '';

          const found = detectCashback(deal.title, `${deal.description || ''} ${metaText}`);
          if (!found) { stats.updated++; continue; }

          const fullText  = `${deal.title || ''} ${deal.description || ''} ${metaText}`;
          const parsed    = parseCashbackAmount(fullText);

          if (!parsed) { stats.updated++; continue; }

          const badge = formatCashbackBadge(parsed.amount, parsed.type);

          await upsertCashbackOffer(deal.id, deal.store_id, parsed.amount, parsed.type);
          await updateDealCashback(deal.id, badge);

          stats.detected++;
          stats.updated++;
          log.ok(`💰 Cashback: ${deal.id} — ${badge}`);

        } catch (err) {
          log.warn(`⚠️ Deal ${deal.id}: ${err.message}`);
          stats.errors.push(`deal ${deal.id}: ${err.message}`);
        }
      }

      offset += BATCH_SIZE;
    } while (fetched === BATCH_SIZE);

    log.log(`✅ סיום: ${stats.detected} cashback detected, ${stats.updated} processed`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot63.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-63 crashed:', err); process.exit(1); });
}
