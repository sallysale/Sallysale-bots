// ════════════════════════════════════════════════════════════
// BOT-21 — Image Validator
// תפקיד: בודק שלכל דיל יש תמונה תקינה (לא 404, לא placeholder).
//         אם תמונה שבורה → מחפש תמונה חלופית דרך ScraperAPI OG tags
//         אם לא נמצאה חלופית → מסמן deals.needs_image = true
//
// תדירות: פעם ביום 04:00 UTC (Railway cron: 0 4 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import https from 'https';
import http from 'http';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-21';
const BATCH_SIZE = 100;
const DELAY_MS   = 300;
const HEAD_TIMEOUT_MS = 8000;

const PLACEHOLDER_PATTERNS = [
  'placeholder',
  'no-image',
  'noimage',
  'default-product',
  'coming-soon',
  'blank.gif',
  'spacer.gif',
  '1x1.gif',
];

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
      deals_updated: stats.ok + stats.broken + stats.fixed,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── HEAD request עם timeout ───────────────────────────────────
function headRequest(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) {
      resolve({ ok: false, status: 0, reason: 'invalid_url' });
      return;
    }

    const mod = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => {
      resolve({ ok: false, status: 0, reason: 'timeout' });
    }, HEAD_TIMEOUT_MS);

    try {
      const req = mod.request(url, { method: 'HEAD' }, (res) => {
        clearTimeout(timeout);
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        resolve({ ok, status: res.statusCode, reason: ok ? 'ok' : `http_${res.statusCode}` });
      });
      req.on('error', () => {
        clearTimeout(timeout);
        resolve({ ok: false, status: 0, reason: 'network_error' });
      });
      req.end();
    } catch {
      clearTimeout(timeout);
      resolve({ ok: false, status: 0, reason: 'exception' });
    }
  });
}

// ── האם URL נראה כמו placeholder ──────────────────────────────
function isPlaceholder(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
}

// ── ניסיון לחלץ תמונה OG דרך ScraperAPI ─────────────────────
async function fetchOgImage(affiliateUrl, scraperKey) {
  if (!scraperKey || !affiliateUrl) return null;

  const apiUrl = `https://api.scraperapi.com/?api_key=${scraperKey}&url=${encodeURIComponent(affiliateUrl)}&render=false`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);

    https.get(apiUrl, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        const match = body.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        resolve(match ? match[1] : null);
      });
    }).on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

// ── בדיקת תמונה לדיל אחד ──────────────────────────────────────
async function checkDealImage(deal, stats, logger, scraperKey) {
  const imgUrl = deal.image_url;

  // placeholder בלי בדיקת network
  if (isPlaceholder(imgUrl)) {
    logger.warn(`דיל ${deal.id}: תמונה placeholder — מחפש חלופה`);
    await tryFallback(deal, stats, logger, scraperKey);
    return;
  }

  const { ok, status, reason } = await headRequest(imgUrl);

  if (ok) {
    // תמונה תקינה — עדכן image_checked_at
    await supabase
      .from('deals')
      .update({ image_checked_at: new Date().toISOString(), needs_image: false })
      .eq('id', deal.id);
    stats.ok++;
    logger.log(`✅ דיל ${deal.id}: תמונה תקינה (${status})`);
    return;
  }

  logger.warn(`דיל ${deal.id}: תמונה שבורה (${reason}) — ${imgUrl?.slice(0, 60)}`);
  await tryFallback(deal, stats, logger, scraperKey);
}

async function tryFallback(deal, stats, logger, scraperKey) {
  let fallbackImage = null;

  if (scraperKey && deal.affiliate_url) {
    fallbackImage = await fetchOgImage(deal.affiliate_url, scraperKey);
  }

  if (fallbackImage && !isPlaceholder(fallbackImage)) {
    const { error } = await supabase
      .from('deals')
      .update({
        image_url:        fallbackImage,
        image_checked_at: new Date().toISOString(),
        needs_image:      false,
      })
      .eq('id', deal.id);

    if (!error) {
      stats.fixed++;
      logger.ok(`🔧 דיל ${deal.id}: תמונה תוקנה דרך OG tags`);
    } else {
      stats.errors.push(`deal ${deal.id}: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from('deals')
      .update({
        image_checked_at: new Date().toISOString(),
        needs_image:      true,
      })
      .eq('id', deal.id);

    if (!error) {
      stats.broken++;
      logger.warn(`🚨 דיל ${deal.id}: מסומן needs_image=true`);
    } else {
      stats.errors.push(`deal ${deal.id}: ${error.message}`);
    }
  }
}

// ── sleep ─────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main loop ──────────────────────────────────────────────────
async function validateImages(logger) {
  const scraperKey = process.env.SCRAPERAPI_KEY || null;
  if (!scraperKey) logger.warn('SCRAPERAPI_KEY חסר — לא יהיה fallback לתמונות שבורות');

  const stats = { scanned: 0, ok: 0, broken: 0, fixed: 0, errors: [] };
  let from = 0;

  // בודקים דילים published שטרם נבדקו היום
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  logger.log('מחפש דילים לבדיקת תמונות...');

  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, image_url, affiliate_url, image_checked_at')
      .eq('status', 'published')
      .or(`image_checked_at.is.null,image_checked_at.lt.${todayStart.toISOString()}`)
      .range(from, from + BATCH_SIZE - 1)
      .order('image_checked_at', { ascending: true, nullsFirst: true });

    if (error) {
      logger.err(`שגיאה בשליפה: ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;
    logger.log(`batch ${from}: בודק ${deals.length} תמונות...`);

    for (const deal of deals) {
      await checkDealImage(deal, stats, logger, scraperKey);
      await sleep(DELAY_MS);
    }

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return stats;
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-21 Image Validator — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, ok: 0, broken: 0, fixed: 0, errors: [] };

  try {
    const runStats = await validateImages(logger);
    Object.assign(stats, runStats);

    logger.ok(`📊 סיכום BOT-21:`);
    logger.ok(`  🔍 נסרקו:    ${stats.scanned}`);
    logger.ok(`  ✅ תקינות:   ${stats.ok}`);
    logger.ok(`  🔧 תוקנו:    ${stats.fixed}`);
    logger.ok(`  🚨 needs_image: ${stats.broken}`);
    logger.ok(`  💥 שגיאות:   ${stats.errors.length}`);

    logger.ok(`=== BOT-21 סיים בהצלחה — ${logger.elapsed()} ===`);
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
