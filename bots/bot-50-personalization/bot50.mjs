// ════════════════════════════════════════════════════════════
// BOT-50 — Personalization Engine
// תפקיד: לומד העדפות משתמש ומייצר feed מותאם אישית.
//
// לוגיקה:
//   1. מנתח היסטוריית קליקים לפי קטגוריה/חנות/מחיר
//   2. מעדכן user_preferences table
//   3. מחשב affinity scores לכל (user, category) + (user, store)
//   4. מייצר ordered deal IDs לfeed מותאם
//   5. שומר ב-personalized_feeds table
//   6. כותב ל-bots_log
//
// תדירות: כל 6 שעות (Railway cron: 0 */6 * * *)
//
// Env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID              = 'BOT-50';
export const CLICK_WINDOW_DAYS   = 30;   // ניתוח 30 יום אחרונים
const MAX_USERS_PER_RUN   = 100;
export const FEED_SIZE           = 50;   // מספר דילים ב-feed
export const MIN_CLICKS_FOR_PREFS = 3;   // מינימום קליקים לפני בניית פרופיל
const log                 = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * computeAffinityScore — מחשב ציון affinity לקטגוריה/חנות.
 * @param {number} clicks     — מספר קליקים בחלון הזמן
 * @param {number} totalClicks — סך קליקים של המשתמש
 * @param {number} recency    — ממוצע ימים מהקליק האחרון (0=עכשיו)
 * @returns {number} 0-100
 */
export function computeAffinityScore(clicks, totalClicks, recency) {
  if (totalClicks === 0 || clicks === 0) return 0;
  const frequency = clicks / totalClicks;             // 0-1
  const recencyFactor = Math.max(0, 1 - recency / 30); // newer = higher
  const score = (frequency * 0.7 + recencyFactor * 0.3) * 100;
  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * buildUserProfile — בונה פרופיל משתמש מרשימת קליקים.
 * @param {Array<{category:string, store_id:string, price:number, clicked_at:string}>} clicks
 * @returns {{ categories: Map<string,number>, stores: Map<string,number>, avgPrice: number, priceRange: string }}
 */
export function buildUserProfile(clicks) {
  if (!clicks || clicks.length === 0) {
    return { categories: new Map(), stores: new Map(), avgPrice: 0, priceRange: 'any' };
  }

  const now = Date.now();
  const categoryCounts = new Map();
  const storeCounts    = new Map();
  let totalPrice = 0;
  let priceCount = 0;

  for (const click of clicks) {
    // Category affinity
    if (click.category) {
      const cat = click.category;
      if (!categoryCounts.has(cat)) categoryCounts.set(cat, { clicks: 0, lastDays: 0 });
      const c = categoryCounts.get(cat);
      c.clicks++;
      c.lastDays = Math.min(c.lastDays || 999, (now - new Date(click.clicked_at).getTime()) / 86400000);
    }

    // Store affinity
    if (click.store_id) {
      const s = click.store_id;
      if (!storeCounts.has(s)) storeCounts.set(s, { clicks: 0, lastDays: 0 });
      const sc = storeCounts.get(s);
      sc.clicks++;
      sc.lastDays = Math.min(sc.lastDays || 999, (now - new Date(click.clicked_at).getTime()) / 86400000);
    }

    // Price tracking
    if (click.price && click.price > 0) {
      totalPrice += click.price;
      priceCount++;
    }
  }

  const avgPrice = priceCount > 0 ? Math.round(totalPrice / priceCount) : 0;
  const priceRange = classifyPriceRange(avgPrice);

  // Compute affinity scores
  const total = clicks.length;
  const categories = new Map();
  for (const [cat, data] of categoryCounts) {
    categories.set(cat, computeAffinityScore(data.clicks, total, data.lastDays || 0));
  }
  const stores = new Map();
  for (const [store, data] of storeCounts) {
    stores.set(store, computeAffinityScore(data.clicks, total, data.lastDays || 0));
  }

  return { categories, stores, avgPrice, priceRange };
}

/**
 * classifyPriceRange — מסווג טווח מחיר.
 * @param {number} avgPrice — USD
 * @returns {'budget'|'mid'|'premium'|'luxury'|'any'}
 */
export function classifyPriceRange(avgPrice) {
  if (avgPrice <= 0)    return 'any';
  if (avgPrice <= 25)   return 'budget';
  if (avgPrice <= 100)  return 'mid';
  if (avgPrice <= 500)  return 'premium';
  return 'luxury';
}

/**
 * rankDealsForUser — מדרג דילים לפי פרופיל משתמש.
 * @param {Array<{id:string, category:string, store_id:string, score:number, price:number}>} deals
 * @param {{ categories: Map, stores: Map, avgPrice: number }} profile
 * @returns {Array<{id:string, personalScore:number}>} ממוין מגבוה לנמוך
 */
export function rankDealsForUser(deals, profile) {
  return deals
    .map(deal => {
      const baseScore    = (deal.score || 50) / 100;
      const catAffinity  = (profile.categories?.get(deal.category) || 0) / 100;
      const storeAffinity = (profile.stores?.get(deal.store_id) || 0) / 100;

      // Price proximity bonus
      let priceBonus = 0;
      if (profile.avgPrice > 0 && deal.price > 0) {
        const ratio = Math.min(deal.price, profile.avgPrice) / Math.max(deal.price, profile.avgPrice);
        priceBonus = ratio * 0.1; // max 10% bonus
      }

      const personalScore = Math.round(
        (baseScore * 0.4 + catAffinity * 0.35 + storeAffinity * 0.15 + priceBonus) * 100
      );

      return { id: deal.id, personalScore };
    })
    .sort((a, b) => b.personalScore - a.personalScore);
}

/**
 * getTopCategories — מחזיר top N קטגוריות לפי affinity.
 * @param {Map<string,number>} categories
 * @param {number} n
 * @returns {string[]}
 */
export function getTopCategories(categories, n = 3) {
  return Array.from(categories.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([cat]) => cat);
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchActiveUsers() {
  const since = new Date(Date.now() - CLICK_WINDOW_DAYS * 86400000).toISOString();
  const { data, error } = await supabase
    .from('click_log')
    .select('user_id')
    .gte('clicked_at', since)
    .not('user_id', 'is', null)
    .order('clicked_at', { ascending: false })
    .limit(MAX_USERS_PER_RUN * 5);

  if (error) throw new Error(`fetchActiveUsers: ${error.message}`);

  // Unique user IDs
  const unique = [...new Set((data || []).map(r => r.user_id))].slice(0, MAX_USERS_PER_RUN);
  return unique;
}

async function fetchUserClicks(userId) {
  const since = new Date(Date.now() - CLICK_WINDOW_DAYS * 86400000).toISOString();
  const { data, error } = await supabase
    .from('click_log')
    .select('category, store_id, deal_id, clicked_at')
    .eq('user_id', userId)
    .gte('clicked_at', since)
    .order('clicked_at', { ascending: false })
    .limit(200);

  if (error) return [];
  return data || [];
}

async function fetchActiveDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, category, store_id, score, price')
    .eq('status', 'active')
    .order('score', { ascending: false })
    .limit(500);

  if (error) throw new Error(`fetchActiveDeals: ${error.message}`);
  return data || [];
}

async function upsertUserPreferences(userId, profile) {
  const topCats   = getTopCategories(profile.categories);
  const topStores = getTopCategories(profile.stores);

  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id:          userId,
      top_categories:   topCats,
      top_stores:       topStores,
      avg_price:        profile.avgPrice,
      price_range:      profile.priceRange,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) log.warn(`upsertUserPreferences(${userId}): ${error.message}`);
}

async function upsertPersonalizedFeed(userId, dealIds) {
  const { error } = await supabase
    .from('personalized_feeds')
    .upsert({
      user_id:    userId,
      deal_ids:   dealIds,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) log.warn(`upsertPersonalizedFeed(${userId}): ${error.message}`);
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
  log.log(`BOT-50 — Personalization Engine starting`);

  let logId;
  const stats = { updated: 0, skipped: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const [userIds, allDeals] = await Promise.all([
      fetchActiveUsers(),
      fetchActiveDeals(),
    ]);
    log.log(`Processing ${userIds.length} users with ${allDeals.length} active deals`);

    for (const userId of userIds) {
      try {
        const clicks = await fetchUserClicks(userId);

        if (clicks.length < MIN_CLICKS_FOR_PREFS) {
          stats.skipped++;
          continue;
        }

        const profile = buildUserProfile(clicks);
        await upsertUserPreferences(userId, profile);

        const ranked  = rankDealsForUser(allDeals, profile);
        const feedIds = ranked.slice(0, FEED_SIZE).map(d => d.id);
        await upsertPersonalizedFeed(userId, feedIds);

        stats.updated++;
        const topCats = getTopCategories(profile.categories);
        log.ok(`User ${userId}: ${clicks.length} clicks → top cats [${topCats.join(', ')}], feed ${feedIds.length} deals`);

      } catch (err) {
        log.warn(`User ${userId}: ${err.message}`);
        stats.errors.push(`${userId}: ${err.message}`);
      }
    }

    log.ok(`Done — updated ${stats.updated} feeds, skipped ${stats.skipped} users (low data)`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot50.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-50 crashed:', err); process.exit(1); });
}
