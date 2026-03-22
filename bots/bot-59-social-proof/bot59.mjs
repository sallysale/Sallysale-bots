// ════════════════════════════════════════════════════════════
// BOT-59 — Social Proof
// תפקיד: מייצר מחרוזות "23 people viewed in the last hour"
//         לכל דיל פעיל עם ציון >= 50.
//
// לוגיקה:
//   1. שולף דילים active עם score >= 50
//   2. שולף demand_stats לספירת קליקים אחרונים
//   3. מחשב view count ריאליסטי
//   4. מעדכן deals.social_proof_text, social_proof_updated_at
//   5. כותב לsocial_proof_log
//
// תדירות: כל 30 דקות (Railway cron: *30 * * * *)
//
// Env vars:
//   SUPABASE_URL         — מ-Supabase
//   SUPABASE_SERVICE_KEY — service role key
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID        = 'BOT-59';
const BATCH_SIZE    = 200;
const MIN_SCORE     = 50;
const VIEW_MULT     = 8;      // views ≈ clicks * 8
const VIEW_MIN      = 1;
const VIEW_MAX      = 999;
const BUYER_MIN     = 0;
const BUYER_MAX     = 200;
const BUYER_MULT    = 0.12;   // buyers ≈ clicks * 0.12

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — exported לטסטים
// ════════════════════════════════════════════════════════════

/**
 * seedRandom — PRNG פשוט מבוסס seed (mulberry32).
 * מחזיר float בין 0 ל-1.
 * @param {number} seed — מספר שלם
 * @returns {number} 0 ≤ n < 1
 */
export function seedRandom(seed) {
  // mulberry32
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const result = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return result;
}

/**
 * generateViewCount — מחשב view count ריאליסטי עם variance.
 * @param {number} base      — בסיס
 * @param {number} variance  — רוחב שינוי אקראי (±variance)
 * @param {number} seed      — seed לאקראיות דטרמיניסטית
 * @returns {number} integer >= base (לפחות 1)
 */
export function generateViewCount(base, variance, seed = 42) {
  const rnd    = seedRandom(seed);
  const delta  = Math.floor(rnd * (variance * 2 + 1)) - variance;
  const result = Math.max(1, Math.round(base + delta));
  return result;
}

/**
 * computeRecentViews — אומד views מתוך click data.
 * views ≈ clicks * multiplier
 * @param {number} clickCount7d
 * @param {number} multiplier  — default VIEW_MULT (8)
 * @returns {number} integer >= 0
 */
export function computeRecentViews(clickCount7d, multiplier = VIEW_MULT) {
  if (!clickCount7d || clickCount7d <= 0) return 0;
  return Math.round(clickCount7d * multiplier);
}

/**
 * formatSocialProof — מחרוזת תצוגה לviews.
 * @param {number} viewCount
 * @param {string} timeWindow — e.g. "the last hour"
 * @returns {string}
 */
export function formatSocialProof(viewCount, timeWindow = 'the last hour') {
  const n     = Math.max(1, Math.round(viewCount));
  const label = n === 1 ? 'person viewed this in' : 'people viewed this in';
  return `${n} ${label} ${timeWindow}`;
}

/**
 * formatRecentBuyers — מחרוזת לרוכשים.
 * @param {number} count
 * @returns {string}
 */
export function formatRecentBuyers(count) {
  const n = Math.max(0, Math.round(count));
  return `${n} bought this today`;
}

/**
 * shouldShowSocialProof — האם להציג social proof לדיל זה.
 * @param {object} deal — { score, status }
 * @returns {boolean}
 */
export function shouldShowSocialProof(deal) {
  if (!deal) return false;
  const score = typeof deal.score === 'number' ? deal.score : 0;
  return score >= MIN_SCORE && deal.status === 'active';
}

/**
 * clampCount — מגביל n בין min ל-max.
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampCount(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * computeSocialProofText — מחשב את ה-text המלא לדיל.
 * @param {object} deal      — { id, score, status }
 * @param {number} clicks7d  — קליקים ב-7 ימים אחרונים
 * @returns {string|null}
 */
export function computeSocialProofText(deal, clicks7d = 0) {
  if (!shouldShowSocialProof(deal)) return null;

  // seed מבוסס id של הדיל — אקראי אבל דטרמיניסטי לאותו דיל
  const seed     = hashSeed(String(deal.id || ''));
  const rawViews = computeRecentViews(clicks7d);

  let views;
  if (rawViews > 0) {
    // יש נתוני קליקים אמיתיים — הוסף variance קטן
    views = generateViewCount(rawViews, Math.max(2, Math.floor(rawViews * 0.15)), seed);
  } else {
    // אין נתונים — בנה על פי score (score 50-100 → views 5-80)
    const baseViews = Math.floor(((deal.score - 50) / 50) * 75 + 5);
    views           = generateViewCount(baseViews, Math.floor(baseViews * 0.3), seed);
  }

  views = clampCount(views, VIEW_MIN, VIEW_MAX);
  return formatSocialProof(views);
}

/**
 * hashSeed — ממיר string ל-seed מספרי.
 * @param {string} str
 * @returns {number}
 */
export function hashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ════════════════════════════════════════════════════════════
// bots_log helpers
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
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
// פונקציות DB
// ════════════════════════════════════════════════════════════

/**
 * fetchQualifyingDeals — דילים active עם score >= MIN_SCORE.
 */
async function fetchQualifyingDeals(offset) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, score, status, social_proof_updated_at')
    .eq('status', 'active')
    .gte('score', MIN_SCORE)
    .range(offset, offset + BATCH_SIZE - 1)
    .order('score', { ascending: false });

  if (error) throw new Error(`fetchQualifyingDeals: ${error.message}`);
  return data || [];
}

/**
 * fetchDemandStats — שולף click counts מ-7 ימים אחרונים.
 * @param {string[]} dealIds
 * @returns {Map<string, number>}  dealId → clicks7d
 */
async function fetchDemandStats(dealIds) {
  if (!dealIds.length) return new Map();

  const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString();

  const { data, error } = await supabase
    .from('click_log')
    .select('deal_id')
    .in('deal_id', dealIds)
    .gte('clicked_at', cutoff);

  if (error) {
    // click_log לא קיים עדיין — לא בעיה
    log.warn('fetchDemandStats error (possibly table not found):', error.message);
    return new Map();
  }

  const map = new Map();
  for (const row of (data || [])) {
    map.set(row.deal_id, (map.get(row.deal_id) || 0) + 1);
  }
  return map;
}

/**
 * updateDealSocialProof — מעדכן social_proof_text על דיל.
 */
async function updateDealSocialProof(dealId, text) {
  const { error } = await supabase
    .from('deals')
    .update({
      social_proof_text:       text,
      social_proof_updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) throw new Error(`updateDealSocialProof(${dealId}): ${error.message}`);
}

/**
 * insertSocialProofLog — כותב לlog.
 */
async function insertSocialProofLog(dealId, viewCount, buyerCount) {
  const { error } = await supabase
    .from('social_proof_log')
    .insert({
      deal_id:     dealId,
      view_count:  viewCount,
      buyer_count: buyerCount,
    });
  if (error) log.warn(`insertSocialProofLog error: ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// Main runner
// ════════════════════════════════════════════════════════════

export async function run() {
  log.info('Starting BOT-59 Social Proof...');
  const logId = await logStart();

  const stats = {
    updated: 0,
    skipped: 0,
    errors:  [],
  };

  try {
    let offset  = 0;
    let hasMore = true;

    while (hasMore) {
      let deals;
      try {
        deals = await fetchQualifyingDeals(offset);
      } catch (e) {
        stats.errors.push(e.message);
        break;
      }

      if (!deals.length) { hasMore = false; break; }

      // שלוף demand stats לכל הdealIds בbatch
      const dealIds   = deals.map(d => d.id);
      const clicksMap = await fetchDemandStats(dealIds);

      for (const deal of deals) {
        try {
          const clicks7d = clicksMap.get(deal.id) || 0;
          const text     = computeSocialProofText(deal, clicks7d);

          if (!text) { stats.skipped++; continue; }

          await updateDealSocialProof(deal.id, text);

          // חשב buyer count לlog (לא מוצג כרגע, אבל נשמר)
          const buyerCount = clampCount(
            Math.round(clicks7d * BUYER_MULT),
            BUYER_MIN,
            BUYER_MAX,
          );
          await insertSocialProofLog(deal.id, 0, buyerCount);

          stats.updated++;
        } catch (e) {
          stats.errors.push(e.message);
        }
      }

      offset += BATCH_SIZE;
      if (deals.length < BATCH_SIZE) hasMore = false;
    }

  } catch (err) {
    stats.errors.push(err.message);
    log.error('Fatal error:', err.message);
  }

  log.info(`Done — updated=${stats.updated}, skipped=${stats.skipped}, errors=${stats.errors.length}`);
  await logFinish(logId, stats);
  return stats;
}

// ── Entry point ──
if (process.argv[1] && process.argv[1].endsWith('bot59.mjs')) {
  run().catch(err => {
    console.error('BOT-59 fatal:', err);
    process.exit(1);
  });
}
