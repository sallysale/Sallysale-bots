// ════════════════════════════════════════════════════════════
// BOT-19 — Link Validator
// תפקיד: בודק כל 6 שעות שכל הקישורים של דילים פעילים תקינים.
//         404 → status='expired', expired_at=now()
//         redirect → עדכן final_url
//         timeout  → warning בלבד (לא מסיר)
//
// תדירות: כל 6 שעות (Railway cron: 0 */6 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID         = 'BOT-19';
const BATCH_SIZE     = 50;
const DELAY_MS       = 300;      // בין batches
const REQUEST_TIMEOUT = 10_000;  // 10 שניות לכל בקשה
const CONCURRENCY    = 5;        // בדיקות מקבילות בתוך batch

// סטטוס HTTP שמצביעים על דיל שפג תוקפו
const EXPIRED_STATUSES = [404, 410];
// קודים שנחשבים תקינים (כולל redirects שנפתרים)
const OK_STATUSES = [200, 201, 301, 302, 303, 307, 308];

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
      deals_updated:  stats.expired + stats.redirected,
      errors:         stats.errors,
    })
    .eq('id', logId);
}

// ── HEAD request עם timeout ────────────────────────────────────
async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',   // עוקב אחרי redirects
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SallySaleBot/1.0; +https://sallysale.com)',
      },
    });
    clearTimeout(timer);

    return {
      status:   res.status,
      finalUrl: res.url !== url ? res.url : null,   // null אם לא היה redirect
      ok:       OK_STATUSES.includes(res.status),
      expired:  EXPIRED_STATUSES.includes(res.status),
      error:    null,
    };
  } catch (e) {
    clearTimeout(timer);
    const isTimeout = e.name === 'AbortError';
    return {
      status:   null,
      finalUrl: null,
      ok:       false,
      expired:  false,
      error:    isTimeout ? 'timeout' : e.message,
    };
  }
}

// ── עיבוד deal בודד ───────────────────────────────────────────
async function processDeal(deal, stats, logger) {
  const result = await checkUrl(deal.affiliate_url);

  if (result.error) {
    if (result.error === 'timeout') {
      logger.warn(`⏱️ timeout לדיל ${deal.id}: ${deal.affiliate_url}`);
      stats.timeouts++;
    } else {
      logger.warn(`⚠️ שגיאת רשת לדיל ${deal.id}: ${result.error}`);
      stats.errors.push(`deal ${deal.id}: ${result.error}`);
    }
    return;
  }

  if (result.expired) {
    // סמן כפג תוקף
    const { error: updateErr } = await supabase
      .from('deals')
      .update({
        status:     'expired',
        expired_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        link_status: result.status,
      })
      .eq('id', deal.id);

    if (updateErr) {
      logger.err(`עדכון expired נכשל לדיל ${deal.id}: ${updateErr.message}`);
      stats.errors.push(`deal ${deal.id}: ${updateErr.message}`);
    } else {
      stats.expired++;
      logger.warn(`🗑️ דיל ${deal.id} — HTTP ${result.status} → expired`);
    }
    return;
  }

  if (result.finalUrl) {
    // redirect — עדכן URL חדש
    const { error: updateErr } = await supabase
      .from('deals')
      .update({
        affiliate_url:   result.finalUrl,
        last_checked_at: new Date().toISOString(),
        link_status:     result.status,
      })
      .eq('id', deal.id);

    if (updateErr) {
      logger.err(`עדכון redirect נכשל לדיל ${deal.id}: ${updateErr.message}`);
      stats.errors.push(`deal ${deal.id}: ${updateErr.message}`);
    } else {
      stats.redirected++;
      logger.log(`🔀 דיל ${deal.id} — redirect → ${result.finalUrl.slice(0, 80)}`);
    }
    return;
  }

  if (result.ok) {
    // תקין — עדכן רק last_checked_at
    await supabase
      .from('deals')
      .update({
        last_checked_at: new Date().toISOString(),
        link_status:     result.status,
      })
      .eq('id', deal.id);
    stats.ok++;
  }
}

// ── הרץ concurrency בדיקות מקבילות ───────────────────────────
async function processWithConcurrency(deals, stats, logger) {
  for (let i = 0; i < deals.length; i += CONCURRENCY) {
    const chunk = deals.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(deal => processDeal(deal, stats, logger)));
  }
}

// ── main loop ──────────────────────────────────────────────────
async function validateLinks(logger) {
  const stats = { scanned: 0, ok: 0, expired: 0, redirected: 0, timeouts: 0, errors: [] };
  let from = 0;

  logger.log('מתחיל בדיקת קישורים לדילים פעילים...');

  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, affiliate_url, title_en')
      .eq('status', 'published')
      .range(from, from + BATCH_SIZE - 1)
      .order('last_checked_at', { ascending: true, nullsFirst: true });

    if (error) {
      logger.err(`שגיאה בשליפה (from=${from}): ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;
    logger.log(`batch ${from}: בודק ${deals.length} קישורים (concurrency=${CONCURRENCY})...`);

    await processWithConcurrency(deals, stats, logger);

    logger.log(`batch ${from} סיים — ok:${stats.ok} expired:${stats.expired} redirected:${stats.redirected} timeouts:${stats.timeouts}`);

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
    await sleep(DELAY_MS);
  }

  return stats;
}

// ── סטטיסטיקה ─────────────────────────────────────────────────
async function printStats(stats, logger) {
  logger.ok(`📊 סיכום BOT-19:`);
  logger.ok(`  🔍 נסרקו:     ${stats.scanned}`);
  logger.ok(`  ✅ תקינים:    ${stats.ok}`);
  logger.ok(`  🗑️ פגי תוקף:  ${stats.expired}`);
  logger.ok(`  🔀 redirects: ${stats.redirected}`);
  logger.ok(`  ⏱️ timeouts:  ${stats.timeouts}`);
  logger.ok(`  💥 שגיאות:   ${stats.errors.length}`);

  // סה"כ expired בDB
  const { count } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'expired');
  logger.ok(`  📋 סה"כ expired בDB: ${count}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-19 Link Validator — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, ok: 0, expired: 0, redirected: 0, timeouts: 0, errors: [] };

  try {
    const runStats = await validateLinks(logger);
    Object.assign(stats, runStats);

    await printStats(stats, logger);
    logger.ok(`=== BOT-19 סיים בהצלחה — ${logger.elapsed()} ===`);

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
