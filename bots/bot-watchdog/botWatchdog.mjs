// ════════════════════════════════════════════════════════════
// BOT-Watchdog — Crash Recovery & Health Monitor
// תפקיד: בודק כל 5 דקות אם בוט קרס (status='running' יותר מ-X דקות).
//         אם קרס → מסמן כ-error ב-bots_log.
//         אם נכשל 3 פעמים → שולח התראת Telegram לאדמין.
//         שולח דוח בוקר יומי ב-08:00 UTC.
//
// תדירות: כל 5 דקות (Railway cron: */5 * * * *)
// ════════════════════════════════════════════════════════════

import https   from 'https';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-WATCHDOG';

// ── סף זמן — בוט שרץ יותר מכך נחשב קרוס ────────────────────
const CRASH_THRESHOLDS = {
  default:         60 * 60 * 1000,  // 60 דקות
  'BOT-18':        6  * 60 * 60 * 1000, // BOT-18 רץ פעם ביום — 6h
  'BOT-08':        30 * 60 * 1000,  // RSS: 30 דקות
  'BOT-11':        45 * 60 * 1000,  // Amazon: 45 דקות
};

// ── ספירת כשלונות לפי בוט (in-memory, מאופס עם ריצה) ─────────
const failureCount = {};

// ── Telegram ─────────────────────────────────────────────────
function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return Promise.resolve();

  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

// ── bots_log ─────────────────────────────────────────────────
async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`logStart failed: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats, status = 'done') {
  await supabase
    .from('bots_log')
    .update({
      finished_at:   new Date().toISOString(),
      status,
      deals_updated: stats.recovered || 0,
      errors:        stats.errors || [],
    })
    .eq('id', logId);
}

// ── זיהוי בוטים תקועים ────────────────────────────────────────
async function detectStalledBots(logger) {
  const now = new Date();
  const stalled = [];

  // שלוף בוטים שסטטוס שלהם 'running'
  const { data: runningBots, error } = await supabase
    .from('bots_log')
    .select('id, bot_id, started_at, status')
    .eq('status', 'running')
    .order('started_at', { ascending: true });

  if (error) {
    logger.err(`שגיאה בשליפת בוטים פעילים: ${error.message}`);
    return stalled;
  }
  if (!runningBots || runningBots.length === 0) return stalled;

  for (const bot of runningBots) {
    const startedAt  = new Date(bot.started_at);
    const elapsed    = now - startedAt;
    const threshold  = CRASH_THRESHOLDS[bot.bot_id] || CRASH_THRESHOLDS.default;

    if (elapsed > threshold) {
      stalled.push({ ...bot, elapsed, threshold });
    }
  }

  return stalled;
}

// ── טיפול בבוט תקוע ──────────────────────────────────────────
async function handleStalledBot(bot, stats, logger) {
  const minutesStuck = Math.round(bot.elapsed / 60000);
  logger.warn(`⚠️  ${bot.bot_id}: תקוע ${minutesStuck} דקות — מסמן כ-error`);

  // סמן כ-error ב-bots_log
  const { error } = await supabase
    .from('bots_log')
    .update({
      status:      'error',
      finished_at: new Date().toISOString(),
      errors:      [`Watchdog: stuck for ${minutesStuck}min`],
    })
    .eq('id', bot.id);

  if (error) {
    logger.err(`לא הצלחתי לסמן ${bot.bot_id}: ${error.message}`);
    stats.errors.push(`${bot.bot_id}: ${error.message}`);
    return;
  }

  stats.recovered++;

  // עדכן מונה כשלונות
  failureCount[bot.bot_id] = (failureCount[bot.bot_id] || 0) + 1;

  // שלח התראת Telegram אחרי 3 כשלונות
  if (failureCount[bot.bot_id] >= 3) {
    const msg = `🚨 <b>BOT-Watchdog Alert</b>\n` +
      `<b>${bot.bot_id}</b> כשל ${failureCount[bot.bot_id]} פעמים!\n` +
      `⏱ תקוע מאז: ${new Date(bot.started_at).toISOString()}\n` +
      `🔴 נדרשת התערבות ידנית`;
    await sendTelegram(msg);
    logger.warn(`📨 התראת Telegram נשלחה עבור ${bot.bot_id}`);
    failureCount[bot.bot_id] = 0; // reset לאחר התראה
  }
}

// ── דוח בוקר (08:00 UTC) ─────────────────────────────────────
async function sendMorningReport(logger) {
  const now = new Date();
  if (now.getUTCHours() !== 8) return; // רק ב-08:00 UTC

  logger.log('📋 שולח דוח בוקר...');

  // סטטיסטיקות 24 שעות אחרונות
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: logs } = await supabase
    .from('bots_log')
    .select('bot_id, status, started_at, finished_at, deals_added, deals_updated')
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false });

  if (!logs || logs.length === 0) return;

  const summary = {};
  for (const log of logs) {
    if (!summary[log.bot_id]) {
      summary[log.bot_id] = { runs: 0, errors: 0, deals: 0 };
    }
    summary[log.bot_id].runs++;
    if (log.status === 'error') summary[log.bot_id].errors++;
    summary[log.bot_id].deals += (log.deals_added || 0) + (log.deals_updated || 0);
  }

  const errorBots = Object.entries(summary).filter(([, s]) => s.errors > 0);

  let msg = `📊 <b>SallySale — דוח בוקר ${now.toISOString().slice(0, 10)}</b>\n\n`;
  msg += `✅ בוטים פעילים: ${Object.keys(summary).length}\n`;
  msg += `🔴 עם שגיאות: ${errorBots.length}\n\n`;

  if (errorBots.length > 0) {
    msg += `<b>בוטים עם שגיאות:</b>\n`;
    for (const [botId, s] of errorBots) {
      msg += `  • ${botId}: ${s.errors}/${s.runs} ריצות נכשלו\n`;
    }
  } else {
    msg += `🎉 כל הבוטים פעלו ללא שגיאות!\n`;
  }

  await sendTelegram(msg);
  logger.ok('📨 דוח בוקר נשלח');
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-Watchdog — מתחיל ===');

  const stats = { checked: 0, recovered: 0, errors: [] };
  let logId;

  try { logId = await logStart(); } catch (e) { logger.err(e.message); }

  try {
    // 1. זיהוי בוטים תקועים
    const stalledBots = await detectStalledBots(logger);
    stats.checked = stalledBots.length;

    if (stalledBots.length === 0) {
      logger.ok('✅ כל הבוטים תקינים — אין תקועים');
    } else {
      logger.warn(`⚠️  נמצאו ${stalledBots.length} בוטים תקועים`);
      for (const bot of stalledBots) {
        await handleStalledBot(bot, stats, logger);
      }
    }

    // 2. דוח בוקר (אם 08:00)
    await sendMorningReport(logger);

    logger.ok(`📊 סיכום BOT-Watchdog:`);
    logger.ok(`  🔍 נבדקו תקועים: ${stats.checked}`);
    logger.ok(`  ✅ טופלו:         ${stats.recovered}`);
    logger.ok(`  💥 שגיאות:        ${stats.errors.length}`);
    logger.ok(`=== BOT-Watchdog סיים — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
    await sendTelegram(`❌ BOT-Watchdog עצמו קרס: ${err.message}`);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
  }
}

main();
