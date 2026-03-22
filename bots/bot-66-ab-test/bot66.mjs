// ════════════════════════════════════════════════════════════
// BOT-66 — A/B Test Manager
// תפקיד: מנהל A/B tests לכרטיסי דיל, CTAs, תצוגת מחיר.
//         מחשב conversion rates, statistical significance,
//         ומכריז על מנצח.
//
// לוגיקה:
//   1. קורא ab_tests פעילים
//   2. מאגד ab_events לפי variant
//   3. מחשב conversion rates + z-score
//   4. אם significant → מעדכן winner_variant + completed_at
//   5. מתעד ב-bots_log
//
// תדירות: כל יום 00:00 UTC (Railway cron: 0 0 * * *)
//
// Env vars:
//   SUPABASE_URL          — מ-Supabase
//   SUPABASE_SERVICE_KEY  — service role key
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-66';
const log    = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — export לבדיקות
// ════════════════════════════════════════════════════════════

/**
 * assignVariant — הקצאה דטרמיניסטית של variant לפי hash(userId+testId).
 * @param {string} userId
 * @param {string} testId
 * @param {string[]} variants
 * @returns {string}
 */
export function assignVariant(userId, testId, variants) {
  if (!variants || variants.length === 0) return 'control';

  // Simple deterministic hash: sum of char codes
  const str  = `${userId}:${testId}`;
  let   hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  return variants[hash % variants.length];
}

/**
 * computeConversionRate — conversions/clicks as percentage (0-100).
 * @param {number} clicks
 * @param {number} conversions
 * @returns {number}
 */
export function computeConversionRate(clicks, conversions) {
  if (!clicks || clicks <= 0) return 0;
  return (conversions / clicks) * 100;
}

/**
 * computeZScore — z-score סטטיסטי להשוואת שתי conversion rates.
 * Formula: (p1 - p2) / sqrt(p_pool * (1-p_pool) * (1/n1 + 1/n2))
 * @param {number} rateA — conversion rate % (0-100)
 * @param {number} rateB
 * @param {number} nA — sample size A
 * @param {number} nB — sample size B
 * @returns {number}
 */
export function computeZScore(rateA, rateB, nA, nB) {
  if (!nA || !nB || nA <= 0 || nB <= 0) return 0;

  const p1 = rateA / 100;
  const p2 = rateB / 100;

  // Pooled proportion
  const p_pool = (p1 * nA + p2 * nB) / (nA + nB);
  const variance = p_pool * (1 - p_pool) * (1 / nA + 1 / nB);

  if (variance <= 0) return 0;

  return (p1 - p2) / Math.sqrt(variance);
}

/**
 * isStatisticallySignificant — האם התוצאה מובהקת סטטיסטית?
 * |z| > 1.96 ← 95% confidence (alpha=0.05)
 * @param {number} zScore
 * @param {number} alpha — default 0.05
 * @returns {boolean}
 */
export function isStatisticallySignificant(zScore, alpha = 0.05) {
  // Two-tailed test
  const threshold = alpha <= 0.01 ? 2.576 : alpha <= 0.05 ? 1.96 : 1.645;
  return Math.abs(zScore) > threshold;
}

/**
 * declareWinner — מחזיר את ה-variant עם conversion rate הגבוה ביותר,
 * אם ההבדל מובהק סטטיסטית. מחזיר null אם לא מובהק.
 * @param {Array<{ name: string, clicks: number, conversions: number }>} variants
 * @returns {string|null}
 */
export function declareWinner(variants) {
  if (!variants || variants.length < 2) return null;

  // Compute rates
  const withRates = variants.map(v => ({
    ...v,
    rate: computeConversionRate(v.clicks, v.conversions),
  }));

  // Sort descending by rate
  const sorted = [...withRates].sort((a, b) => b.rate - a.rate);
  const best   = sorted[0];
  const second = sorted[1];

  // Check significance between best and second
  const z = computeZScore(best.rate, second.rate, best.clicks, second.clicks);

  if (!isStatisticallySignificant(z)) return null;

  // Also check minimum sample size
  if (best.clicks < 10 || second.clicks < 10) return null;

  return best.name;
}

/**
 * buildTestReport — מחזיר report מובנה לtest.
 * @param {{ id: string, test_name: string, status: string, min_sample_size: number }} test
 * @param {Array<{ name: string, clicks: number, conversions: number }>} results
 * @returns {{ testId: string, status: string, winner: string|null, variants: Array }}
 */
export function buildTestReport(test, results) {
  const variantsData = (results || []).map(v => ({
    name:        v.name,
    rate:        computeConversionRate(v.clicks, v.conversions),
    n:           v.clicks,
    conversions: v.conversions,
  }));

  const winner = declareWinner(results || []);

  return {
    testId:   test.id || test.test_name,
    testName: test.test_name || '',
    status:   winner ? 'completed' : 'running',
    winner,
    variants: variantsData,
  };
}

// ════════════════════════════════════════════════════════════
// bots_log
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
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchActiveTests() {
  const { data, error } = await supabase
    .from('ab_tests')
    .select('id, test_name, description, variants, status, winner_variant, started_at, min_sample_size')
    .eq('status', 'active');

  if (error) throw new Error(`fetchTests: ${error.message}`);
  return data || [];
}

async function aggregateEventsForTest(testId) {
  // Aggregate clicks and conversions per variant
  const { data: impressions } = await supabase
    .from('ab_events')
    .select('variant')
    .eq('test_id', testId)
    .eq('event_type', 'impression');

  const { data: clicks } = await supabase
    .from('ab_events')
    .select('variant')
    .eq('test_id', testId)
    .eq('event_type', 'click');

  const { data: conversions } = await supabase
    .from('ab_events')
    .select('variant')
    .eq('test_id', testId)
    .eq('event_type', 'conversion');

  // Count per variant
  const variantCounts = {};

  for (const row of (impressions || [])) {
    if (!variantCounts[row.variant]) variantCounts[row.variant] = { impressions: 0, clicks: 0, conversions: 0 };
    variantCounts[row.variant].impressions++;
  }
  for (const row of (clicks || [])) {
    if (!variantCounts[row.variant]) variantCounts[row.variant] = { impressions: 0, clicks: 0, conversions: 0 };
    variantCounts[row.variant].clicks++;
  }
  for (const row of (conversions || [])) {
    if (!variantCounts[row.variant]) variantCounts[row.variant] = { impressions: 0, clicks: 0, conversions: 0 };
    variantCounts[row.variant].conversions++;
  }

  return Object.entries(variantCounts).map(([name, counts]) => ({
    name,
    ...counts,
  }));
}

async function completeTest(testId, winnerVariant) {
  await supabase
    .from('ab_tests')
    .update({
      status:         'completed',
      winner_variant: winnerVariant,
      completed_at:   new Date().toISOString(),
    })
    .eq('id', testId);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`\ud83d\ude80 ${BOT_ID} — A/B Test Manager`);

  let logId;
  const stats = { updated: 0, completed: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const tests = await fetchActiveTests();
    log.log(`\ud83e\uddea ${tests.length} tests פעילים`);

    for (const test of tests) {
      try {
        const results = await aggregateEventsForTest(test.id);

        if (results.length === 0) {
          log.log(`\u23ed\ufe0f test "${test.test_name}": אין נתונים עדיין`);
          continue;
        }

        const report = buildTestReport(test, results);
        log.log(`\ud83d\udcca test "${test.test_name}": ${results.map(v => `${v.name}=${computeConversionRate(v.clicks, v.conversions).toFixed(1)}%`).join(', ')}`);

        if (report.winner) {
          await completeTest(test.id, report.winner);
          stats.completed++;
          stats.updated++;
          log.ok(`\ud83c\udfc6 מנצח: "${report.winner}" ב-test "${test.test_name}"`);
        } else {
          log.log(`\u23f3 test "${test.test_name}": אין מנצח מובהק עדיין`);
        }

      } catch (err) {
        log.warn(`\u26a0\ufe0f test ${test.id}: ${err.message}`);
        stats.errors.push(`test ${test.id}: ${err.message}`);
      }
    }

    log.log(`\u2705 סיום: ${stats.completed} tests הושלמו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot66.mjs');
if (isMain) {
  main().catch(err => { console.error('\u274c BOT-66 crashed:', err); process.exit(1); });
}
