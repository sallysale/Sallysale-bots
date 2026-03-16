// ════════════════════════════════════════════════════════════
// BOT-17 — Price Validator
// תפקיד: בודק כל דיל חדש (status='pending') לפני שעולה לאתר.
//         מוודא שהמחיר הגיוני, ההנחה אמיתית, ושאין שגיאות ברורות.
//         אם הכל תקין → status='validated'
//         אם יש בעיה  → status='price_error' + פירוט
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID     = 'BOT-17';
const BATCH_SIZE = 50;
const DELAY_MS   = 200;

// ── גבולות סניטי ────────────────────────────────────────────
const MIN_PRICE          = 0.01;
const MAX_PRICE          = 999_999;
const MAX_DISCOUNT_PCT   = 95;   // מעל 95% — חשוד
const MIN_DISCOUNT_PCT   = 1;    // מתחת ל-1% — לא שווה
const FLAG_DISCOUNT_PCT  = 70;   // מעל 70% → flag לבדיקת אדמין (לא חסום)

// ── bots_log ─────────────────────────────────────────────────
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
      deals_updated: stats.validated + stats.rejected,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── לוגיקת ולידציה ───────────────────────────────────────────
function validatePrice(deal) {
  const errors = [];
  const warnings = [];

  const price    = Number(deal.price);
  const original = deal.original_price ? Number(deal.original_price) : null;

  // בדיקה 1: מחיר חייב להיות מספר חיובי
  if (!deal.price || isNaN(price)) {
    errors.push('מחיר חסר או לא מספר');
    return { valid: false, errors, warnings };
  }
  if (price < MIN_PRICE) {
    errors.push(`מחיר נמוך מדי: ${price} (מינ׳ ${MIN_PRICE})`);
  }
  if (price > MAX_PRICE) {
    errors.push(`מחיר גבוה מדי: ${price} (מקס׳ ${MAX_PRICE})`);
  }

  // בדיקה 2: מחיר מקורי הגיוני
  if (original !== null) {
    if (isNaN(original) || original <= 0) {
      errors.push(`מחיר מקורי לא תקין: ${deal.original_price}`);
    } else if (original < price) {
      errors.push(`מחיר מקורי (${original}) נמוך ממחיר הדיל (${price})`);
    } else if (original === price) {
      errors.push('מחיר מקורי זהה למחיר הדיל — אין הנחה');
    }
  }

  // בדיקה 3: אחוז הנחה הגיוני (discount = generated column, read-only)
  if (deal.discount !== null && deal.discount !== undefined) {
    const disc = Number(deal.discount);
    if (!isNaN(disc)) {
      if (disc < MIN_DISCOUNT_PCT) {
        errors.push(`הנחה נמוכה מדי: ${disc}%`);
      }
      if (disc > MAX_DISCOUNT_PCT) {
        errors.push(`הנחה חשודה — גבוהה מדי: ${disc}%`);
      }
      if (disc > FLAG_DISCOUNT_PCT && disc <= MAX_DISCOUNT_PCT) {
        warnings.push(`הנחה גבוהה (${disc}%) — מסומן לבדיקת אדמין`);
      }
    }
  } else if (original && original > price) {
    // חשב discount בעצמנו אם חסר (לא יקרה כי generated, אבל backup)
    const calcDisc = Math.round(((original - price) / original) * 100);
    if (calcDisc < MIN_DISCOUNT_PCT) {
      errors.push(`הנחה מחושבת נמוכה מדי: ${calcDisc}%`);
    }
    if (calcDisc > MAX_DISCOUNT_PCT) {
      errors.push(`הנחה מחושבת חשודה: ${calcDisc}%`);
    }
  }

  // בדיקה 4: כותרת ו-URL לא ריקים
  if (!deal.title_en || deal.title_en.trim().length < 3) {
    errors.push('כותרת (title_en) חסרה או קצרה מדי');
  }
  if (!deal.affiliate_url || !deal.affiliate_url.startsWith('http')) {
    errors.push('affiliate_url חסר או לא תקין');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── עיבוד batch ───────────────────────────────────────────────
async function processBatch(deals, stats, logger) {
  for (const deal of deals) {
    const { valid, errors, warnings } = validatePrice(deal);

    if (warnings.length > 0) {
      warnings.forEach(w => logger.warn(`דיל ${deal.id}: ${w}`));
    }

    const updatePayload = valid
      ? {
          status:          'validated',
          price_validated: true,
          validation_note: warnings.length > 0 ? warnings.join(' | ') : null,
          validated_at:    new Date().toISOString(),
          // discount הוא generated column — לא לכתוב אליו
        }
      : {
          status:          'price_error',
          price_validated: false,
          validation_note: errors.join(' | '),
          validated_at:    new Date().toISOString(),
        };

    const { error: updateErr } = await supabase
      .from('deals')
      .update(updatePayload)
      .eq('id', deal.id);

    if (updateErr) {
      logger.err(`עדכון נכשל לדיל ${deal.id}: ${updateErr.message}`);
      stats.errors.push(`deal ${deal.id}: ${updateErr.message}`);
    } else if (valid) {
      stats.validated++;
      logger.log(`✅ דיל ${deal.id} אומת (${deal.price} ${deal.currency || ''}) — ${deal.title_en?.slice(0, 40)}`);
    } else {
      stats.rejected++;
      logger.warn(`❌ דיל ${deal.id} נדחה: ${errors.join(', ')}`);
    }
  }
}

// ── main loop ──────────────────────────────────────────────────
async function validatePendingDeals(logger) {
  const stats = { scanned: 0, validated: 0, rejected: 0, errors: [] };
  let from = 0;

  logger.log('מחפש דילים בsatus=pending לוולידציה...');

  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, price, original_price, discount, currency, title_en, affiliate_url, store')
      .eq('status', 'pending')
      .range(from, from + BATCH_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) {
      logger.err(`שגיאה בשליפה (from=${from}): ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;
    logger.log(`batch ${from}: מעבד ${deals.length} דילים...`);

    await processBatch(deals, stats, logger);

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
    await sleep(DELAY_MS);
  }

  return stats;
}

// ── סטטיסטיקה ─────────────────────────────────────────────────
async function printStats(stats, logger) {
  logger.ok(`📊 סיכום BOT-17:`);
  logger.ok(`  🔍 נסרקו:   ${stats.scanned}`);
  logger.ok(`  ✅ אומתו:   ${stats.validated}`);
  logger.ok(`  ❌ נדחו:    ${stats.rejected}`);
  logger.ok(`  💥 שגיאות:  ${stats.errors.length}`);

  // סה"כ דילים לפי סטטוס
  const { data } = await supabase
    .from('deals')
    .select('status')
    .in('status', ['pending', 'validated', 'price_error', 'published']);

  if (data) {
    const counts = data.reduce((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {});
    logger.ok(`  📋 pending:     ${counts.pending     || 0}`);
    logger.ok(`  📋 validated:   ${counts.validated   || 0}`);
    logger.ok(`  📋 price_error: ${counts.price_error || 0}`);
    logger.ok(`  📋 published:   ${counts.published   || 0}`);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-17 Price Validator — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, validated: 0, rejected: 0, errors: [] };

  try {
    const runStats = await validatePendingDeals(logger);
    Object.assign(stats, runStats);

    await printStats(stats, logger);
    logger.ok(`=== BOT-17 סיים בהצלחה — ${logger.elapsed()} ===`);

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
