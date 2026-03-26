// ════════════════════════════════════════════════════════════
// BOT-48 — Review Aggregator
// תפקיד: מאסף ביקורות ממקורות חיצוניים ושומר ב-deal_reviews.
//
// לוגיקה:
//   1. שולף דילים פעילים שטרם נאספו ביקורות
//   2. מנסה לאסוף ביקורות מ-Amazon/Google Shopping/Open Review APIs
//   3. מנרמל ל-normalized_rating (0-5) ו-review_count
//   4. שומר ב-deal_reviews table
//   5. מעדכן deals: avg_rating, review_count, reviews_updated_at
//   6. כותב ל-bots_log
//
// תדירות: פעם ביום 03:00 UTC (Railway cron: 0 3 * * *)
//
// Env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
//   SCRAPERAPI_KEY — אופציונלי, לסקרייפינג Amazon
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID            = 'BOT-48';
const MAX_DEALS_PER_RUN = 200;
const log               = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/** מקורות ביקורות נתמכים */
export const REVIEW_SOURCES = ['amazon', 'google_shopping', 'trustpilot', 'manual'];

/**
 * normalizeRating — ממיר ציון למידה 0-5.
 * @param {number} rating  — הציון הגולמי
 * @param {number} maxScale — המקסימום של הסולם המקורי (ברירת מחדל: 5)
 * @returns {number} 0-5 with 1 decimal
 */
export function normalizeRating(rating, maxScale = 5) {
  if (typeof rating !== 'number' || isNaN(rating)) return 0;
  if (maxScale <= 0) return 0;
  const normalized = (rating / maxScale) * 5;
  return Math.round(Math.min(5, Math.max(0, normalized)) * 10) / 10;
}

/**
 * classifyRating — מסווג ציון ביקורת.
 * @param {number} rating — 0-5
 * @returns {'excellent'|'good'|'average'|'poor'|'no_data'}
 */
export function classifyRating(rating) {
  if (rating === 0) return 'no_data';
  if (rating >= 4.5) return 'excellent';
  if (rating >= 3.5) return 'good';
  if (rating >= 2.5) return 'average';
  return 'poor';
}

/**
 * mergeReviews — ממזג ביקורות ממספר מקורות לממוצע משוקלל.
 * @param {Array<{source:string, rating:number, count:number}>} reviews
 * @returns {{ avg_rating:number, total_count:number }}
 */
export function mergeReviews(reviews) {
  if (!reviews || reviews.length === 0) return { avg_rating: 0, total_count: 0 };

  const valid = reviews.filter(r => r.count > 0 && r.rating > 0);
  if (valid.length === 0) return { avg_rating: 0, total_count: 0 };

  const totalCount   = valid.reduce((sum, r) => sum + r.count, 0);
  const weightedSum  = valid.reduce((sum, r) => sum + r.rating * r.count, 0);
  const avgRating    = totalCount > 0 ? weightedSum / totalCount : 0;

  return {
    avg_rating:  Math.round(avgRating * 10) / 10,
    total_count: totalCount,
  };
}

/**
 * parseAmazonReviewBlock — מנתח HTML block של Amazon ביקורות.
 * לשימוש כשScraperAPI מחזיר HTML.
 * @param {string} html
 * @returns {{ rating:number, count:number }|null}
 */
export function parseAmazonReviewBlock(html) {
  if (!html || typeof html !== 'string') return null;

  // מחפש: "4.5 out of 5 stars"
  const ratingMatch = html.match(/(\d+\.?\d*)\s+out\s+of\s+5\s+stars/i);
  // מחפש: "1,234 global ratings" or "1234 ratings"
  const countMatch  = html.match(/([\d,]+)\s+(?:global\s+)?ratings/i);

  if (!ratingMatch) return null;

  const rating = parseFloat(ratingMatch[1]);
  const count  = countMatch
    ? parseInt(countMatch[1].replace(/,/g, ''), 10)
    : 0;

  return { rating: normalizeRating(rating, 5), count };
}

/**
 * buildReviewBadge — יוצר תגית תצוגה לביקורות.
 * @param {number} avgRating
 * @param {number} count
 * @returns {string}
 */
export function buildReviewBadge(avgRating, count) {
  if (avgRating === 0 || count === 0) return '';
  const stars  = '⭐'.repeat(Math.round(avgRating));
  const countStr = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  return `${stars} ${avgRating}/5 (${countStr})`;
}

/**
 * isValidReviewData — בדיקת תקינות נתוני ביקורת.
 * @param {{ rating:number, count:number, source:string }} review
 * @returns {boolean}
 */
export function isValidReviewData(review) {
  if (!review) return false;
  if (typeof review.rating !== 'number' || isNaN(review.rating)) return false;
  if (review.rating < 0 || review.rating > 5) return false;
  if (typeof review.count !== 'number' || review.count < 0) return false;
  if (!REVIEW_SOURCES.includes(review.source)) return false;
  return true;
}

/**
 * extractASINFromUrl — מחלץ ASIN מURL של Amazon.
 * @param {string} url
 * @returns {string|null}
 */
export function extractASINFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchDealsForReviews() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, product_url, asin')
    .eq('status', 'active')
    .or(`reviews_updated_at.is.null,reviews_updated_at.lt.${since}`)
    .order('created_at', { ascending: false })
    .limit(MAX_DEALS_PER_RUN);

  if (error) throw new Error(`fetchDealsForReviews: ${error.message}`);
  return data || [];
}

async function upsertReview(dealId, reviewData) {
  const { error } = await supabase
    .from('deal_reviews')
    .upsert({
      deal_id:    dealId,
      source:     reviewData.source,
      rating:     reviewData.rating,
      count:      reviewData.count,
      badge:      reviewData.badge || '',
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'deal_id,source' });

  if (error) log.warn(`upsertReview(${dealId}): ${error.message}`);
}

async function updateDealReviewSummary(dealId, avgRating, totalCount, badge) {
  const { error } = await supabase
    .from('deals')
    .update({
      avg_rating:          avgRating,
      review_count:        totalCount,
      review_badge:        badge,
      reviews_updated_at:  new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) log.warn(`updateDealReviewSummary(${dealId}): ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// Review fetching (stub — real implementation uses ScraperAPI)
// ════════════════════════════════════════════════════════════

async function fetchAmazonReviews(asin) {
  if (!asin || !process.env.SCRAPERAPI_KEY) return null;
  try {
    const url = `http://api.scraperapi.com?api_key=${process.env.SCRAPERAPI_KEY}&autoparse=true&url=https://www.amazon.com/dp/${asin}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json();

    const rating = parseFloat(data?.rating || data?.stars || 0);
    const count  = parseInt(String(data?.ratings_total || data?.review_count || 0).replace(/,/g, ''), 10);
    if (!rating) return null;

    return { source: 'amazon', rating: normalizeRating(rating, 5), count: count || 0 };
  } catch {
    return null;
  }
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
  log.log(`BOT-48 — Review Aggregator starting`);

  let logId;
  const stats = { updated: 0, reviews: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const deals = await fetchDealsForReviews();
    log.log(`Fetched ${deals.length} deals needing review data`);

    for (const deal of deals) {
      try {
        const collected = [];

        // Try Amazon if ASIN available
        const asin = deal.asin || extractASINFromUrl(deal.product_url);
        if (asin) {
          const amzReview = await fetchAmazonReviews(asin);
          if (amzReview && isValidReviewData(amzReview)) {
            collected.push(amzReview);
            await upsertReview(deal.id, {
              ...amzReview,
              badge: buildReviewBadge(amzReview.rating, amzReview.count),
            });
            stats.reviews++;
          }
        }

        // Compute merged summary
        const { avg_rating, total_count } = mergeReviews(collected);
        const badge = buildReviewBadge(avg_rating, total_count);

        await updateDealReviewSummary(deal.id, avg_rating, total_count, badge);
        stats.updated++;

        if (collected.length > 0) {
          log.ok(`Deal ${deal.id}: ${avg_rating}/5 from ${total_count} reviews (${collected.length} sources)`);
        }
      } catch (err) {
        log.warn(`Deal ${deal.id}: ${err.message}`);
        stats.errors.push(`${deal.id}: ${err.message}`);
      }
    }

    log.ok(`Done — updated ${stats.updated} deals, collected ${stats.reviews} reviews`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot48.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-48 crashed:', err); process.exit(1); });
}
