// ════════════════════════════════════════════════════════════
// BOT-18 — Price History Core
// תפקיד: שומר snapshot מחיר יומי לכל דיל פעיל.
//         אחרי כל run מריץ analyze שמחשב ממוצע 90 יום
//         ומסמן is_real_sale = true/false על כל דיל.
//
// תדירות: פעם ביום (Railway cron: 0 6 * * *)
// מוציא: price_history rows + is_real_sale עדכני על deals
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-18';
const BATCH_SIZE = 100;   // כמה דילים מעבדים בכל batch
const DELAY_MS   = 150;   // השהיה בין batches למניעת עומס DB

// ── כניסה לbots_log ──────────────────────────────────────────
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
      finished_at:     new Date().toISOString(),
      status,
      deals_scanned:   stats.scanned,
      records_added:   stats.added,
      records_skipped: stats.skipped,
      errors:          stats.errors,
    })
    .eq('id', logId);
}

// ── שלב 1: שמור snapshots מחיר ───────────────────────────────
async function saveSnapshots(logger) {
  const stats = { scanned: 0, added: 0, skipped: 0 };
  let from = 0;

  logger.log('מתחיל שמירת snapshots מחיר...');

  while (true) {
    // שלוף batch של דילים פעילים
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, price, currency')
      .eq('status', 'published')
      .range(from, from + BATCH_SIZE - 1)
      .order('id');

    if (error) {
      logger.err(`שגיאה בשליפת דילים (from=${from}): ${error.message}`);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;

    // שמור snapshot לכל דיל
    for (const deal of deals) {
      if (!deal.price || deal.price <= 0) {
        stats.skipped++;
        continue;
      }

      const { error: snapErr } = await supabase.rpc('record_price_snapshot', {
        p_deal_id: deal.id,
        p_price:   deal.price,
        p_currency: deal.currency || 'ILS',
        p_source:  BOT_ID,
      });

      if (snapErr) {
        logger.warn(`snapshot נכשל לדיל ${deal.id}: ${snapErr.message}`);
        stats.skipped++;
      } else {
        stats.added++;
      }
    }

    logger.log(`batch ${from}-${from + deals.length - 1}: ${deals.length} דילים, ${stats.added} snapshots נוספו`);

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
    await sleep(DELAY_MS);
  }

  return stats;
}

// ── שלב 2: חשב ממוצע 90 יום + סמן is_real_sale ───────────────
async function analyzeAll(logger) {
  logger.log('מריץ batch_analyze_price_history...');

  // הרץ בלופים עד שכולם מטופלים
  let total = 0;
  while (true) {
    const { data, error } = await supabase.rpc('batch_analyze_price_history', { p_limit: 500 });
    if (error) {
      logger.err(`batch_analyze נכשל: ${error.message}`);
      break;
    }
    total += (data || 0);
    logger.ok(`אנליזה: ${data} דילים עודכנו (סה"כ: ${total})`);
    if (!data || data < 500) break;
    await sleep(500);
  }

  return total;
}

// ── שלב 3: סטטיסטיקה לאחר הרצה ──────────────────────────────
async function printStats(logger) {
  const { data } = await supabase
    .from('deals')
    .select('is_real_sale')
    .eq('status', 'published');

  if (!data) return;

  const realSales    = data.filter(d => d.is_real_sale === true).length;
  const notRealSales = data.filter(d => d.is_real_sale === false).length;
  const noData       = data.filter(d => d.is_real_sale === null).length;

  logger.ok(`📊 סטטוס דילים:`);
  logger.ok(`  ✅ סייל אמיתי (מתחת 85% ממוצע): ${realSales}`);
  logger.ok(`  ❌ לא סייל אמיתי:                ${notRealSales}`);
  logger.ok(`  ⏳ אין מספיק נתונים (<90 יום):   ${noData}`);

  const { count } = await supabase
    .from('price_history')
    .select('*', { count: 'exact', head: true });

  logger.ok(`  📈 סה"כ records בprice_history: ${count}`);
}

// ── utils ──────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-18 Price History Core — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log entry: ${e.message}`);
    // ממשיך בכל זאת — log לא קריטי להרצה
  }

  const stats = { scanned: 0, added: 0, skipped: 0, errors: [] };

  try {
    // שלב 1: snapshots
    const snapStats = await saveSnapshots(logger);
    stats.scanned = snapStats.scanned;
    stats.added   = snapStats.added;
    stats.skipped = snapStats.skipped;

    // שלב 2: analyze
    await analyzeAll(logger);

    // שלב 3: report
    await printStats(logger);

    logger.ok(`=== BOT-18 סיים בהצלחה — ${logger.elapsed()} ===`);
    logger.ok(`סיכום: ${stats.scanned} נסרקו, ${stats.added} נוספו, ${stats.skipped} דולגו`);

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
