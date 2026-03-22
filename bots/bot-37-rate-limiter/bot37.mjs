// ════════════════════════════════════════════════════════════
// BOT-37 — Rate Limiter
// תפקיד: מגביל בקשות ל-100/דקה per IP.
//         חוסם IPs שחורגים במשך שעה.
//         מנקה רשומות ישנות פעם ביום.
//
// שימוש:
//   • כ-utility לשימוש מ-API middleware
//   • כ-cron job לניקוי + סטטיסטיקות
//
// Constants:
//   MAX_REQUESTS_PER_WINDOW = 100  (בקשות למינוט)
//   WINDOW_MS              = 60s
//   BLOCK_DURATION_MS      = 1h
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (מ-shared)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-37';
const log     = createLogger(BOT_ID);

export const MAX_REQUESTS_PER_WINDOW = 100;
export const WINDOW_MS               = 60 * 1000;        // 1 minute
export const BLOCK_DURATION_MS       = 60 * 60 * 1000;   // 1 hour

// ════════════════════════════════════════════════════════════
// RateLimiterMemory — in-memory window tracker
// ════════════════════════════════════════════════════════════

/**
 * RateLimiterMemory — מנהל חלוני זמן ב-Map בזיכרון.
 * כל key הוא "ip:endpoint".
 * מחזיק: count, windowStart, blockedUntil
 */
export class RateLimiterMemory {
  constructor() {
    /** @type {Map<string, { count: number, windowStart: number, blockedUntil: number }>} */
    this.store = new Map();
  }

  /**
   * _key — מפתח לפי IP + endpoint.
   */
  _key(ip, endpoint = '/') { return `${ip}::${endpoint}`; }

  /**
   * check — בודק האם הבקשה מותרת ומעדכן מונה.
   * @param {string} ip
   * @param {string} endpoint
   * @returns {{ allowed: boolean, remaining: number, resetAt: number, blockedUntil: number|null }}
   */
  check(ip, endpoint = '/') {
    const now = Date.now();
    const key = this._key(ip, endpoint);
    let entry = this.store.get(key);

    // אם חסום
    if (entry?.blockedUntil && entry.blockedUntil > now) {
      return {
        allowed:      false,
        remaining:    0,
        resetAt:      entry.blockedUntil,
        blockedUntil: entry.blockedUntil,
      };
    }

    // פתח חלון חדש אם לא קיים או פג תוקף
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      entry = { count: 0, windowStart: now, blockedUntil: 0 };
    }

    entry.count++;

    // האם חרג?
    if (entry.count > MAX_REQUESTS_PER_WINDOW) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
      this.store.set(key, entry);
      return {
        allowed:      false,
        remaining:    0,
        resetAt:      entry.blockedUntil,
        blockedUntil: entry.blockedUntil,
      };
    }

    this.store.set(key, entry);
    const remaining = MAX_REQUESTS_PER_WINDOW - entry.count;
    return {
      allowed:      true,
      remaining,
      resetAt:      entry.windowStart + WINDOW_MS,
      blockedUntil: null,
    };
  }

  /**
   * isBlocked — האם IP כרגע חסום.
   * @param {string} ip
   * @param {string} endpoint
   * @returns {boolean}
   */
  isBlocked(ip, endpoint = '/') {
    const key   = this._key(ip, endpoint);
    const entry = this.store.get(key);
    if (!entry) return false;
    return !!(entry.blockedUntil && entry.blockedUntil > Date.now());
  }

  /**
   * reset — מאפס חלון ל-IP (לניקוי טסטים).
   */
  reset(ip, endpoint = '/') {
    this.store.delete(this._key(ip, endpoint));
  }

  /**
   * getTopAbusers — מחזיר IPs ממוינים לפי count.
   * @param {number} limit
   * @returns {Array<{ ip: string, count: number, blocked: boolean }>}
   */
  getTopAbusers(limit = 10) {
    const now = Date.now();
    const result = [];

    for (const [key, entry] of this.store.entries()) {
      const ip = key.split('::')[0];
      result.push({
        ip,
        count:   entry.count,
        blocked: !!(entry.blockedUntil && entry.blockedUntil > now),
      });
    }

    return result
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
}

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * formatBlockedResponse — בונה response object לבקשה חסומה.
 * @param {number} blockedUntil — timestamp
 * @returns {{ status: 429, message: string, retryAfter: number }}
 */
export function formatBlockedResponse(blockedUntil) {
  const retryAfter = Math.ceil((blockedUntil - Date.now()) / 1000);
  return {
    status:     429,
    message:    `Too many requests. Try again in ${retryAfter} seconds.`,
    retryAfter: Math.max(retryAfter, 0),
  };
}

/**
 * shouldCleanup — האם צריך לנקות רשומות ישנות.
 * @param {Date|null} lastCleanupAt
 * @param {number} intervalMs
 * @returns {boolean}
 */
export function shouldCleanup(lastCleanupAt, intervalMs = 24 * 60 * 60 * 1000) {
  if (!lastCleanupAt) return true;
  return Date.now() - new Date(lastCleanupAt).getTime() >= intervalMs;
}

// ════════════════════════════════════════════════════════════
// DB functions
// ════════════════════════════════════════════════════════════

/**
 * recordRequest — שומר בקשה ב-DB (upsert לחלון הנוכחי).
 * @param {string} ip
 * @param {string} endpoint
 * @param {boolean} blocked
 */
export async function recordRequest(ip, endpoint = '/', blocked = false) {
  const windowStart = new Date();
  windowStart.setSeconds(0, 0);
  windowStart.setMilliseconds(0);

  const { error } = await supabase
    .from('rate_limit_log')
    .upsert({
      ip,
      endpoint,
      window_start:    windowStart.toISOString(),
      last_request_at: new Date().toISOString(),
      blocked_until:   blocked
        ? new Date(Date.now() + BLOCK_DURATION_MS).toISOString()
        : null,
    }, {
      onConflict:       'ip,endpoint,window_start',
      ignoreDuplicates: false,
    });

  if (error) throw new Error(`recordRequest: ${error.message}`);
}

/**
 * cleanupOldRecords — מוחק רשומות ישנות מ-rate_limit_log.
 * @returns {number} — כמה רשומות נמחקו
 */
export async function cleanupOldRecords() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('rate_limit_log')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);

  if (error) throw new Error(`cleanupOldRecords: ${error.message}`);
  return count || 0;
}

/**
 * getTopAbusersDb — top IPs לפי request_count מה-DB.
 * @param {number} limit
 */
export async function getTopAbusersDb(limit = 10) {
  const { data, error } = await supabase
    .from('rate_limit_log')
    .select('ip, request_count, blocked_until')
    .order('request_count', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getTopAbusers: ${error.message}`);
  return data || [];
}

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

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
    finished_at:   new Date().toISOString(),
    status,
    deals_removed: stats.cleaned,
    errors:        stats.errors,
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// main — ניקוי + סטטיסטיקות
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Rate Limiter cleanup`);

  let logId;
  const stats = { cleaned: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const cleaned = await cleanupOldRecords();
    stats.cleaned = cleaned;
    log.ok(`🧹 נוקו ${cleaned} רשומות ישנות`);

    const abusers = await getTopAbusersDb(5);
    if (abusers.length > 0) {
      log.log(`📊 Top abusers: ${abusers.map(a => `${a.ip}(${a.request_count})`).join(', ')}`);
    }

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot37.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-37 crashed:', err); process.exit(1); });
}
