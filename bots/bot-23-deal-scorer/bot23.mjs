// ════════════════════════════════════════════════════════════
// BOT-23 — Deal Scorer
// תפקיד: מחשב ציון 1-100 לכל דיל פעיל.
//
// נוסחה:
//   הנחה     40% — עומק ההנחה (מקס 50%)
//   נדירות   25% — כמה ימים מאז דיל דומה בקטגוריה
//   פופולריות 20% — clicks + saves
//   טריות    15% — time decay (מחצית כל 72h)
//   בונוס:   +5  — is_real_sale=true (מ-BOT-18)
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID    = 'BOT-23';
const DELAY_MS  = 300;

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
      deals_updated: stats.scored,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── חישוב ציון (JavaScript — mirror של SQL function) ──────────
// משמש לטסטים ולוגינג מפורט בלי תלות ב-DB

export function computeScore({
  discount = 0,
  clicks   = 0,
  saves    = 0,
  createdAt,
  isRealSale = null,
  rarityDays = 7,
}) {
  const now = Date.now();
  const ageHours = createdAt
    ? (now - new Date(createdAt).getTime()) / 3600000
    : 0;

  const discountScore    = Math.min(Math.max(discount, 0), 50) / 50 * 40;
  const rarityScore      = Math.min(rarityDays, 14) / 14 * 25;
  const popularityScore  =
    (Math.min(clicks, 500) / 500 * 12) +
    (Math.min(saves, 200)  / 200 * 8);
  const freshnessScore   = 15 * Math.pow(0.5, ageHours / 72);

  let total = discountScore + rarityScore + popularityScore + freshnessScore;
  if (isRealSale === true) total = Math.min(total + 5, 100);

  return {
    total:      Math.round(total * 100) / 100,
    discount:   Math.round(discountScore * 100) / 100,
    rarity:     Math.round(rarityScore * 100) / 100,
    popularity: Math.round(popularityScore * 100) / 100,
    freshness:  Math.round(freshnessScore * 100) / 100,
  };
}

// ── Batch scoring via DB RPC ───────────────────────────────────

async function scoreAllDeals(logger) {
  logger.log('מריץ batch_score_deals...');

  let total = 0;
  while (true) {
    const { data, error } = await supabase.rpc('batch_score_deals', { p_limit: 500 });
    if (error) {
      logger.err(`batch_score_deals נכשל: ${error.message}`);
      break;
    }
    total += (data || 0);
    logger.ok(`ציון: ${data} דילים עודכנו (סה"כ: ${total})`);
    if (!data || data < 500) break;
    await sleep(DELAY_MS);
  }

  return total;
}

// ── סטטיסטיקה ─────────────────────────────────────────────────

async function printStats(total, logger) {
  const { data } = await supabase
    .from('deals')
    .select('score')
    .eq('status', 'published')
    .not('score', 'is', null)
    .order('score', { ascending: false })
    .limit(5);

  if (data && data.length > 0) {
    logger.ok(`📊 Top 5 scores: ${data.map(d => d.score.toFixed(1)).join(', ')}`);
  }

  const { count } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .gte('score', 70);

  logger.ok(`⭐ דילים עם ציון ≥ 70 (לטלגרם/פוש): ${count}`);
  logger.ok(`✅ סה"כ דילים שקיבלו ציון הרצה זו: ${total}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-23 Deal Scorer — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, scored: 0, errors: [] };

  try {
    const scored = await scoreAllDeals(logger);
    stats.scanned = scored;
    stats.scored  = scored;

    await printStats(scored, logger);
    logger.ok(`=== BOT-23 סיים בהצלחה — ${logger.elapsed()} ===`);

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
