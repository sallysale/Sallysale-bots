// ════════════════════════════════════════════════════════════
// BOT-41 — Sally Points
// תפקיד: מנהל מערכת נקודות נאמנות.
//         פועל on-demand (מופעל מ-API endpoint או webhook).
//
// פעולות ונקודות:
//   register         → 100
//   daily_login      → 10
//   deal_submit      → 50
//   deal_liked_10    → 200   (דיל קיבל 10+ לייקים)
//   referral         → 200   (הפניית חבר)
//   wishlist_fulfilled → 300 (פריט ב-wishlist הוזל)
//
// רמות:
//   Hunter    0–499     🏹
//   Deal Pro  500–1999  ⭐
//   Deal King 2000–4999 👑
//   Elite     5000+     💎
//
// טבלאות: user_points, points_transactions, user_tiers
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-41';
const log    = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// קונפיגורציה — נקודות לפי פעולה
// ════════════════════════════════════════════════════════════

export const POINTS_CONFIG = {
  register:           100,
  daily_login:        10,
  deal_submit:        50,
  deal_liked_10:      200,
  referral:           200,
  wishlist_fulfilled: 300,
};

// ════════════════════════════════════════════════════════════
// רמות (mirror של DB — לחישוב מקומי בטסטים)
// ════════════════════════════════════════════════════════════

export const TIERS = [
  { tier: 'elite',     label: '💎 Elite',   minPoints: 5000, maxPoints: Infinity, badge: '💎' },
  { tier: 'deal_king', label: 'Deal King',  minPoints: 2000, maxPoints: 4999,     badge: '👑' },
  { tier: 'deal_pro',  label: 'Deal Pro',   minPoints: 500,  maxPoints: 1999,     badge: '⭐' },
  { tier: 'hunter',    label: 'Hunter',     minPoints: 0,    maxPoints: 499,      badge: '🏹' },
];

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * getTierForPoints — מחשב רמה לפי מספר נקודות.
 * @param {number} points
 * @returns {{ tier: string, label: string, badge: string }}
 */
export function getTierForPoints(points) {
  if (typeof points !== 'number' || points < 0) points = 0;
  for (const t of TIERS) {
    if (points >= t.minPoints) return t;
  }
  return TIERS[TIERS.length - 1]; // hunter
}

/**
 * getPointsForAction — מחזיר כמה נקודות פעולה מזכה.
 * @param {string} action
 * @returns {number}
 */
export function getPointsForAction(action) {
  return POINTS_CONFIG[action] || 0;
}

/**
 * calcNextTier — כמה נקודות עד לרמה הבאה.
 * @param {number} points
 * @returns {{ nextTier: string|null, pointsNeeded: number }}
 */
export function calcNextTier(points) {
  if (typeof points !== 'number' || points < 0) points = 0;
  const current = getTierForPoints(points);

  // מצא את הרמה הבאה (מינימלית מעל הנוכחית)
  const higher = TIERS.filter(t => t.minPoints > current.minPoints)
    .sort((a, b) => a.minPoints - b.minPoints);

  if (higher.length === 0) return { nextTier: null, pointsNeeded: 0 }; // כבר Elite

  const next = higher[0];
  return {
    nextTier:     next.tier,
    pointsNeeded: next.minPoints - points,
  };
}

/**
 * validateAction — בודק שפעולה חוקית.
 * @param {string} action
 * @returns {boolean}
 */
export function validateAction(action) {
  return typeof action === 'string' && action in POINTS_CONFIG;
}

/**
 * buildTransactionRecord — בונה רשומת transaction.
 * @param {string} userId
 * @param {string} action
 * @param {number} points
 * @param {string|null} referenceId
 * @param {string|null} note
 * @returns {object}
 */
export function buildTransactionRecord(userId, action, points, referenceId = null, note = null) {
  if (!userId) throw new Error('userId נדרש');
  if (!validateAction(action)) throw new Error(`פעולה לא חוקית: ${action}`);
  if (typeof points !== 'number' || points === 0) throw new Error('points חייב להיות שונה מ-0');

  return {
    user_id:      userId,
    action,
    points,
    reference_id: referenceId || null,
    note:         note || null,
    created_at:   new Date().toISOString(),
  };
}

/**
 * formatLeaderboard — מעצב leaderboard לתצוגה.
 * @param {Array<{user_id, total_points, tier, rank}>} rows
 * @returns {Array<{rank, userId, points, tier, badge}>}
 */
export function formatLeaderboard(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => {
    const tierInfo = TIERS.find(t => t.tier === r.tier) || TIERS[TIERS.length - 1];
    return {
      rank:   Number(r.rank),
      userId: r.user_id,
      points: r.total_points,
      tier:   r.tier,
      badge:  tierInfo.badge,
      label:  tierInfo.label,
    };
  });
}

// ════════════════════════════════════════════════════════════
// DB functions
// ════════════════════════════════════════════════════════════

/**
 * addPoints — מוסיף נקודות למשתמש דרך Supabase RPC.
 * @param {string} userId
 * @param {string} action
 * @param {string|null} referenceId
 * @returns {{ total_points, tier, added }}
 */
export async function addPoints(userId, action, referenceId = null, note = null) {
  const points = getPointsForAction(action);
  if (!points) throw new Error(`פעולה לא מוכרת: ${action}`);

  const { data, error } = await supabase
    .rpc('add_points', {
      p_user_id:   userId,
      p_action:    action,
      p_points:    points,
      p_reference: referenceId,
      p_note:      note,
    });

  if (error) throw new Error(`addPoints RPC: ${error.message}`);
  return data;
}

/**
 * getUserPoints — שולף יתרת נקודות ורמה.
 * @param {string} userId
 * @returns {{ total_points, tier, updated_at }}
 */
export async function getUserPoints(userId) {
  const { data, error } = await supabase
    .from('user_points')
    .select('total_points, tier, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`getUserPoints: ${error.message}`);
  return data || { total_points: 0, tier: 'hunter', updated_at: null };
}

/**
 * getLeaderboard — top N משתמשים.
 * @param {number} limit
 * @returns {Array}
 */
export async function getLeaderboard(limit = 10) {
  const { data, error } = await supabase
    .rpc('get_leaderboard', { p_limit: limit });

  if (error) throw new Error(`getLeaderboard: ${error.message}`);
  return formatLeaderboard(data || []);
}

/**
 * getUserTransactions — היסטוריית נקודות למשתמש.
 * @param {string} userId
 * @param {number} limit
 * @returns {Array}
 */
export async function getUserTransactions(userId, limit = 20) {
  const { data, error } = await supabase
    .from('points_transactions')
    .select('action, points, note, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getUserTransactions: ${error.message}`);
  return data || [];
}

// ════════════════════════════════════════════════════════════
// Daily login check — מניעת כפל נקודות ביום
// ════════════════════════════════════════════════════════════

/**
 * hasLoginToday — בדוק אם משתמש כבר קיבל נקודות כניסה היום.
 * @param {string} userId
 * @returns {boolean}
 */
export async function hasLoginToday(userId) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('points_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('action', 'daily_login')
    .gte('created_at', startOfDay.toISOString());

  if (error) return false;
  return (count || 0) > 0;
}

/**
 * awardDailyLogin — נקודות כניסה יומית (רק פעם אחת ביום).
 * @param {string} userId
 * @returns {{ awarded: boolean, result?: object }}
 */
export async function awardDailyLogin(userId) {
  const alreadyAwarded = await hasLoginToday(userId);
  if (alreadyAwarded) return { awarded: false };

  const result = await addPoints(userId, 'daily_login');
  return { awarded: true, result };
}

// ════════════════════════════════════════════════════════════
// main — הרצה כ-cron (בדיקת תקינות + נקודות תפוגה)
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Sally Points health check`);

  try {
    // בדיקת DB — טבלאות קיימות
    const { error: e1 } = await supabase.from('user_points').select('id').limit(1);
    if (e1) throw new Error(`user_points: ${e1.message}`);

    const { error: e2 } = await supabase.from('points_transactions').select('id').limit(1);
    if (e2) throw new Error(`points_transactions: ${e2.message}`);

    const { data: tiers, error: e3 } = await supabase.from('user_tiers').select('tier, label').order('min_points');
    if (e3) throw new Error(`user_tiers: ${e3.message}`);

    log.log(`✅ DB תקין — ${tiers?.length} רמות: ${tiers?.map(t => t.label).join(', ')}`);

    // סטטיסטיקות
    const { count: totalUsers } = await supabase
      .from('user_points')
      .select('id', { count: 'exact', head: true });

    log.log(`📊 משתמשים עם נקודות: ${totalUsers || 0}`);

  } catch (err) {
    log.err(`❌ שגיאה: ${err.message}`);
    return { ok: false, error: err.message };
  }

  return { ok: true };
}

const isMain = process.argv[1]?.endsWith('bot41.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-41 crashed:', err); process.exit(1); });
}
