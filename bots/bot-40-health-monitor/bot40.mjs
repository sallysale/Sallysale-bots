// ════════════════════════════════════════════════════════════
// BOT-40 — Health Monitor
// תפקיד: בודק תקינות שירותים כל 5 דקות.
//         שולח התראת Telegram אם שירות נפל.
//         מתעד תוצאות ב-health_log.
//
// שירותים:
//   • Supabase  — REST API ping
//   • Site      — HTTP GET לדף הבית
//   • Railway   — בדיקת process.env (self-health)
//
// Anti-spam: לא מתריע יותר מפעם אחת ב-30 דקות.
//
// תדירות: כל 5 דקות (Railway cron: */5 * * * *)
//
// Env vars:
//   TELEGRAM_BOT_TOKEN     — לשליחת התראות
//   TELEGRAM_ALERT_CHAT_ID — chat/channel לקבלת alerts
//   SITE_URL               — האתר לבדיקה
//   SUPABASE_URL           — כבר ב-.env
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-40';
const log     = createLogger(BOT_ID);

export const PING_TIMEOUT_MS  = 5000;
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
export const SERVICES          = ['supabase', 'site', 'railway'];

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN     || '';
const ALERT_CHAT_ID    = process.env.TELEGRAM_ALERT_CHAT_ID || '';
const SITE_URL         = process.env.SITE_URL || 'https://sallysale.com';
const SUPABASE_URL     = process.env.SUPABASE_URL || '';
const TELEGRAM_API     = 'https://api.telegram.org/bot';

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * isHealthy — האם התגובה נחשבת בריאה.
 * @param {number|null} responseTimeMs
 * @param {number|null} statusCode
 * @returns {boolean}
 */
export function isHealthy(responseTimeMs, statusCode) {
  if (responseTimeMs === null || responseTimeMs === undefined) return false;
  if (responseTimeMs >= PING_TIMEOUT_MS) return false;
  if (statusCode !== null && statusCode !== undefined && statusCode >= 500) return false;
  return true;
}

/**
 * shouldAlert — האם לשלוח התראה (לא הייתה ב-cooldown).
 * @param {Date|string|null} lastAlertAt
 * @param {number} cooldownMs
 * @returns {boolean}
 */
export function shouldAlert(lastAlertAt, cooldownMs = ALERT_COOLDOWN_MS) {
  if (!lastAlertAt) return true;
  return Date.now() - new Date(lastAlertAt).getTime() >= cooldownMs;
}

/**
 * buildAlertMessage — הודעת Telegram להתראה.
 * @param {string} service
 * @param {string|null} error
 * @param {number|null} responseTimeMs
 * @returns {string}
 */
export function buildAlertMessage(service, error, responseTimeMs) {
  const msStr = responseTimeMs != null ? ` (${responseTimeMs}ms)` : '';
  const errStr = error ? `\nError: ${error}` : '';
  return `🚨 SallySale Alert\n\nService DOWN: ${service}${msStr}${errStr}\n\nTime: ${new Date().toISOString()}`;
}

/**
 * getServiceEmoji — emoji לפי סטטוס.
 * @param {boolean} ok
 * @returns {string}
 */
export function getServiceEmoji(ok) {
  return ok ? '✅' : '❌';
}

/**
 * parseServiceResult — בונה תוצאת בדיקה.
 * @param {string} service
 * @param {boolean} ok
 * @param {number|null} ms
 * @param {string|null} error
 * @returns {object}
 */
export function parseServiceResult(service, ok, ms, error) {
  return {
    service,
    ok,
    ms:         ms || null,
    error:      error || null,
    checkedAt:  new Date().toISOString(),
    status:     ok ? 'ok' : (ms >= PING_TIMEOUT_MS ? 'timeout' : 'error'),
  };
}

/**
 * formatHealthSummary — שורת סיכום לכל השירותים.
 * @param {Array<object>} results — מערך של parseServiceResult
 * @returns {string}
 */
export function formatHealthSummary(results) {
  return results.map(r => {
    const emoji = getServiceEmoji(r.ok);
    const ms    = r.ms != null ? `(${r.ms}ms)` : '';
    return `${emoji} ${r.service} ${ms}`.trim();
  }).join(' | ');
}

// ════════════════════════════════════════════════════════════
// Ping functions
// ════════════════════════════════════════════════════════════

async function pingSupabase() {
  const start = Date.now();
  try {
    const { error } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    const ms = Date.now() - start;
    if (error) return { ok: false, ms, error: error.message, statusCode: null };
    return { ok: true, ms, error: null, statusCode: 200 };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message, statusCode: null };
  }
}

async function pingSite() {
  const start = Date.now();
  try {
    const res = await fetch(SITE_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    return { ok: res.ok || res.status < 500, ms, error: null, statusCode: res.status };
  } catch (err) {
    const ms = Date.now() - start;
    return { ok: false, ms, error: err.message, statusCode: null };
  }
}

async function pingRailway() {
  // Railway self-health: בדוק שה-env vars קיימים
  const ok = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  return { ok, ms: 1, error: ok ? null : 'missing env vars', statusCode: ok ? 200 : 500 };
}

// ════════════════════════════════════════════════════════════
// Telegram alert
// ════════════════════════════════════════════════════════════

async function sendTelegramAlert(message) {
  if (!TELEGRAM_TOKEN || !ALERT_CHAT_ID) return;
  try {
    await fetch(`${TELEGRAM_API}${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: ALERT_CHAT_ID, text: message }),
      signal:  AbortSignal.timeout(8000),
    });
  } catch (e) {
    log.warn(`Telegram alert failed: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════
// DB logging
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
    finished_at: new Date().toISOString(),
    status,
    errors:      stats.errors,
  }).eq('id', logId);
}

async function writeHealthLog(result) {
  const { error } = await supabase.from('health_log').insert({
    service:          result.service,
    status:           result.status,
    response_time_ms: result.ms,
    status_code:      null,
    error_msg:        result.error,
    alert_sent:       false,
    checked_at:       result.checkedAt,
  });
  if (error) log.warn(`health_log write error: ${error.message}`);
}

async function fetchLastAlertTime(service) {
  const { data } = await supabase
    .from('health_log')
    .select('checked_at')
    .eq('service', service)
    .eq('alert_sent', true)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.checked_at || null;
}

async function markAlertSent(service) {
  await supabase.from('health_log')
    .update({ alert_sent: true })
    .eq('service', service)
    .eq('status', 'down')
    .order('checked_at', { ascending: false });
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Health Monitor`);

  let logId;
  const stats = { errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  const pingFns = {
    supabase: pingSupabase,
    site:     pingSite,
    railway:  pingRailway,
  };

  const results = [];

  try {
    for (const service of SERVICES) {
      const raw    = await pingFns[service]();
      const result = parseServiceResult(service, raw.ok, raw.ms, raw.error);
      results.push(result);

      await writeHealthLog(result);

      if (!result.ok) {
        log.warn(`❌ ${service} DOWN — ${raw.error || 'no response'} (${raw.ms}ms)`);

        // בדוק אם צריך לשלוח התראה
        const lastAlert = await fetchLastAlertTime(service);
        if (shouldAlert(lastAlert)) {
          const msg = buildAlertMessage(service, raw.error, raw.ms);
          await sendTelegramAlert(msg);
          await markAlertSent(service);
          log.warn(`📣 התראה נשלחה ל-Telegram עבור: ${service}`);
        } else {
          log.log(`⏭️ ${service} — עדיין ב-cooldown`);
        }

        stats.errors.push(`${service}: ${raw.error || 'timeout'}`);
      } else {
        log.ok(`${service} — ${raw.ms}ms`);
      }
    }

    log.log(`📊 ${formatHealthSummary(results)}`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return { results, errors: stats.errors };
}

const isMain = process.argv[1]?.endsWith('bot40.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-40 crashed:', err); process.exit(1); });
}
