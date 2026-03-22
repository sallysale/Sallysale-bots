// ════════════════════════════════════════════════════════════
// BOT-69 — Affiliate Link Tester
// תפקיד: בודק קישורי אפיליאציה — 404/expired/broken.
//
// לוגיקה:
//   • מביא דילים פעילים עם affiliate_url (batch 100)
//   • ממיין לפי ישן ביותר לבדיקה
//   • HEAD/GET לכל URL עם timeout 10s
//   • מעדכן deals: link_status, last_checked_at, affiliate_link_ok
//   • מתעד ב-affiliate_test_log
//
// תדירות: פעם ביום 05:00 UTC (Railway cron: 0 5 * * *)
//
// Env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID   = 'BOT-69';
const log      = createLogger(BOT_ID);

export const LINK_TEST_TIMEOUT_MS = 10000;
export const BATCH_SIZE           = 100;
export const DEFAULT_MAX_AGE_HOURS = 24;

const AFFILIATE_MARKERS = [
  'tag=',
  'aff_id=',
  'affiliate=',
  'clickid=',
  'clickId=',
  'ref=',
  'partner=',
  'afftrack=',
  'utm_source=affiliate',
  'subid=',
  'pub_id=',
  'publisher_id=',
  'tduid=',        // Tradedoubler
  'awc=',          // AWIN
  'cjevent=',      // CJ
  'irgwc=',        // Impact
];

const EXPIRED_SIGNALS = [
  'offer expired',
  'deal ended',
  'no longer available',
  'this offer has expired',
  'this deal has ended',
  'promotion has ended',
  'product is no longer',
];

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * isAffiliateUrl — האם ה-URL מכיל markers של אפיליאציה.
 * @param {string} url
 * @returns {boolean}
 */
export function isAffiliateUrl(url) {
  if (!url) return false;
  return AFFILIATE_MARKERS.some(marker => url.includes(marker));
}

/**
 * classifyLinkStatus — מסווג סטטוס קישור.
 * @param {number} statusCode
 * @param {string|null} finalUrl — URL אחרי redirect
 * @returns {'ok'|'redirect'|'broken'|'blocked'|'expired'}
 */
export function classifyLinkStatus(statusCode, finalUrl) {
  if (statusCode === 404) return 'broken';
  if (statusCode === 403) return 'blocked';
  if (statusCode === 410) return 'expired';
  if (statusCode >= 301 && statusCode <= 308 && finalUrl) return 'redirect';
  if (statusCode >= 200 && statusCode < 300) return 'ok';
  if (statusCode >= 500) return 'broken';
  return 'broken';
}

/**
 * detectExpiredAffiliate — האם דף מכיל סיגנלים של תפוגה.
 * @param {string} url
 * @param {string} body
 * @returns {boolean}
 */
export function detectExpiredAffiliate(url, body) {
  if (!body) return false;
  const lower = body.toLowerCase();
  return EXPIRED_SIGNALS.some(signal => lower.includes(signal));
}

/**
 * buildTestResult — בונה תוצאת בדיקת קישור.
 * @param {string} url
 * @param {number} statusCode
 * @param {string|null} finalUrl
 * @param {string} body
 * @returns {{ status:string, isWorking:boolean, reason:string }}
 */
export function buildTestResult(url, statusCode, finalUrl, body) {
  // Check for expired page content first (before status classification)
  if (statusCode >= 200 && statusCode < 300 && detectExpiredAffiliate(url, body)) {
    return { status: 'expired', isWorking: false, reason: 'page_content_expired' };
  }

  const status = classifyLinkStatus(statusCode, finalUrl);
  const isWorking = status === 'ok' || status === 'redirect';
  const reason = isWorking ? 'ok' : `status_${statusCode}`;
  return { status, isWorking, reason };
}

/**
 * shouldTestLink — האם הקישור צריך בדיקה (לפי גיל).
 * @param {{ last_affiliate_test_at: string|null }} deal
 * @param {number} maxAgeHours
 * @param {Date} now
 * @returns {boolean}
 */
export function shouldTestLink(deal, maxAgeHours = DEFAULT_MAX_AGE_HOURS, now = new Date()) {
  if (!deal.last_affiliate_test_at) return true;
  const age = (now - new Date(deal.last_affiliate_test_at)) / (1000 * 60 * 60);
  return age >= maxAgeHours;
}

/**
 * prioritizeDealsByLink — ממיין: ציון יורד + נבדק פחות לאחרונה ראשון.
 * @param {Array<{ score:number, last_affiliate_test_at:string|null }>} deals
 * @returns {Array}
 */
export function prioritizeDealsByLink(deals) {
  return [...deals].sort((a, b) => {
    // oldest tested first (null = never = highest priority)
    const aTime = a.last_affiliate_test_at ? new Date(a.last_affiliate_test_at).getTime() : 0;
    const bTime = b.last_affiliate_test_at ? new Date(b.last_affiliate_test_at).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    // then by score descending
    return (b.score || 0) - (a.score || 0);
  });
}

// ════════════════════════════════════════════════════════════
// HTTP test
// ════════════════════════════════════════════════════════════

async function testLink(url) {
  try {
    const res = await fetch(url, {
      method:  'HEAD',
      redirect: 'manual',
      signal:   AbortSignal.timeout(LINK_TEST_TIMEOUT_MS),
      headers:  {
        'User-Agent': 'Mozilla/5.0 (compatible; SallySaleBot/1.0)',
      },
    });

    const statusCode = res.status;
    const finalUrl   = res.headers.get('location') || null;

    // For redirect, follow to check final destination
    if (statusCode >= 301 && statusCode <= 308 && finalUrl) {
      return { statusCode, finalUrl, body: '' };
    }

    // For 200, do a GET to check body (only if needed for expired detection)
    if (statusCode === 200) {
      try {
        const getRes = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(LINK_TEST_TIMEOUT_MS),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SallySaleBot/1.0)' },
        });
        const body = await getRes.text().catch(() => '');
        return { statusCode, finalUrl: null, body: body.substring(0, 2000) };
      } catch {
        return { statusCode, finalUrl: null, body: '' };
      }
    }

    return { statusCode, finalUrl, body: '' };
  } catch (err) {
    // Timeout or network error
    return { statusCode: 0, finalUrl: null, body: '', error: err.message };
  }
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchActiveDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, url, score, last_affiliate_test_at, link_status')
    .eq('status', 'active')
    .not('url', 'is', null)
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetchActiveDeals: ${error.message}`);
  return data || [];
}

async function updateDeal(dealId, result) {
  const { error } = await supabase
    .from('deals')
    .update({
      link_status:           result.status,
      last_checked_at:       new Date().toISOString(),
      affiliate_link_ok:     result.isWorking,
      last_affiliate_test_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) log.warn(`updateDeal(${dealId}): ${error.message}`);
}

async function logTestResult(dealId, url, statusCode, linkStatus) {
  const { error } = await supabase
    .from('affiliate_test_log')
    .insert({
      deal_id:     dealId,
      url_tested:  url,
      status_code: statusCode,
      link_status: linkStatus,
    });

  if (error) log.warn(`logTestResult(${dealId}): ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// bots_log helpers
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
    errors:        stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-69 — Affiliate Link Tester starting`);

  let logId;
  const stats = { updated: 0, broken: 0, ok: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const rawDeals = await fetchActiveDeals();
    log.log(`Fetched ${rawDeals.length} active deals`);

    // Add last_affiliate_test_at alias (deals table uses 'url' for affiliate_url)
    const deals = rawDeals.map(d => ({
      ...d,
      last_affiliate_test_at: d.last_affiliate_test_at || null,
    }));

    const prioritized = prioritizeDealsByLink(deals);
    const toTest      = prioritized.filter(d => shouldTestLink(d));
    log.log(`Testing ${toTest.length} deals (others recently checked)`);

    for (const deal of toTest) {
      const url = deal.url;
      if (!url) continue;

      const { statusCode, finalUrl, body, error: fetchError } = await testLink(url);

      if (fetchError && statusCode === 0) {
        log.warn(`${deal.id}: network error — ${fetchError}`);
        stats.errors.push(`${deal.id}: ${fetchError}`);
        continue;
      }

      const result = buildTestResult(url, statusCode, finalUrl, body || '');
      await updateDeal(deal.id, result);
      await logTestResult(deal.id, url, statusCode, result.status);

      if (result.isWorking) {
        stats.ok++;
        log.ok(`${deal.id}: ${result.status} (${statusCode})`);
      } else {
        stats.broken++;
        log.warn(`${deal.id}: ${result.status} (${statusCode}) — ${result.reason}`);
      }
      stats.updated++;
    }

    log.ok(`Done — tested ${toTest.length} links. OK: ${stats.ok}, Broken: ${stats.broken}`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot69.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-69 crashed:', err); process.exit(1); });
}
