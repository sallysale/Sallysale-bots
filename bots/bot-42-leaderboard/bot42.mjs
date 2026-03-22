// ════════════════════════════════════════════════════════════
// BOT-42 — Leaderboard
// תפקיד: מייצר snapshots של leaderboard יומי (alltime / monthly / weekly).
//         שולף נתונים מ-user_points ו-points_transactions,
//         מחשב דירוג ושומר ל-leaderboard_snapshots.
//
// Schedule: כל יום 00:00 UTC
// Periods: alltime | monthly | weekly
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-42';
const log    = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * getPeriodStart — מחזיר תאריך התחלה לפריוד כ-ISO string.
 * @param {'alltime'|'monthly'|'weekly'} period
 * @param {Date} [now] — אופציונלי, ברירת מחדל new Date()
 * @returns {string} ISO date string 'YYYY-MM-DD'
 */
export function getPeriodStart(period, now = new Date()) {
  if (period === 'alltime') return '1970-01-01';

  if (period === 'monthly') {
    const year  = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }

  if (period === 'weekly') {
    // Monday UTC — day 0=Sun, 1=Mon, ..., 6=Sat
    const day = now.getUTCDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day; // כמה ימים אחורה עד לשני
    const monday = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + diff
    ));
    return monday.toISOString().slice(0, 10);
  }

  throw new Error(`period לא מוכר: ${period}`);
}

/**
 * filterByPeriod — מסנן transactions לפי period.
 * @param {Array<{user_id: string, points: number, created_at: string}>} transactions
 * @param {'alltime'|'monthly'|'weekly'} period
 * @param {Date} [now]
 * @returns {Array}
 */
export function filterByPeriod(transactions, period, now = new Date()) {
  if (!Array.isArray(transactions)) return [];
  const start = getPeriodStart(period, now);
  if (period === 'alltime') return [...transactions];
  return transactions.filter(tx => {
    if (!tx.created_at) return false;
    return tx.created_at >= start;
  });
}

/**
 * buildLeaderboard — ממיין לפי נקודות DESC ומחזיר top 100.
 * @param {Array<{user_id: string, total_points: number, tier: string}>} rows
 * @param {'alltime'|'monthly'|'weekly'} [period]
 * @returns {Array<{rank: number, user_id: string, total_points: number, tier: string}>}
 */
export function buildLeaderboard(rows, period = 'alltime') {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // מיון DESC לפי total_points
  const sorted = [...rows].sort((a, b) => (b.total_points || 0) - (a.total_points || 0));

  // top 100
  const top100 = sorted.slice(0, 100);

  // הוספת rank — ties מקבלים אותו rank
  let currentRank = 1;
  return top100.map((row, index) => {
    if (index > 0 && row.total_points < top100[index - 1].total_points) {
      currentRank = index + 1;
    }
    return formatLeaderboardEntry(row, currentRank, period);
  });
}

/**
 * formatLeaderboardEntry — עיצוב שורה אחת.
 * @param {{user_id: string, total_points: number, tier: string}} row
 * @param {number} rank
 * @param {'alltime'|'monthly'|'weekly'} [period]
 * @returns {{ rank: number, user_id: string, total_points: number, tier: string, period: string }}
 */
export function formatLeaderboardEntry(row, rank, period = 'alltime') {
  return {
    rank:         Number(rank),
    user_id:      row.user_id,
    total_points: Number(row.total_points) || 0,
    tier:         row.tier || 'hunter',
    period,
  };
}

/**
 * aggregateTransactionPoints — מחשב סכום נקודות לכל user מ-transactions.
 * @param {Array<{user_id: string, points: number}>} transactions
 * @returns {Map<string, number>} userId → totalPoints
 */
export function aggregateTransactionPoints(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    if (!tx.user_id) continue;
    const prev = map.get(tx.user_id) || 0;
    map.set(tx.user_id, prev + (Number(tx.points) || 0));
  }
  return map;
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
 * fetchAllTimeLeaderboard — שולף user_points ישירות.
 */
async function fetchAllTimeLeaderboard() {
  const { data, error } = await supabase
    .from('user_points')
    .select('user_id, total_points, tier')
    .order('total_points', { ascending: false })
    .limit(100);

  if (error) throw new Error(`fetchAllTimeLeaderboard: ${error.message}`);
  return data || [];
}

/**
 * fetchTransactions — שולף transactions מתאריך נתון.
 */
async function fetchTransactions(since) {
  const { data, error } = await supabase
    .from('points_transactions')
    .select('user_id, points, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`fetchTransactions: ${error.message}`);
  return data || [];
}

/**
 * fetchUserTiers — שולף tier לכל user_id.
 */
async function fetchUserTiers() {
  const { data, error } = await supabase
    .from('user_points')
    .select('user_id, tier');

  if (error) throw new Error(`fetchUserTiers: ${error.message}`);
  const map = new Map();
  for (const row of data || []) {
    map.set(row.user_id, row.tier || 'hunter');
  }
  return map;
}

/**
 * saveSnapshot — מוחק snapshot ישן ומכניס חדש.
 */
async function saveSnapshot(entries, period) {
  if (entries.length === 0) {
    log.warn(`saveSnapshot(${period}): no entries, skipping`);
    return 0;
  }

  const today = new Date().toISOString().slice(0, 10);

  // מחיקת snapshot ישן לאותו יום ופריוד
  const { error: delErr } = await supabase
    .from('leaderboard_snapshots')
    .delete()
    .eq('period', period)
    .eq('snapshot_date', today);

  if (delErr) log.warn(`deleteSnapshot(${period}): ${delErr.message}`);

  const rows = entries.map(e => ({
    period,
    rank:         e.rank,
    user_id:      e.user_id,
    total_points: e.total_points,
    tier:         e.tier,
    snapshot_date: today,
  }));

  // insert in batches of 200
  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('leaderboard_snapshots').insert(batch);
    if (error) throw new Error(`saveSnapshot insert(${period}): ${error.message}`);
    inserted += batch.length;
  }

  return inserted;
}

/**
 * buildPeriodLeaderboard — בונה leaderboard לפריוד מסויים.
 */
async function buildPeriodLeaderboard(period, tierMap) {
  if (period === 'alltime') {
    const rows = await fetchAllTimeLeaderboard();
    return buildLeaderboard(rows, 'alltime');
  }

  // monthly / weekly — צבירה מ-transactions
  const since = getPeriodStart(period);
  const transactions = await fetchTransactions(since);
  const pointsMap = aggregateTransactionPoints(transactions);

  if (pointsMap.size === 0) {
    log.warn(`buildPeriodLeaderboard(${period}): no transactions found since ${since}`);
    return [];
  }

  // בנה rows עם tier מ-tierMap
  const rows = [];
  for (const [userId, total] of pointsMap.entries()) {
    rows.push({
      user_id:      userId,
      total_points: total,
      tier:         tierMap.get(userId) || 'hunter',
    });
  }

  return buildLeaderboard(rows, period);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.ok('Starting — building leaderboard snapshots');
  const logId = await logStart();
  const stats  = { added: 0, updated: 0, errors: [] };

  try {
    // שולף tier map פעם אחת לכל הפריודים
    const tierMap = await fetchUserTiers();
    log.log(`Loaded ${tierMap.size} user tiers`);

    const PERIODS = ['alltime', 'monthly', 'weekly'];

    for (const period of PERIODS) {
      try {
        log.log(`Building ${period} leaderboard...`);
        const entries = await buildPeriodLeaderboard(period, tierMap);
        log.log(`${period}: ${entries.length} entries`);

        const saved = await saveSnapshot(entries, period);
        stats.added += saved;
        log.ok(`${period}: saved ${saved} rows`);
      } catch (err) {
        const msg = `${period}: ${err.message}`;
        log.err(msg);
        stats.errors.push(msg);
      }
    }

    log.ok(`Done — ${stats.added} total rows saved`);
  } catch (err) {
    log.err(err.message);
    stats.errors.push(err.message);
  }

  await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot42.mjs');
if (isMain) {
  main().catch(err => {
    console.error('BOT-42 crashed:', err);
    process.exit(1);
  });
}
