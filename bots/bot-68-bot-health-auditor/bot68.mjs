// ════════════════════════════════════════════════════════════
// BOT-68 — Bot Health Auditor
// תפקיד: מבקר את בריאות כל הבוטים מ-bots_log ושולח
//         דוח יומי ל-Telegram.
//
// לוגיקה:
//   • קורא bots_log 7 ימים אחורה
//   • מחשב success rate, last run, health status per bot
//   • upsert → bot_health_snapshots
//   • שולח דוח Telegram
//
// תדירות: פעם ביום 07:00 UTC (Railway cron: 0 7 * * *)
//
// Env vars:
//   TELEGRAM_BOT_TOKEN     — לשליחת דוח
//   TELEGRAM_ALERT_CHAT_ID — chat/channel לדוח
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-68';
const log = createLogger(BOT_ID);

const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN     || '';
const ALERT_CHAT_ID   = process.env.TELEGRAM_ALERT_CHAT_ID || '';
const TELEGRAM_API    = 'https://api.telegram.org/bot';

export const DEFAULT_STALE_HOURS = 24;

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * computeBotSuccessRate — אחוז הרצות מוצלחות מסך הרצות (7 ימים).
 * @param {Array<{status:string, started_at:string}>} logs
 * @returns {number} 0-100
 */
export function computeBotSuccessRate(logs) {
  if (!logs || logs.length === 0) return 0;
  const successful = logs.filter(l => l.status === 'done').length;
  return Math.round((successful / logs.length) * 100);
}

/**
 * getLastRunStatus — מחזיר פרטי הרצה אחרונה.
 * @param {Array<{status:string, started_at:string, errors:string[]}>} logs
 * @returns {{ status:string, timestamp:string, errors:string[] }|null}
 */
export function getLastRunStatus(logs) {
  if (!logs || logs.length === 0) return null;
  const sorted = [...logs].sort(
    (a, b) => new Date(b.started_at) - new Date(a.started_at)
  );
  const last = sorted[0];
  return {
    status:    last.status,
    timestamp: last.started_at,
    errors:    last.errors || [],
  };
}

/**
 * detectStaleBots — מזהה בוטים שלא רצו בX שעות האחרונות.
 * @param {Record<string, Array>} logsByBot — { botId: logs[] }
 * @param {number} maxHoursSince
 * @param {Date} now
 * @returns {string[]} מערך bot_id-ים
 */
export function detectStaleBots(logsByBot, maxHoursSince = DEFAULT_STALE_HOURS, now = new Date()) {
  const stale = [];
  const cutoff = new Date(now.getTime() - maxHoursSince * 60 * 60 * 1000);

  for (const [botId, logs] of Object.entries(logsByBot)) {
    if (!logs || logs.length === 0) {
      stale.push(botId);
      continue;
    }
    const lastRun = getLastRunStatus(logs);
    if (!lastRun || new Date(lastRun.timestamp) < cutoff) {
      stale.push(botId);
    }
  }
  return stale;
}

/**
 * buildHealthSummary — סיכום מצב הבוטים לפי סטטוס.
 * @param {Array<{ health_status:string, bot_id:string }>} botStats
 * @returns {{ healthy:number, warning:number, critical:number, stale:number, total:number }}
 */
export function buildHealthSummary(botStats) {
  const summary = { healthy: 0, warning: 0, critical: 0, stale: 0, total: botStats.length };
  for (const s of botStats) {
    const status = s.health_status;
    if (status === 'healthy')  summary.healthy++;
    else if (status === 'warning')  summary.warning++;
    else if (status === 'critical') summary.critical++;
    else if (status === 'stale')    summary.stale++;
  }
  return summary;
}

/**
 * classifyBotHealth — מסווג בריאות בוט.
 * @param {number} successRate — 0-100
 * @param {number|null} lastRunHoursAgo — null = מעולם לא רץ
 * @returns {'healthy'|'warning'|'critical'|'stale'}
 */
export function classifyBotHealth(successRate, lastRunHoursAgo) {
  if (lastRunHoursAgo === null || lastRunHoursAgo === undefined) return 'stale';
  if (successRate >= 80 && lastRunHoursAgo < 25) return 'healthy';
  if (successRate >= 50) return 'warning';
  return 'critical';
}

/**
 * formatHealthReport — מעצב דוח טקסט ל-Telegram.
 * @param {{ healthy:number, warning:number, critical:number, stale:number, total:number }} summary
 * @param {Array<{ bot_id:string, health_status:string, success_rate:number }>} botStats
 * @returns {string}
 */
export function formatHealthReport(summary, botStats) {
  const lines = [
    `SallySale — Daily Bot Health Report`,
    `Date: ${new Date().toISOString().split('T')[0]}`,
    ``,
    `Total bots: ${summary.total}`,
    `Healthy: ${summary.healthy} | Warning: ${summary.warning} | Critical: ${summary.critical} | Stale: ${summary.stale}`,
    ``,
  ];

  const criticals = botStats.filter(b => b.health_status === 'critical');
  if (criticals.length > 0) {
    lines.push(`CRITICAL bots:`);
    criticals.forEach(b => lines.push(`  • ${b.bot_id} (${b.success_rate}% success)`));
    lines.push('');
  }

  const stales = botStats.filter(b => b.health_status === 'stale');
  if (stales.length > 0) {
    lines.push(`STALE bots (not run recently):`);
    stales.forEach(b => lines.push(`  • ${b.bot_id}`));
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchBotLogs() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('bots_log')
    .select('bot_id, status, started_at, finished_at, errors')
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) throw new Error(`fetchBotLogs: ${error.message}`);
  return data || [];
}

function groupLogsByBot(logs) {
  const map = {};
  for (const row of logs) {
    if (!map[row.bot_id]) map[row.bot_id] = [];
    map[row.bot_id].push(row);
  }
  return map;
}

async function upsertHealthSnapshot(botId, stats) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('bot_health_snapshots')
    .upsert({
      bot_id:          botId,
      success_rate:    stats.successRate,
      total_runs_7d:   stats.totalRuns,
      last_run_at:     stats.lastRunAt,
      last_run_status: stats.lastRunStatus,
      health_status:   stats.healthStatus,
      errors_7d:       stats.errors,
      snapshot_date:   today,
    }, { onConflict: 'bot_id,snapshot_date' });

  if (error) log.warn(`upsertHealthSnapshot(${botId}): ${error.message}`);
}

async function sendTelegramReport(message) {
  if (!TELEGRAM_TOKEN || !ALERT_CHAT_ID) {
    log.warn('Telegram not configured — skipping report');
    return;
  }
  try {
    await fetch(`${TELEGRAM_API}${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: ALERT_CHAT_ID, text: message }),
      signal:  AbortSignal.timeout(8000),
    });
  } catch (e) {
    log.warn(`Telegram report failed: ${e.message}`);
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
  log.log(`BOT-68 — Bot Health Auditor starting`);

  let logId;
  const stats = { updated: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const allLogs = await fetchBotLogs();
    log.log(`Fetched ${allLogs.length} log entries from last 7 days`);

    const logsByBot = groupLogsByBot(allLogs);
    const botIds    = Object.keys(logsByBot);

    const now = new Date();
    const botStatsList = [];

    for (const botId of botIds) {
      const botLogs   = logsByBot[botId];
      const successRate = computeBotSuccessRate(botLogs);
      const lastRun     = getLastRunStatus(botLogs);

      let lastRunHoursAgo = null;
      if (lastRun) {
        lastRunHoursAgo = (now - new Date(lastRun.timestamp)) / (1000 * 60 * 60);
      }

      const healthStatus = classifyBotHealth(successRate, lastRunHoursAgo);

      // Collect errors from last 7 days (unique, max 20)
      const allErrors = botLogs
        .flatMap(l => l.errors || [])
        .filter(Boolean)
        .slice(0, 20);

      const botStats = {
        bot_id:          botId,
        successRate,
        totalRuns:       botLogs.length,
        lastRunAt:       lastRun?.timestamp || null,
        lastRunStatus:   lastRun?.status || 'unknown',
        healthStatus,
        errors:          allErrors,
        health_status:   healthStatus,
        success_rate:    successRate,
      };

      botStatsList.push(botStats);
      await upsertHealthSnapshot(botId, botStats);
      stats.updated++;

      log.log(`${botId}: ${successRate}% success, ${botLogs.length} runs, status=${healthStatus}`);
    }

    // Build and send report
    const summary = buildHealthSummary(botStatsList);
    const report  = formatHealthReport(summary, botStatsList);
    await sendTelegramReport(report);

    log.ok(`Done — audited ${botIds.length} bots. Healthy: ${summary.healthy}, Warning: ${summary.warning}, Critical: ${summary.critical}, Stale: ${summary.stale}`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot68.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-68 crashed:', err); process.exit(1); });
}
