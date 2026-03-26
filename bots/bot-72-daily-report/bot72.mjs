// ════════════════════════════════════════════════════════════
// BOT-72 — Daily Intelligence Report
// תפקיד: שולח דוח בוקר ל-Telegram ב-08:00 UTC עם:
//   • כמה דילים נוספו הלילה (midnight–08:00)
//   • כמה בוטים רצו/נכשלו ב-24 שעות אחרונות
//   • כמה עמלות נצברו (affiliate_clicks converted)
//   • בעיות שזוהו (errors מ-bots_log)
//   • סטטוס רשתות אפיליאציה
//
// תדירות: פעם ביום 08:00 UTC (Railway cron: 0 8 * * *)
//
// Env vars:
//   TELEGRAM_BOT_TOKEN     — לשליחת דוח
//   TELEGRAM_ALERT_CHAT_ID — chat/channel לדוח
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-72';
const log = createLogger(BOT_ID);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN     || '';
const ALERT_CHAT_ID  = process.env.TELEGRAM_ALERT_CHAT_ID || '';
const TELEGRAM_API   = 'https://api.telegram.org/bot';

// רשתות אפיליאציה לבדיקת סטטוס
export const AFFILIATE_NETWORKS = [
  { id: 'tradedoubler', name: 'Tradedoubler', envKey: 'TRADEDOUBLER_TOKEN' },
  { id: 'cj',           name: 'CJ',           envKey: 'CJ_API_KEY' },
  { id: 'awin',         name: 'AWIN',          envKey: 'AWIN_API_KEY' },
  { id: 'impact',       name: 'Impact',        envKey: 'IMPACT_ACCOUNT_SID' },
  { id: 'rakuten',      name: 'Rakuten',       envKey: 'RAKUTEN_TOKEN' },
  { id: 'ebay',         name: 'eBay EPN',      envKey: 'EBAY_APP_ID' },
];

// ════════════════════════════════════════════════════════════
// פונקציות טהורות (exported for tests)
// ════════════════════════════════════════════════════════════

/**
 * countDealsAddedOvernight — סופר דילים שנוספו מחצות עד 08:00.
 * @param {Array<{created_at:string}>} deals
 * @param {Date} reportTime — זמן הדוח (ברירת מחדל: עכשיו)
 * @returns {number}
 */
export function countDealsAddedOvernight(deals, reportTime = new Date()) {
  const midnight = new Date(reportTime);
  midnight.setUTCHours(0, 0, 0, 0);
  return deals.filter(d => new Date(d.created_at) >= midnight).length;
}

/**
 * summarizeBotRuns — מסכם הרצות בוטים מ-bots_log.
 * @param {Array<{status:string, bot_id:string, errors:string[]}>} logs
 * @returns {{ ran:number, succeeded:number, failed:number, failedBots:string[], topErrors:string[] }}
 */
export function summarizeBotRuns(logs) {
  if (!logs || logs.length === 0) {
    return { ran: 0, succeeded: 0, failed: 0, failedBots: [], topErrors: [] };
  }

  const ran       = logs.length;
  const succeeded = logs.filter(l => l.status === 'done').length;
  const failed    = logs.filter(l => l.status === 'error').length;

  const failedBots = [...new Set(
    logs.filter(l => l.status === 'error').map(l => l.bot_id)
  )];

  const topErrors = logs
    .flatMap(l => l.errors || [])
    .filter(Boolean)
    .slice(0, 5);

  return { ran, succeeded, failed, failedBots, topErrors };
}

/**
 * calcCommissionsEarned — מחשב עמלות שנצברו (converted clicks).
 * @param {Array<{commission:number|null, converted:boolean}>} clicks
 * @returns {{ totalClicks:number, converted:number, totalCommission:number }}
 */
export function calcCommissionsEarned(clicks) {
  if (!clicks || clicks.length === 0) {
    return { totalClicks: 0, converted: 0, totalCommission: 0 };
  }

  const converted = clicks.filter(c => c.converted === true);
  const totalCommission = converted.reduce((sum, c) => {
    return sum + (parseFloat(c.commission) || 0);
  }, 0);

  return {
    totalClicks:      clicks.length,
    converted:        converted.length,
    totalCommission:  Math.round(totalCommission * 100) / 100,
  };
}

/**
 * detectIssues — מזהה בעיות מהנתונים.
 * @param {{ botSummary, dealsAdded, commissions }} data
 * @returns {string[]} רשימת בעיות לדוח
 */
export function detectIssues(data) {
  const issues = [];

  if (data.botSummary.failed > 0) {
    issues.push(`${data.botSummary.failed} bot(s) failed: ${data.botSummary.failedBots.join(', ')}`);
  }
  if (data.botSummary.ran === 0) {
    issues.push('No bots ran in the last 24 hours — system may be down');
  }
  if (data.dealsAdded === 0) {
    issues.push('No new deals added overnight — check data sources');
  }
  if (data.commissions.converted === 0 && data.commissions.totalClicks > 10) {
    issues.push(`${data.commissions.totalClicks} clicks with 0 conversions — affiliate links may be broken`);
  }

  return issues;
}

/**
 * checkNetworkStatus — בודק אילו רשתות מוגדרות (env key קיים).
 * @param {Array<{id, name, envKey}>} networks
 * @param {Record<string,string>} env — process.env
 * @returns {Array<{name:string, active:boolean}>}
 */
export function checkNetworkStatus(networks, env = process.env) {
  return networks.map(n => ({
    id:     n.id,
    name:   n.name,
    active: Boolean(env[n.envKey]),
  }));
}

/**
 * buildDailyReport — בונה טקסט הדוח ל-Telegram.
 * @param {{ date, dealsAdded, botSummary, commissions, issues, networks }} data
 * @returns {string}
 */
export function buildDailyReport(data) {
  const { date, dealsAdded, botSummary, commissions, issues, networks } = data;

  const activeNets  = networks.filter(n => n.active).map(n => n.name);
  const inactiveNets = networks.filter(n => !n.active).map(n => n.name);

  const lines = [
    `🌅 SallySale — Daily Intelligence Report`,
    `📅 ${date}`,
    ``,
    `📦 DEALS`,
    `• Added overnight: ${dealsAdded}`,
    ``,
    `🤖 BOTS (last 24h)`,
    `• Ran: ${botSummary.ran} | ✅ ${botSummary.succeeded} | ❌ ${botSummary.failed}`,
  ];

  if (botSummary.failedBots.length > 0) {
    lines.push(`• Failed bots: ${botSummary.failedBots.join(', ')}`);
  }

  lines.push(``);
  lines.push(`💰 COMMISSIONS`);
  lines.push(`• Clicks: ${commissions.totalClicks} | Converted: ${commissions.converted}`);
  lines.push(`• Earned: $${commissions.totalCommission.toFixed(2)}`);

  if (issues.length > 0) {
    lines.push(``);
    lines.push(`⚠️ ISSUES DETECTED`);
    issues.forEach(issue => lines.push(`• ${issue}`));
  } else {
    lines.push(``);
    lines.push(`✅ No issues detected`);
  }

  lines.push(``);
  lines.push(`🌐 AFFILIATE NETWORKS`);
  if (activeNets.length > 0)   lines.push(`• Active: ${activeNets.join(', ')}`);
  if (inactiveNets.length > 0) lines.push(`• Inactive: ${inactiveNets.join(', ')}`);

  if (botSummary.topErrors.length > 0) {
    lines.push(``);
    lines.push(`🔍 TOP ERRORS`);
    botSummary.topErrors.slice(0, 3).forEach(e => lines.push(`• ${String(e).slice(0, 80)}`));
  }

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchDealsOvernight() {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('deals')
    .select('id, created_at')
    .gte('created_at', since.toISOString());

  if (error) throw new Error(`fetchDealsOvernight: ${error.message}`);
  return data || [];
}

async function fetchBotLogs24h() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('bots_log')
    .select('bot_id, status, started_at, finished_at, errors')
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) throw new Error(`fetchBotLogs24h: ${error.message}`);
  return data || [];
}

async function fetchClicksOvernight() {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('affiliate_clicks')
    .select('id, converted, commission, clicked_at')
    .gte('clicked_at', since.toISOString());

  if (error) {
    // טבלה עשויה לא להיות קיימת עדיין — non-fatal
    log.warn(`fetchClicksOvernight: ${error.message}`);
    return [];
  }
  return data || [];
}

async function saveReport(reportText, dealsAdded, botsRan, botsFailed, commissionsEarned, issues) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('daily_reports')
    .upsert({
      report_date:          today,
      deals_added_overnight: dealsAdded,
      bots_ran:             botsRan,
      bots_failed:          botsFailed,
      commissions_earned:   commissionsEarned,
      issues_detected:      issues,
      report_text:          reportText,
      sent_at:              new Date().toISOString(),
    }, { onConflict: 'report_date' });

  if (error) log.warn(`saveReport: ${error.message}`);
}

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !ALERT_CHAT_ID) {
    log.warn('Telegram not configured — skipping report');
    return false;
  }
  try {
    const res = await fetch(`${TELEGRAM_API}${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: ALERT_CHAT_ID, text: message }),
      signal:  AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log.warn(`Telegram HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    log.warn(`Telegram send failed: ${e.message}`);
    return false;
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
    finished_at: new Date().toISOString(),
    status:      stats.errors?.length > 0 ? 'error' : 'done',
    errors:      stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log('BOT-72 — Daily Intelligence Report starting');

  let logId;
  const runStats = { errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    // 1. נתוני לילה
    const [overnightDeals, botLogs, clicks] = await Promise.all([
      fetchDealsOvernight(),
      fetchBotLogs24h(),
      fetchClicksOvernight(),
    ]);

    log.log(`Overnight deals: ${overnightDeals.length}, Bot logs: ${botLogs.length}, Clicks: ${clicks.length}`);

    // 2. עיבוד נתונים
    const now          = new Date();
    const dealsAdded   = countDealsAddedOvernight(overnightDeals, now);
    const botSummary   = summarizeBotRuns(botLogs);
    const commissions  = calcCommissionsEarned(clicks);
    const networks     = checkNetworkStatus(AFFILIATE_NETWORKS);
    const issues       = detectIssues({ botSummary, dealsAdded, commissions });

    log.log(`Summary — deals:${dealsAdded}, bots ran:${botSummary.ran}, failed:${botSummary.failed}, commission:$${commissions.totalCommission}`);

    // 3. בנה דוח
    const date   = now.toISOString().split('T')[0];
    const report = buildDailyReport({ date, dealsAdded, botSummary, commissions, issues, networks });

    // 4. שמור + שלח
    await saveReport(report, dealsAdded, botSummary.ran, botSummary.failed, commissions.totalCommission, issues);
    const sent = await sendTelegram(report);

    log.log(`Report ${sent ? 'sent to Telegram' : 'saved (Telegram not configured)'}`);
    if (issues.length > 0) log.warn(`Issues: ${issues.join(' | ')}`);

  } catch (e) {
    log.error(`BOT-72 error: ${e.message}`);
    runStats.errors.push(e.message);
  } finally {
    try { if (logId) await logFinish(logId, runStats); } catch {}
  }
}

// ════════════════════════════════════════════════════════════
// Entry point
// ════════════════════════════════════════════════════════════

if (process.env.NODE_ENV !== 'test') {
  main().catch(e => { log.error(e.message); process.exit(1); });
}
