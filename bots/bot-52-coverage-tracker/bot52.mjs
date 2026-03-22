// ════════════════════════════════════════════════════════════
// BOT-52 — Coverage Tracker
// תפקיד: מדווח על קטגוריות עם מעט דילים ומייצר דו"ח כיסוי.
//
// לוגיקה:
//   1. סופר דילים פעילים לפי קטגוריה
//   2. מחשב ציון כיסוי (0-100) לכל קטגוריה
//   3. מזהה קטגוריות "חלשות" (פחות מ-MIN_DEALS_THRESHOLD)
//   4. שומר ב-coverage_report table
//   5. כותב ל-bots_log
//
// תדירות: פעם ביום 05:00 UTC (Railway cron: 0 5 * * *)
//
// Env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-52';
const log    = createLogger(BOT_ID);

export const MIN_DEALS_THRESHOLD = 100;   // פחות מ-100 דילים = קטגוריה חלשה
export const TARGET_DEALS        = 1000;  // מטרה לקטגוריה בריאה
export const WEAK_SCORE_THRESHOLD = 30;   // ציון כיסוי מתחת ל-30 = urgent

// ════════════════════════════════════════════════════════════
// קטגוריות מוגדרות
// ════════════════════════════════════════════════════════════

export const EXPECTED_CATEGORIES = [
  'fashion', 'electronics', 'home', 'beauty', 'sports',
  'kids', 'food', 'health', 'travel_accessories', 'automotive',
];

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * computeCoverageScore — ציון כיסוי לקטגוריה (0-100).
 * @param {number} dealCount   — מספר דילים נוכחי
 * @param {number} target      — מספר דילים מטרה
 * @returns {number} 0-100
 */
export function computeCoverageScore(dealCount, target = TARGET_DEALS) {
  if (target <= 0) return 0;
  return Math.round(Math.min(100, (dealCount / target) * 100));
}

/**
 * classifyCoverage — מסווג רמת כיסוי.
 * @param {number} score — 0-100
 * @returns {'excellent'|'good'|'weak'|'critical'|'missing'}
 */
export function classifyCoverage(score) {
  if (score >= 80) return 'excellent';
  if (score >= 50) return 'good';
  if (score >= 30) return 'weak';
  if (score > 0)   return 'critical';
  return 'missing';
}

/**
 * detectWeakCategories — מזהה קטגוריות שצריכות תשומת לב.
 * @param {Array<{category:string, count:number}>} categoryCounts
 * @param {number} threshold
 * @returns {Array<{category:string, count:number, score:number, status:string}>}
 */
export function detectWeakCategories(categoryCounts, threshold = MIN_DEALS_THRESHOLD) {
  return categoryCounts
    .filter(c => c.count < threshold)
    .map(c => ({
      category: c.category,
      count:    c.count,
      score:    computeCoverageScore(c.count),
      status:   classifyCoverage(computeCoverageScore(c.count)),
    }))
    .sort((a, b) => a.count - b.count); // אלה עם הכי מעט ראשון
}

/**
 * detectMissingCategories — קטגוריות שלא מופיעות בכלל.
 * @param {string[]} existingCategories
 * @param {string[]} expected
 * @returns {string[]}
 */
export function detectMissingCategories(existingCategories, expected = EXPECTED_CATEGORIES) {
  const existing = new Set(existingCategories.map(c => c.toLowerCase()));
  return expected.filter(c => !existing.has(c.toLowerCase()));
}

/**
 * buildCoverageReport — מייצר דו"ח כיסוי מלא.
 * @param {Array<{category:string, count:number}>} categoryCounts
 * @returns {{ summary: object, weak: Array, missing: string[], overall_score: number }}
 */
export function buildCoverageReport(categoryCounts) {
  const totalDeals  = categoryCounts.reduce((sum, c) => sum + c.count, 0);
  const totalCats   = categoryCounts.length;
  const weak        = detectWeakCategories(categoryCounts);
  const existing    = categoryCounts.map(c => c.category);
  const missing     = detectMissingCategories(existing);

  // Overall coverage score — average of all expected categories
  const allScores = EXPECTED_CATEGORIES.map(cat => {
    const found = categoryCounts.find(c => c.category.toLowerCase() === cat.toLowerCase());
    return computeCoverageScore(found?.count || 0);
  });
  const overallScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);

  return {
    summary: {
      total_deals:  totalDeals,
      total_cats:   totalCats,
      weak_count:   weak.length,
      missing_count: missing.length,
    },
    weak,
    missing,
    overall_score: overallScore,
    generated_at:  new Date().toISOString(),
  };
}

/**
 * prioritizeCategories — מדרג קטגוריות לפי עדיפות לחיזוק.
 * @param {Array<{category:string, count:number, score:number}>} weak
 * @returns {Array} — ממוין לפי דחיפות
 */
export function prioritizeCategories(weak) {
  return [...weak].sort((a, b) => {
    // Lower score = higher priority
    if (a.score !== b.score) return a.score - b.score;
    return a.count - b.count;
  });
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchCategoryCounts() {
  const { data, error } = await supabase
    .from('deals')
    .select('category')
    .eq('status', 'active')
    .not('category', 'is', null);

  if (error) throw new Error(`fetchCategoryCounts: ${error.message}`);

  const counts = {};
  for (const row of (data || [])) {
    const cat = (row.category || 'unknown').toLowerCase();
    counts[cat] = (counts[cat] || 0) + 1;
  }

  return Object.entries(counts).map(([category, count]) => ({ category, count }));
}

async function saveCoverageReport(report) {
  const { error } = await supabase
    .from('coverage_report')
    .insert({
      overall_score:  report.overall_score,
      total_deals:    report.summary.total_deals,
      total_cats:     report.summary.total_cats,
      weak_count:     report.summary.weak_count,
      missing_count:  report.summary.missing_count,
      weak_categories: report.weak,
      missing_categories: report.missing,
      generated_at:   report.generated_at,
    });

  if (error) log.warn(`saveCoverageReport: ${error.message}`);
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
    deals_updated: 0,
    errors:        stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-52 — Coverage Tracker starting`);

  let logId;
  const stats = { errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const categoryCounts = await fetchCategoryCounts();
    log.log(`Found ${categoryCounts.length} categories with active deals`);

    const report = buildCoverageReport(categoryCounts);
    await saveCoverageReport(report);

    const prioritized = prioritizeCategories(report.weak);

    log.ok(`Coverage report:`);
    log.ok(`  Overall score: ${report.overall_score}/100`);
    log.ok(`  Total deals: ${report.summary.total_deals} across ${report.summary.total_cats} categories`);
    log.ok(`  Weak categories (${report.weak.length}): ${report.weak.map(w => `${w.category}(${w.count})`).join(', ')}`);
    log.ok(`  Missing categories (${report.missing.length}): ${report.missing.join(', ')}`);

    if (prioritized.length > 0) {
      log.ok(`  Top priority to fill: ${prioritized.slice(0, 3).map(c => c.category).join(', ')}`);
    }

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot52.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-52 crashed:', err); process.exit(1); });
}
