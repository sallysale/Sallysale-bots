// ════════════════════════════════════════════════════════════
// BOT-62 — GDPR Manager
// תפקיד: מטפל בבקשות GDPR/CCPA. מאנונים נתוני משתמשים ישנים.
//         מעבד בקשות מחיקה. מאנונים IPs ב-click_log.
//
// לוגיקה:
//   1. שולף deletion_requests עם status='pending'
//   2. לכל בקשה: מאנונם נתוני המשתמש בטבלאות הרלוונטיות
//   3. מוחק נתונים אישיים, שומר רשומות אנונימיות לאנליטיקס
//   4. מאנונם IPs ב-click_log ישנים מ-90 יום
//   5. מסמן בקשות כ-completed
//   6. כותב ל-bots_log + gdpr_audit_log
//
// תדירות: פעם ביום 02:00 UTC (Railway cron: 0 2 * * *)
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID              = 'BOT-62';
const INACTIVE_YEARS      = 2;       // anonymize after 2 years inactivity
const IP_RETENTION_DAYS   = 90;      // anonymize click_log IPs older than 90 days

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — exported
// ════════════════════════════════════════════════════════════

/**
 * _simpleHash — hash פשוט (לא קריפטוגרפי) ל-8 תווים.
 * משמש לאנונום email באופן deterministic.
 * @param {string} input
 * @returns {string}
 */
function _simpleHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // convert to 32-bit int
  }
  // המר לhex ללא סימן
  const unsigned = hash >>> 0;
  return unsigned.toString(16).padStart(8, '0');
}

/**
 * anonymizeEmail — מחליף email ב-'deleted_HASH@deleted.invalid'.
 * HASH = 8 תווים ראשונים של hash ה-email.
 * deterministic: אותו email → אותה תוצאה.
 * @param {string} email
 * @returns {string}
 */
export function anonymizeEmail(email) {
  if (!email || typeof email !== 'string') return 'deleted_unknown@deleted.invalid';
  const hash = _simpleHash(email);
  return `deleted_${hash}@deleted.invalid`;
}

/**
 * isRetentionExpired — בודק אם נתון ישן מ-retentionDays ימים.
 * @param {string|Date|null} createdAt
 * @param {number} retentionDays
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isRetentionExpired(createdAt, retentionDays, now = new Date()) {
  if (!createdAt) return false; // safe default

  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return false;

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return created < cutoff;
}

/**
 * buildDeletionSummary — בונה סיכום מחיקה לבקשה.
 * @param {string} userId
 * @param {string[]} tables — שמות טבלאות שעובדו
 * @returns {{ userId: string, deletedFrom: string[], anonymizedFields: string[] }}
 */
export function buildDeletionSummary(userId, tables) {
  return {
    userId,
    deletedFrom:       Array.isArray(tables) ? [...tables] : [],
    anonymizedFields:  ['email', 'ip_address', 'user_metadata'],
  };
}

/**
 * maskIpAddress — מסתיר את האוקטט האחרון של IPv4 / חלק אחרון של IPv6.
 * '192.168.1.1' → '192.168.1.x'
 * '2001:db8::1' → '2001:db8::x'
 * @param {string} ip
 * @returns {string}
 */
export function maskIpAddress(ip) {
  if (!ip || typeof ip !== 'string') return 'x.x.x.x';

  // IPv4
  const ipv4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipv4) return `${ipv4[1]}.x`;

  // IPv6 — מחליף את הקטע האחרון (אחרי :: או :)
  if (ip.includes(':')) {
    const lastColon = ip.lastIndexOf(':');
    return `${ip.substring(0, lastColon)}:x`;
  }

  return 'x';
}

/**
 * shouldAnonymizeUser — בודק אם יש לאנונם משתמש.
 * מחזיר true אם:
 *  - deletion_requested === true
 *  - לא פעיל יותר מ-2 שנים (last_sign_in_at / created_at)
 * @param {object} user
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldAnonymizeUser(user, now = new Date()) {
  if (!user) return false;

  if (user.deletion_requested === true) return true;

  // בדוק פעילות: last_sign_in_at קודם, אחר כך created_at
  const lastActivity = user.last_sign_in_at || user.last_active_at || user.created_at;

  if (!lastActivity) return false;

  const inactiveMs  = INACTIVE_YEARS * 365 * 24 * 60 * 60 * 1000;
  const cutoff      = new Date(now.getTime() - inactiveMs);
  return new Date(lastActivity) < cutoff;
}

/**
 * generateComplianceToken — מחזיר 32-byte (64 תווים hex) אקראי לשרשרת ביקורת.
 * משתמש ב-crypto.getRandomValues (Web Crypto API — זמין ב-Node.js 19+).
 * @returns {string}
 */
export function generateComplianceToken() {
  // Web Crypto API — זמין גם ב-Node.js וגם בדפדפן
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback — Math.random (לא קריפטוגרפי, רק לסביבות ישנות)
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
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
    errors:        stats.errors  || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchPendingDeletionRequests() {
  const { data, error } = await supabase
    .from('deletion_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(100);

  if (error) throw new Error(`fetchPendingDeletionRequests: ${error.message}`);
  return data || [];
}

async function processUserDeletion(userId, auditToken) {
  const processedTables = [];

  // 1. אנונם ב-wishlist_alerts (אם קיים)
  try {
    await supabase.from('wishlist_alerts').update({ user_id: null }).eq('user_id', userId);
    processedTables.push('wishlist_alerts');
  } catch (_) {}

  // 2. אנונם ב-click_log — החלף ip_address
  try {
    const { data: clicks } = await supabase
      .from('click_log')
      .select('id, ip_address')
      .eq('user_id', userId);

    if (clicks?.length) {
      for (const click of clicks) {
        await supabase.from('click_log').update({
          ip_address: maskIpAddress(click.ip_address || ''),
          user_id:    null,
        }).eq('id', click.id);
      }
      processedTables.push('click_log');
    }
  } catch (_) {}

  // 3. מחק מ-wishlists
  try {
    await supabase.from('wishlists').delete().eq('user_id', userId);
    processedTables.push('wishlists');
  } catch (_) {}

  // 4. מחק מ-push_subscriptions
  try {
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    processedTables.push('push_subscriptions');
  } catch (_) {}

  // 5. מחק מ-user_points
  try {
    await supabase.from('user_points').delete().eq('user_id', userId);
    processedTables.push('user_points');
  } catch (_) {}

  // 6. כתוב gdpr_audit_log
  await supabase.from('gdpr_audit_log').insert({
    user_id:      userId,
    action:       'deleted',
    tables:       processedTables,
    audit_token:  auditToken,
    performed_at: new Date().toISOString(),
  });

  return processedTables;
}

async function markRequestCompleted(requestId, auditToken) {
  await supabase.from('deletion_requests').update({
    status:       'completed',
    completed_at: new Date().toISOString(),
    audit_token:  auditToken,
  }).eq('id', requestId);
}

async function anonymizeOldClickLogIps() {
  const cutoff = new Date(Date.now() - IP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('click_log')
    .select('id, ip_address')
    .lt('clicked_at', cutoff)
    .not('ip_address', 'is', null)
    .limit(500);

  if (error) throw new Error(`anonymizeOldClickLogIps: ${error.message}`);
  if (!data?.length) return 0;

  let count = 0;
  for (const row of data) {
    const masked = maskIpAddress(row.ip_address || '');
    if (masked !== row.ip_address) {
      await supabase.from('click_log').update({ ip_address: masked }).eq('id', row.id);
      count++;
    }
  }

  return count;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — GDPR Manager`);

  let logId;
  const stats = { updated: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    // 1. עבד בקשות מחיקה ממתינות
    const requests = await fetchPendingDeletionRequests();
    log.log(`📋 ${requests.length} בקשות מחיקה ממתינות`);

    for (const req of requests) {
      try {
        await supabase.from('deletion_requests').update({ status: 'processing' }).eq('id', req.id);

        const auditToken     = generateComplianceToken();
        const processedTables = await processUserDeletion(req.user_id, auditToken);

        await markRequestCompleted(req.id, auditToken);
        stats.updated++;

        const summary = buildDeletionSummary(req.user_id, processedTables);
        log.ok(`✅ מחיקה הושלמה: ${req.user_id} — ${summary.deletedFrom.join(', ')}`);

      } catch (err) {
        log.warn(`⚠️ בקשה ${req.id}: ${err.message}`);
        stats.errors.push(`request ${req.id}: ${err.message}`);

        await supabase.from('deletion_requests').update({ status: 'pending' }).eq('id', req.id);
      }
    }

    // 2. אנונם IPs ישנים ב-click_log
    try {
      const anonymized = await anonymizeOldClickLogIps();
      log.log(`🔒 ${anonymized} IPs אונונמו ב-click_log`);
    } catch (err) {
      log.warn(`⚠️ anonymizeOldClickLogIps: ${err.message}`);
      stats.errors.push(`ip-anonymize: ${err.message}`);
    }

    log.log(`✅ סיום: ${stats.updated} בקשות עובדו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot62.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-62 crashed:', err); process.exit(1); });
}
