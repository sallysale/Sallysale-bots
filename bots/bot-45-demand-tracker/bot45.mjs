// ════════════════════════════════════════════════════════════
// BOT-45 — Demand Tracker
// תפקיד: עוקב אחר ביקוש לפי דיל וקטגוריה.
//         קורא מ-click_log (BOT-38), מצרף לפי deal_id,
//         מחשב trend score 0-100 ושומר ל-demand_stats.
//
// Schedule: כל 6 שעות
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-45';
const log    = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * aggregateByDeal — מצרף קליקים לפי deal_id, ממיין DESC.
 * @param {Array<{deal_id: string, clicked_at?: string}>} clicks
 * @returns {Array<{deal_id: string, count: number}>}
 */
export function aggregateByDeal(clicks) {
  if (!Array.isArray(clicks) || clicks.length === 0) return [];

  const counts = new Map();
  for (const c of clicks) {
    if (!c.deal_id) continue;
    counts.set(c.deal_id, (counts.get(c.deal_id) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([deal_id, count]) => ({ deal_id, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * aggregateByCategory — מצרף קליקים לפי קטגוריה.
 * @param {Map<string, string>|Array<{id: string, category: string}>} deals
 *   — מפה deal_id→category, או מערך deals
 * @param {Array<{deal_id: string}>} clicks
 * @returns {Array<{category: string, count: number}>}
 */
export function aggregateByCategory(deals, clicks) {
  if (!Array.isArray(clicks) || clicks.length === 0) return [];

  // נורמליזציה: תמיכה ב-Map וב-Array
  let categoryMap;
  if (deals instanceof Map) {
    categoryMap = deals;
  } else if (Array.isArray(deals)) {
    categoryMap = new Map();
    for (const d of deals) {
      if (d.id) categoryMap.set(d.id, d.category || 'unknown');
    }
  } else {
    categoryMap = new Map();
  }

  const counts = new Map();
  for (const c of clicks) {
    if (!c.deal_id) continue;
    const cat = categoryMap.get(c.deal_id) || 'unknown';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * computeTrendScore — יחס בין ביקוש אחרון (7 ימים) להיסטורי (30 ימים).
 * @param {number} recent   — קליקים 7 ימים אחרונים
 * @param {number} historical — קליקים 30 ימים אחרונים (כולל recent)
 * @returns {number} raw score (לא מוגבל)
 */
export function computeTrendScore(recent, historical) {
  const r = Number(recent)     || 0;
  const h = Number(historical) || 0;

  if (r === 0 && h === 0) return 0;

  // אם אין היסטוריה — מחזיר את recent כ-score raw
  if (h === 0) return r;

  // expected recent based on uniform distribution over 30 days:
  // expected = h * (7/30)
  // trend = r / expected = r * 30 / (h * 7)
  const expected = h * (7 / 30);
  return (r / expected) * 50; // *50 כדי לקבל range סביר לפני clamp
}

/**
 * normalizeTrendScore — clamp ל-0..100.
 * @param {number} score
 * @returns {number} integer 0-100
 */
export function normalizeTrendScore(score) {
  const s = Number(score) || 0;
  return Math.min(100, Math.max(0, Math.round(s)));
}

/**
 * rankItems — ממיין לפי key DESC ומוסיף rank.
 * @param {Array<object>} items
 * @param {string} key — שם השדה למיון
 * @returns {Array<object & {rank: number}>}
 */
export function rankItems(items, key) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const sorted = [...items].sort((a, b) => (b[key] || 0) - (a[key] || 0));

  let currentRank = 1;
  return sorted.map((item, index) => {
    if (index > 0 && (item[key] || 0) < (sorted[index - 1][key] || 0)) {
      currentRank = index + 1;
    }
    return { ...item, rank: currentRank };
  });
}

/**
 * buildDemandStats — בונה שורות demand_stats מנתוני קליקים.
 * @param {Array<{deal_id: string, clicked_at: string}>} clicks7d
 * @param {Array<{deal_id: string, clicked_at: string}>} clicks30d
 * @param {Map<string, string>} categoryMap — deal_id → category
 * @returns {Array<{deal_id, category, click_count_7d, click_count_30d, trend_score}>}
 */
export function buildDemandStats(clicks7d, clicks30d, categoryMap) {
  const agg7d  = aggregateByDeal(clicks7d);
  const agg30d = aggregateByDeal(clicks30d);

  // map deal_id → count30d
  const map30d = new Map(agg30d.map(r => [r.deal_id, r.count]));
  // map deal_id → count7d
  const map7d  = new Map(agg7d.map(r => [r.deal_id, r.count]));

  // union of all deal_ids
  const allDeals = new Set([...map7d.keys(), ...map30d.keys()]);

  const rows = [];
  for (const dealId of allDeals) {
    const count7d  = map7d.get(dealId)  || 0;
    const count30d = map30d.get(dealId) || 0;
    const raw      = computeTrendScore(count7d, count30d);
    const trend    = normalizeTrendScore(raw);
    const category = categoryMap instanceof Map
      ? (categoryMap.get(dealId) || 'unknown')
      : 'unknown';

    rows.push({
      deal_id:        dealId,
      category,
      click_count_7d: count7d,
      click_count_30d: count30d,
      trend_score:    trend,
    });
  }

  return rows;
}

// ════════════════════════════════════════════════════════════
// DB functions
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) log.warn(`logStart: ${error.message}`);
  return data?.id;
}

async function logFinish(id, stats) {
  if (!id) return;
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_added:   stats.added   || 0,
    deals_updated: stats.updated || 0,
    errors:        stats.errors  || [],
  }).eq('id', id);
}

/**
 * fetchClicks — שולף קליקים מ-click_log מתאריך נתון.
 */
async function fetchClicks(since) {
  const { data, error } = await supabase
    .from('click_log')
    .select('deal_id, clicked_at')
    .gte('clicked_at', since)
    .not('deal_id', 'is', null);

  if (error) throw new Error(`fetchClicks: ${error.message}`);
  return data || [];
}

/**
 * fetchDealCategories — שולף deal_id + category מ-deals.
 */
async function fetchDealCategories() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, category')
    .not('category', 'is', null);

  if (error) throw new Error(`fetchDealCategories: ${error.message}`);
  const map = new Map();
  for (const d of data || []) {
    map.set(d.id, d.category || 'unknown');
  }
  return map;
}

/**
 * upsertDemandStats — upsert ל-demand_stats + עדכון deals.demand_score.
 */
async function upsertDemandStats(rows) {
  if (rows.length === 0) return 0;

  const BATCH = 200;
  let upserted = 0;

  // חישוב rank גלובלי
  const ranked = rankItems(rows, 'trend_score');

  // חישוב rank לפי קטגוריה
  const byCategory = new Map();
  for (const r of ranked) {
    const cat = r.category || 'unknown';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(r);
  }

  const rankMap = new Map(ranked.map(r => [r.deal_id, r.rank]));
  const catRankMap = new Map();
  for (const [cat, items] of byCategory.entries()) {
    const catRanked = rankItems(items, 'trend_score');
    for (const item of catRanked) {
      catRankMap.set(item.deal_id, item.rank);
    }
  }

  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => ({
      deal_id:         r.deal_id,
      category:        r.category,
      click_count_7d:  r.click_count_7d,
      click_count_30d: r.click_count_30d,
      trend_score:     r.trend_score,
      rank_global:     rankMap.get(r.deal_id) || null,
      rank_category:   catRankMap.get(r.deal_id) || null,
      updated_at:      now,
    }));

    const { error } = await supabase
      .from('demand_stats')
      .upsert(batch, { onConflict: 'deal_id' });

    if (error) throw new Error(`upsertDemandStats: ${error.message}`);
    upserted += batch.length;
  }

  // עדכן deals.demand_score עבור השורות האחרונות
  for (const r of rows) {
    await supabase
      .from('deals')
      .update({ demand_score: r.trend_score, demand_updated_at: now })
      .eq('id', r.deal_id);
  }

  return upserted;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.ok('Starting — tracking demand');
  const logId = await logStart();
  const stats  = { added: 0, updated: 0, errors: [] };

  try {
    const now     = new Date();
    const ago7d   = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const ago30d  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    log.log('Fetching clicks (7d and 30d)...');
    const [clicks7d, clicks30d] = await Promise.all([
      fetchClicks(ago7d),
      fetchClicks(ago30d),
    ]);
    log.log(`clicks 7d: ${clicks7d.length}, 30d: ${clicks30d.length}`);

    if (clicks30d.length === 0) {
      log.warn('No clicks in last 30 days — nothing to do');
      await logFinish(logId, stats);
      return stats;
    }

    log.log('Fetching deal categories...');
    const categoryMap = await fetchDealCategories();
    log.log(`Loaded ${categoryMap.size} deal categories`);

    const rows = buildDemandStats(clicks7d, clicks30d, categoryMap);
    log.log(`Built ${rows.length} demand_stats rows`);

    const upserted = await upsertDemandStats(rows);
    stats.updated = upserted;

    log.ok(`Done — upserted ${upserted} demand_stats rows`);
  } catch (err) {
    log.err(err.message);
    stats.errors.push(err.message);
  }

  await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot45.mjs');
if (isMain) {
  main().catch(err => {
    console.error('BOT-45 crashed:', err);
    process.exit(1);
  });
}
