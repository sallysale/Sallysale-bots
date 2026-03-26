// ════════════════════════════════════════════════════════════
// BOT-38 — Click Fraud Detector
// תפקיד: מזהה דפוסי קליקים חשודים ומסמן כהונאה.
//
// כללי זיהוי (חלון של שעה):
//   1. אותו IP > 10 קליקים על אותו דיל  → fraud
//   2. אותו IP > 30 קליקים סה"כ          → suspicious IP
//   3. אותו user_id > 20 קליקים           → suspicious user
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (מ-shared)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-38';
const log     = createLogger(BOT_ID);

export const MAX_CLICKS_PER_IP_PER_DEAL = 10;
export const MAX_CLICKS_PER_IP_TOTAL    = 30;
export const MAX_CLICKS_PER_USER        = 20;
export const FRAUD_WINDOW_MS            = 60 * 60 * 1000; // 1 hour

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * isFraudByIpDeal — IP קלק על אותו דיל יותר מ-MAX פעמים בחלון.
 * @param {Array<object>} clicks  — כל הקליקים
 * @param {string} ip
 * @param {string} dealId
 * @param {number} windowMs
 * @returns {boolean}
 */
export function isFraudByIpDeal(clicks, ip, dealId, windowMs = FRAUD_WINDOW_MS) {
  const cutoff = Date.now() - windowMs;
  const matching = clicks.filter(c =>
    c.ip_address === ip &&
    c.deal_id === dealId &&
    new Date(c.clicked_at).getTime() >= cutoff
  );
  return matching.length > MAX_CLICKS_PER_IP_PER_DEAL;
}

/**
 * isFraudByIpTotal — IP קלק יותר מ-MAX פעמים סה"כ בחלון.
 * @param {Array<object>} clicks
 * @param {string} ip
 * @param {number} windowMs
 * @returns {boolean}
 */
export function isFraudByIpTotal(clicks, ip, windowMs = FRAUD_WINDOW_MS) {
  const cutoff = Date.now() - windowMs;
  const matching = clicks.filter(c =>
    c.ip_address === ip &&
    new Date(c.clicked_at).getTime() >= cutoff
  );
  return matching.length > MAX_CLICKS_PER_IP_TOTAL;
}

/**
 * isFraudByUser — user קלק יותר מ-MAX פעמים בחלון.
 * @param {Array<object>} clicks
 * @param {string} userId
 * @param {number} windowMs
 * @returns {boolean}
 */
export function isFraudByUser(clicks, userId, windowMs = FRAUD_WINDOW_MS) {
  if (!userId) return false;
  const cutoff = Date.now() - windowMs;
  const matching = clicks.filter(c =>
    c.user_id === userId &&
    new Date(c.clicked_at).getTime() >= cutoff
  );
  return matching.length > MAX_CLICKS_PER_USER;
}

/**
 * detectFraudReasons — מחזיר רשימת סיבות לחשד עבור קליק מסוים.
 * @param {object} click         — הקליק הנבדק
 * @param {Array<object>} allClicks — כל הקליקים בחלון
 * @param {number} windowMs
 * @returns {string[]}
 */
export function detectFraudReasons(click, allClicks, windowMs = FRAUD_WINDOW_MS) {
  const reasons = [];

  if (click.ip_address && click.deal_id) {
    if (isFraudByIpDeal(allClicks, click.ip_address, click.deal_id, windowMs)) {
      reasons.push(`ip_deal_exceeded: >${MAX_CLICKS_PER_IP_PER_DEAL} clicks from ${click.ip_address} on deal ${click.deal_id}`);
    }
  }

  if (click.ip_address) {
    if (isFraudByIpTotal(allClicks, click.ip_address, windowMs)) {
      reasons.push(`ip_total_exceeded: >${MAX_CLICKS_PER_IP_TOTAL} total clicks from ${click.ip_address}`);
    }
  }

  if (click.user_id) {
    if (isFraudByUser(allClicks, click.user_id, windowMs)) {
      reasons.push(`user_exceeded: >${MAX_CLICKS_PER_USER} clicks by user ${click.user_id}`);
    }
  }

  return reasons;
}

/**
 * groupClicksByIpDeal — מקבץ קליקים לפי "ip:dealId".
 * @param {Array<object>} clicks
 * @returns {Map<string, Array<object>>}
 */
export function groupClicksByIpDeal(clicks) {
  const map = new Map();
  for (const click of clicks) {
    const key = `${click.ip_address || ''}:${click.deal_id || ''}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(click);
  }
  return map;
}

/**
 * scoreClickSuspicion — ציון חשד 0-100 עבור קליק.
 * @param {object} click
 * @param {Array<object>} allClicks
 * @param {number} windowMs
 * @returns {number}
 */
export function scoreClickSuspicion(click, allClicks, windowMs = FRAUD_WINDOW_MS) {
  let score = 0;
  const cutoff = Date.now() - windowMs;

  // קליקים מה-IP על אותו דיל
  if (click.ip_address && click.deal_id) {
    const count = allClicks.filter(c =>
      c.ip_address === click.ip_address &&
      c.deal_id === click.deal_id &&
      new Date(c.clicked_at).getTime() >= cutoff
    ).length;
    score += Math.min(50, Math.floor((count / MAX_CLICKS_PER_IP_PER_DEAL) * 50));
  }

  // קליקים מה-IP סה"כ
  if (click.ip_address) {
    const total = allClicks.filter(c =>
      c.ip_address === click.ip_address &&
      new Date(c.clicked_at).getTime() >= cutoff
    ).length;
    score += Math.min(30, Math.floor((total / MAX_CLICKS_PER_IP_TOTAL) * 30));
  }

  // קליקים מהמשתמש
  if (click.user_id) {
    const userCount = allClicks.filter(c =>
      c.user_id === click.user_id &&
      new Date(c.clicked_at).getTime() >= cutoff
    ).length;
    score += Math.min(20, Math.floor((userCount / MAX_CLICKS_PER_USER) * 20));
  }

  return Math.min(100, score);
}

/**
 * formatFraudSummary — סיכום פעולת הbот.
 * @param {number} fraudCount
 * @param {number} totalChecked
 * @returns {string}
 */
export function formatFraudSummary(fraudCount, totalChecked) {
  const pct = totalChecked > 0 ? ((fraudCount / totalChecked) * 100).toFixed(1) : '0.0';
  return `Fraud detected: ${fraudCount}/${totalChecked} clicks (${pct}%)`;
}

// ════════════════════════════════════════════════════════════
// DB functions
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
    deals_updated: stats.flagged,
    errors:        stats.errors,
  }).eq('id', logId);
}

async function fetchRecentClicks() {
  const since = new Date(Date.now() - FRAUD_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('click_log')
    .select('id, deal_id, user_id, ip_address, clicked_at, is_fraud, suspicion_score')
    .gte('clicked_at', since)
    .order('clicked_at', { ascending: false });

  if (error) throw new Error(`fetchRecentClicks: ${error.message}`);
  return data || [];
}

async function markFraud(clickIds, reason, score) {
  if (clickIds.length === 0) return;

  const { error } = await supabase
    .from('click_log')
    .update({
      is_fraud:         true,
      fraud_reason:     reason,
      suspicion_score:  score,
    })
    .in('id', clickIds);

  if (error) throw new Error(`markFraud: ${error.message}`);
}

async function updateDealSuspiciousCount(dealIds) {
  for (const dealId of dealIds) {
    const { count, error } = await supabase
      .from('click_log')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', dealId)
      .eq('is_fraud', true);

    if (error) { log.warn(`count error for deal ${dealId}: ${error.message}`); continue; }

    await supabase.from('deals')
      .update({
        suspicious_click_count: count || 0,
        last_fraud_check_at:    new Date().toISOString(),
      })
      .eq('id', dealId);
  }
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Click Fraud Detector`);

  let logId;
  const stats = { flagged: 0, checked: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const clicks = await fetchRecentClicks();
    log.log(`📊 בודק ${clicks.length} קליקים מהשעה האחרונה`);
    stats.checked = clicks.length;

    const fraudIds     = [];
    const affectedDeals = new Set();

    for (const click of clicks) {
      if (click.is_fraud) continue;  // כבר מסומן

      const reasons = detectFraudReasons(click, clicks);
      if (reasons.length > 0) {
        const score = scoreClickSuspicion(click, clicks);
        fraudIds.push({ id: click.id, reason: reasons[0], score });
        if (click.deal_id) affectedDeals.add(click.deal_id);
      }
    }

    if (fraudIds.length > 0) {
      // קבץ לפי reason+score לעדכון יעיל
      await markFraud(
        fraudIds.map(f => f.id),
        fraudIds[0].reason,
        fraudIds[0].score
      );
      stats.flagged = fraudIds.length;
      log.ok(`🚨 סומנו ${fraudIds.length} קליקים חשודים`);

      // עדכון ספירה על הדילים המושפעים
      await updateDealSuspiciousCount([...affectedDeals]);
    }

    log.log(formatFraudSummary(stats.flagged, stats.checked));

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot38.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-38 crashed:', err); process.exit(1); });
}
