// ════════════════════════════════════════════════════════════
// BOT-20 — Expiry Detector
// תפקיד: בודק כל 6 שעות את כל הדילים הפעילים ומסמן כ-expired
//         כל דיל שעומד באחד מהתנאים:
//
//         1. ends_at עבר (תאריך סיום הסייל)
//         2. המחיר חזר לנורמלי (is_real_sale=false לאחר בדיקת BOT-18)
//         3. discount ≤ 0 (אין הנחה בפועל)
//
// תדירות: כל 6 שעות (Railway cron: 0 */6 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-20';
const BATCH_SIZE = 100;
const DELAY_MS   = 200;

// סף הנחה מינימלי — מתחת לזה נחשב "לא סייל"
const MIN_DISCOUNT_PCT = 2;

// כמה ימים אחרי שBOT-18 סימן is_real_sale=false נחכה לפני שנסיר
// (מונע הסרה אגרסיבית יתרה — ייתכן שהמחיר ירד שוב)
const PRICE_NORMALIZED_GRACE_DAYS = 3;

// ── bots_log ──────────────────────────────────────────────────
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
      finished_at:    new Date().toISOString(),
      status,
      deals_scanned:  stats.scanned,
      deals_updated:  stats.expired,
      errors:         stats.errors,
    })
    .eq('id', logId);
}

// ── לוגיקת זיהוי פקיעה ───────────────────────────────────────
function detectExpiry(deal, now) {
  // תנאי 1: ends_at עבר
  if (deal.ends_at && new Date(deal.ends_at) < now) {
    return { expired: true, reason: 'ends_at_passed' };
  }

  // תנאי 2: discount ≤ MIN → אין הנחה
  if (deal.discount !== null && deal.discount !== undefined) {
    if (Number(deal.discount) <= MIN_DISCOUNT_PCT) {
      return { expired: true, reason: 'no_discount' };
    }
  }

  // תנאי 3: BOT-18 סימן is_real_sale=false + עברו GRACE_DAYS ימים
  if (
    deal.is_real_sale === false &&
    deal.price_checked_at
  ) {
    const checkedAt = new Date(deal.price_checked_at);
    const graceCutoff = new Date(now - PRICE_NORMALIZED_GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (checkedAt < graceCutoff) {
      return { expired: true, reason: 'price_normalized' };
    }
  }

  return { expired: false, reason: null };
}

// ── עיבוד batch ───────────────────────────────────────────────
async function processBatch(deals, stats, logger, now) {
  for (const deal of deals) {
    const { expired, reason } = detectExpiry(deal, now);

    if (!expired) {
      stats.active++;
      // עדכן רק last_expiry_check
      await supabase
        .from('deals')
        .update({ last_expiry_check: now.toISOString() })
        .eq('id', deal.id);
      continue;
    }

    // סמן כ-expired
    const { error } = await supabase
      .from('deals')
      .update({
        status:            'expired',
        expired_at:        now.toISOString(),
        expiry_reason:     reason,
        last_expiry_check: now.toISOString(),
      })
      .eq('id', deal.id);

    if (error) {
      logger.err(`עדכון נכשל לדיל ${deal.id}: ${error.message}`);
      stats.errors.push(`deal ${deal.id}: ${error.message}`);
    } else {
      stats.expired++;
      logger.warn(`⏰ דיל ${deal.id} → expired (${reason}) | "${deal.title_en?.slice(0, 40)}"`);
    }
  }
}

// ── main loop ──────────────────────────────────────────────────
async function detectExpiredDeals(logger) {
  const stats = { scanned: 0, expired: 0, active: 0, errors: [] };
  const now   = new Date();
  let from    = 0;

  logger.log(`בודק דילים פעילים לפקיעה... (זמן: ${now.toISOString()})`);

  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, title_en, ends_at, discount, is_real_sale, price_checked_at, price, original_price')
      .eq('status', 'published')
      .range(from, from + BATCH_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) {
      logger.err(`שגיאה בשליפה (from=${from}): ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;
    logger.log(`batch ${from}: בודק ${deals.length} דילים...`);

    await processBatch(deals, stats, logger, now);

    logger.log(`batch ${from} סיים — פעיל:${stats.active} פג:${stats.expired}`);

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
    await sleep(DELAY_MS);
  }

  return stats;
}

// ── בדוק גם validated שלא עברו לpublished ──────────────────────
async function detectExpiredValidated(logger) {
  // דילים שאומתו אבל ה-ends_at שלהם כבר עבר — לא כדאי לפרסם
  const now = new Date();
  const { data, error } = await supabase
    .from('deals')
    .select('id, title_en, ends_at')
    .eq('status', 'validated')
    .not('ends_at', 'is', null)
    .lt('ends_at', now.toISOString());

  if (error) {
    logger.warn(`validated check נכשל: ${error.message}`);
    return 0;
  }
  if (!data || data.length === 0) return 0;

  let count = 0;
  for (const deal of data) {
    const { error: ue } = await supabase
      .from('deals')
      .update({
        status:        'expired',
        expired_at:    now.toISOString(),
        expiry_reason: 'ends_at_passed',
        last_expiry_check: now.toISOString(),
      })
      .eq('id', deal.id);
    if (!ue) {
      count++;
      logger.warn(`⏰ validated דיל ${deal.id} → expired (ends_at עבר לפני publish)`);
    }
  }
  return count;
}

// ── סטטיסטיקה ─────────────────────────────────────────────────
async function printStats(stats, validatedExpired, logger) {
  logger.ok(`📊 סיכום BOT-20:`);
  logger.ok(`  🔍 נסרקו:              ${stats.scanned}`);
  logger.ok(`  ✅ פעילים (לא פגו):    ${stats.active}`);
  logger.ok(`  ⏰ סומנו כexpired:      ${stats.expired + validatedExpired}`);
  logger.ok(`     מתוכם: published→expired: ${stats.expired}`);
  logger.ok(`     מתוכם: validated→expired: ${validatedExpired}`);
  logger.ok(`  💥 שגיאות:             ${stats.errors.length}`);

  // פירוט לפי סיבה
  const { data: reasons } = await supabase
    .from('deals')
    .select('expiry_reason')
    .eq('status', 'expired')
    .not('expiry_reason', 'is', null);

  if (reasons && reasons.length > 0) {
    const counts = reasons.reduce((acc, r) => {
      acc[r.expiry_reason] = (acc[r.expiry_reason] || 0) + 1;
      return acc;
    }, {});
    logger.ok(`  📋 סה"כ expired בDB לפי סיבה:`);
    for (const [reason, cnt] of Object.entries(counts)) {
      logger.ok(`     ${reason}: ${cnt}`);
    }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-20 Expiry Detector — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, expired: 0, active: 0, errors: [] };

  try {
    // שלב 1: בדוק דילים פעילים (published)
    const runStats = await detectExpiredDeals(logger);
    Object.assign(stats, runStats);

    // שלב 2: בדוק גם validated שה-ends_at שלהם עבר
    const validatedExpired = await detectExpiredValidated(logger);

    await printStats(stats, validatedExpired, logger);
    logger.ok(`=== BOT-20 סיים בהצלחה — ${logger.elapsed()} ===`);

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
