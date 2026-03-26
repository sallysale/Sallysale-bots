// ════════════════════════════════════════════════════════════
// BOT-30 — Anti-Abuse (Affiliate Link Replacer)
// תפקיד: כשמשתמש מגיש דיל עם קישור אפיליאציה של צד שלישי →
//         מחליף בקישור של SallySale בשקט.
//         מתעד כל החלפה בטבלת affiliate_replacements.
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-30';
const BATCH_SIZE = 100;
const DELAY_MS   = 100;

// ── זיהוי קישורי אפיליאציה של צד שלישי ─────────────────────
// pattern → { network, description }
const THIRD_PARTY_PATTERNS = [
  // רשתות אפיליאציה
  { pattern: /amzn\.to|amazon\.[a-z]+\/.*tag=/i,               network: 'amazon',       label: 'Amazon Associates (Third Party)' },
  { pattern: /click\.linksynergy\.com/i,                        network: 'rakuten',      label: 'Rakuten LinkShare' },
  { pattern: /go\.tradedoubler\.com/i,                          network: 'tradedoubler', label: 'Tradedoubler' },
  { pattern: /cj\.com\/click|dpbolvw\.net/i,                    network: 'cj',           label: 'CJ Affiliate' },
  { pattern: /impact\.com\/c\/|impactradius\.com/i,             network: 'impact',       label: 'Impact' },
  { pattern: /awin1\.com|awinmid\.com/i,                        network: 'awin',         label: 'AWIN' },
  { pattern: /shareasale\.com\/r\./i,                           network: 'shareasale',   label: 'ShareASale' },
  { pattern: /prf\.hn\/click/i,                                 network: 'partnerize',   label: 'Partnerize' },
  { pattern: /rd\.kkimgs\.com|skim\.gs/i,                       network: 'skimlinks',    label: 'Skimlinks (Third Party)' },
  { pattern: /admitad\.com\/g\/|epn\.bz/i,                      network: 'admitad',      label: 'Admitad' },
  // קישורי shortener אפיליאציה ידועים
  { pattern: /bit\.ly\/.*aff|goo\.gl\/.*aff/i,                  network: 'unknown',      label: 'Affiliate Shortlink' },
  // UTM params אפיליאציה נפוצים של צד שלישי
  { pattern: /[?&]ref=[a-zA-Z0-9_-]{10,}|[?&]affiliate_id=/i,  network: 'unknown',      label: 'Raw Affiliate Param' },
];

// ── גלה אם URL מכיל קישור אפיליאציה של צד שלישי ────────────
function detectThirdPartyAffiliate(url) {
  if (!url) return null;
  for (const { pattern, network, label } of THIRD_PARTY_PATTERNS) {
    if (pattern.test(url)) {
      return { network, label };
    }
  }
  return null;
}

// ── בנה קישור SallySale חלופי ──────────────────────────────────
function buildSallySaleLink(dealId, originalUrl) {
  const siteUrl = process.env.SITE_URL || 'https://sallysale.com';
  // נשתמש בדירקט קישור דרך SallySale redirect endpoint
  return `${siteUrl}/go/${dealId}`;
}

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
      deals_updated: stats.replaced,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── עבד דיל אחד ──────────────────────────────────────────────
async function processDeal(deal, stats, logger) {
  const detection = detectThirdPartyAffiliate(deal.affiliate_url);
  if (!detection) {
    stats.clean++;
    return;
  }

  const originalUrl   = deal.affiliate_url;
  const replacementUrl = buildSallySaleLink(deal.id, originalUrl);

  // עדכן הדיל
  const { error: updateErr } = await supabase
    .from('deals')
    .update({ affiliate_url: replacementUrl })
    .eq('id', deal.id);

  if (updateErr) {
    logger.err(`עדכון נכשל לדיל ${deal.id}: ${updateErr.message}`);
    stats.errors.push(`deal ${deal.id}: ${updateErr.message}`);
    return;
  }

  // תעד את ההחלפה
  const { error: logErr } = await supabase
    .from('affiliate_replacements')
    .insert({
      deal_id:          deal.id,
      original_url:     originalUrl,
      replacement_url:  replacementUrl,
      detected_network: detection.network,
      detection_label:  detection.label,
      replaced_at:      new Date().toISOString(),
    });

  if (logErr) {
    logger.warn(`תיעוד החלפה נכשל לדיל ${deal.id}: ${logErr.message}`);
  }

  stats.replaced++;
  logger.log(`🔄 דיל ${deal.id}: הוחלף ${detection.label} → SallySale link`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main loop ──────────────────────────────────────────────────
async function scanDeals(logger) {
  const stats = { scanned: 0, clean: 0, replaced: 0, errors: [] };
  let from = 0;

  logger.log('סורק דילים לזיהוי קישורי אפיליאציה זרים...');

  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, affiliate_url, title_en, store')
      .in('status', ['pending', 'validated', 'published'])
      .not('affiliate_url', 'is', null)
      .range(from, from + BATCH_SIZE - 1)
      .order('created_at', { ascending: false });

    if (error) {
      logger.err(`שגיאה בשליפה: ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;
    logger.log(`batch ${from}: בודק ${deals.length} דילים...`);

    for (const deal of deals) {
      await processDeal(deal, stats, logger);
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
  logger.log('=== BOT-30 Anti-Abuse — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, clean: 0, replaced: 0, errors: [] };

  try {
    const runStats = await scanDeals(logger);
    Object.assign(stats, runStats);

    logger.ok(`📊 סיכום BOT-30:`);
    logger.ok(`  🔍 נסרקו:    ${stats.scanned}`);
    logger.ok(`  ✅ נקיים:    ${stats.clean}`);
    logger.ok(`  🔄 הוחלפו:   ${stats.replaced}`);
    logger.ok(`  💥 שגיאות:   ${stats.errors.length}`);

    logger.ok(`=== BOT-30 סיים בהצלחה — ${logger.elapsed()} ===`);
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
