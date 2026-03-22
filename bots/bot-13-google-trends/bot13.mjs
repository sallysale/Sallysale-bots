// ════════════════════════════════════════════════════════════
// BOT-13 — Google Trends
// תפקיד: מזהה מגמות חיפוש שקשורות לסיילים/מוצרים,
//         מעדכן score של דילים קיימים, ומסמן מגמות.
//
// API: Google Trends JSON (unofficial, no key required)
// endpoints: /dailytrends + /realtimetrends
// תדירות: פעמיים ביום (Railway cron: 0 */12 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-13';

// ── קונפיגורציה ────────────────────────────────────────────

const DELAY_MS   = 2000;
const GEO_CODES  = ['US', 'IL', 'GB', 'DE'];

// מילים שמעידות על רלוונטיות לשוק SallySale
const SHOPPING_KEYWORDS = [
  'sale', 'deal', 'discount', 'clearance', 'offer', 'coupon', 'promo',
  'black friday', 'cyber monday', 'prime day', 'buy', 'shop', 'store',
  'fashion', 'clothing', 'shoe', 'electronic', 'gadget', 'phone', 'laptop',
  'home', 'kitchen', 'furniture', 'beauty', 'skincare', 'makeup',
  'toy', 'game', 'sport', 'fitness',
];

// ── בדיקת רלוונטיות ────────────────────────────────────────

/**
 * בודק אם מילת מגמה רלוונטית לחנות/קנייה.
 * @param {string} keyword
 * @returns {boolean}
 */
export function isTrendingKeywordRelevant(keyword) {
  if (!keyword) return false;
  const kw = keyword.toLowerCase();
  return SHOPPING_KEYWORDS.some(sk => kw.includes(sk));
}

/**
 * מחלץ מילות מגמה קשורות לקנייה ממערך trends.
 * @param {Array<{title: string, traffic?: string}>} trends
 * @returns {string[]}
 */
export function extractShoppingKeywords(trends) {
  if (!Array.isArray(trends)) return [];
  return trends
    .map(t => t.title || t.query || t.term || '')
    .filter(Boolean)
    .filter(isTrendingKeywordRelevant);
}

/**
 * ממיר מחרוזת traffic ("500K+") למספר.
 * @param {string} trafficStr
 * @returns {number}
 */
export function parseTrafficNumber(trafficStr) {
  if (!trafficStr) return 0;
  const s = String(trafficStr).toUpperCase().trim();
  if (s.includes('M')) return parseFloat(s) * 1_000_000;
  if (s.includes('K')) return parseFloat(s) * 1_000;
  return parseFloat(s) || 0;
}

/**
 * בונה URL ל-Google Trends Daily Trends API.
 * @param {string} geo — קוד מדינה (US, IL, ...)
 * @returns {string}
 */
export function buildDailyTrendsUrl(geo = 'US') {
  const params = new URLSearchParams({
    hl:  'en-US',
    tz:  '-60',
    geo,
    ns:  '15',
  });
  return `https://trends.google.com/trends/api/dailytrends?${params}`;
}

/**
 * בונה URL ל-Google Trends Realtime API.
 * @param {string} geo
 * @returns {string}
 */
export function buildRealtimeTrendsUrl(geo = 'US') {
  const params = new URLSearchParams({
    hl:   'en-US',
    tz:   '-60',
    cat:  'all',
    geo,
    fi:   '0',
    fs:   '0',
    ri:   '300',
    rs:   '20',
    sort: '0',
  });
  return `https://trends.google.com/trends/api/realtimetrends?${params}`;
}

// ── parseTrendsResponse ─────────────────────────────────────

/**
 * פורס תגובת Google Trends (מסיר prefix ")]}'," שGoogle מוסיף).
 * @param {string} text — גוף תגובה גולמי
 * @returns {object|null}
 */
export function parseTrendsResponse(text) {
  if (!text) return null;
  try {
    // Google מוסיף ")]}',\n" בתחילת כל תגובה
    const cleaned = text.replace(/^\)\]\}',?\s*/, '');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * מחלץ מערך trending articles מתגובת dailytrends.
 * @param {object} data
 * @returns {Array<{title: string, traffic: string}>}
 */
export function extractDailyTrends(data) {
  if (!data) return [];
  const days = data?.default?.trendingSearchesDays || [];
  const results = [];
  for (const day of days) {
    for (const item of (day.trendingSearches || [])) {
      results.push({
        title:   item.title?.query || '',
        traffic: item.formattedTraffic || '0',
        articles: (item.articles || []).map(a => a.title).slice(0, 2),
      });
    }
  }
  return results;
}

// ── bots_log helpers ────────────────────────────────────────

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id').single();
  if (error) throw new Error(`logStart: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats, status = 'done') {
  await supabase.from('bots_log').update({
    finished_at: new Date().toISOString(), status,
    deals_added: stats.added, deals_updated: stats.updated, errors: stats.errors,
  }).eq('id', logId);
}

// ── קריאה ל-Google Trends ───────────────────────────────────

export async function fetchDailyTrends(geo = 'US') {
  const url = buildDailyTrendsUrl(geo);
  const res = await fetch(url, {
    headers: { 'Accept': 'text/plain', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google Trends HTTP ${res.status}`);
  const text = await res.text();
  const data = parseTrendsResponse(text);
  return extractDailyTrends(data);
}

// ── boost deals לפי מגמה ────────────────────────────────────

/**
 * מגביר score של דילים שמכילים מילות מגמה.
 * @param {string[]} keywords — מילות מגמה רלוונטיות
 * @param {object}   logger
 * @returns {number} כמה דילים עודכנו
 */
async function boostTrendingDeals(keywords, logger) {
  if (!keywords.length) return 0;
  let boosted = 0;
  for (const kw of keywords.slice(0, 10)) {
    try {
      const { data: deals } = await supabase
        .from('deals')
        .select('id, score, tags')
        .ilike('title_en', `%${kw}%`)
        .eq('status', 'active')
        .limit(20);

      if (!deals?.length) continue;

      for (const deal of deals) {
        const newScore  = Math.min(100, (deal.score || 50) + 5);
        const newTags   = Array.from(new Set([...(deal.tags || []), 'trending']));
        await supabase.from('deals')
          .update({ score: newScore, tags: newTags })
          .eq('id', deal.id);
        boosted++;
      }
    } catch (e) {
      logger.err(`boost error for "${kw}": ${e.message}`);
    }
  }
  return boosted;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── main ───────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-13 Google Trends — מתחיל ===');

  let logId;
  try { logId = await logStart(); } catch (e) { logger.err(`bots_log: ${e.message}`); }
  const stats = { added: 0, updated: 0, errors: [] };

  try {
    const allKeywords = new Set();

    for (const geo of GEO_CODES) {
      logger.log(`מביא מגמות עבור: ${geo}`);
      let trends;
      try {
        trends = await fetchDailyTrends(geo);
      } catch (e) {
        logger.err(`שגיאה ב-${geo}: ${e.message}`);
        stats.errors.push(e.message);
        await sleep(DELAY_MS);
        continue;
      }

      const keywords = extractShoppingKeywords(trends);
      logger.log(`  ${trends.length} מגמות, ${keywords.length} רלוונטיות לשוק`);
      keywords.forEach(kw => allKeywords.add(kw));
      await sleep(DELAY_MS);
    }

    logger.log(`סה"כ מילות מגמה: ${allKeywords.size}`);

    const boosted = await boostTrendingDeals([...allKeywords], logger);
    stats.updated = boosted;

    logger.ok(`עודכנו ${boosted} דילים עם tag "trending"`);
    logger.ok(`=== BOT-13 סיים — ${logger.elapsed()} ===`);
  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, stats.errors.length > 0 ? 'error' : 'done');
  }
}

const isMain = process.argv[1]?.endsWith('bot13.mjs') || process.argv[1]?.endsWith('bot13');
if (isMain) main();
