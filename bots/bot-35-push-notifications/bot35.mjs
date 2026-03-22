// ════════════════════════════════════════════════════════════
// BOT-35 — Push Notifications
// תפקיד: שולח Web Push לדילים עם ציון > 75.
//         משתמש ב-web-push (VAPID) לשליחת notifications.
//
// כללים:
//   • מקסימום 2 push notifications ביום (06:00–22:00 UTC)
//   • רק דילים שלא נשלחו עדיין (push_sent_at IS NULL)
//   • ציון ≥ 75
//   • מסנן subscriptions לא פעילות אוטומטית (410 Gone)
//
// Env vars:
//   VAPID_PUBLIC_KEY   — generate with: web-push generate-vapid-keys
//   VAPID_PRIVATE_KEY
//   VAPID_EMAIL        — mailto:hello@sallysale.com
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID         = 'BOT-35';
const MIN_SCORE      = 75;
const MAX_PER_DAY    = 2;
const SITE_URL       = process.env.SITE_URL || 'https://sallysale.com';
const VAPID_EMAIL    = process.env.VAPID_EMAIL    || 'mailto:hello@sallysale.com';
const VAPID_PUB      = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIV     = process.env.VAPID_PRIVATE_KEY || '';

const log = createLogger(BOT_ID);

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * buildPushPayload — בונה payload ל-web push notification.
 * @param {object} deal
 * @returns {object} — { title, body, icon, url, badge }
 */
export function buildPushPayload(deal) {
  if (!deal) return null;

  const { title = 'Deal Alert!', price, original_price, currency = 'USD', discount, store_name = '', seo_slug, score } = deal;
  const symbols = { USD: '$', EUR: '€', GBP: '£', ILS: '₪' };
  const sym = symbols[currency] || '$';

  const discLabel = discount && discount >= 10 ? `${Math.round(discount)}% OFF — ` : '';
  const shortTitle = `${discLabel}${title}`.substring(0, 50);

  let body = '';
  if (price) {
    body = `Only ${sym}${price}`;
    if (original_price && original_price > price) body += ` (was ${sym}${original_price})`;
    if (store_name) body += ` at ${store_name}`;
  } else {
    body = store_name ? `Available at ${store_name}` : 'New deal available!';
  }

  const url = seo_slug ? `${SITE_URL}/deals/${seo_slug}` : `${SITE_URL}/deals`;

  return {
    title: shortTitle,
    body:  body.substring(0, 120),
    icon:  `${SITE_URL}/icons/icon-192.png`,
    badge: `${SITE_URL}/icons/badge-72.png`,
    url,
    data: {
      deal_id: deal.id,
      score,
      url,
    },
  };
}

/**
 * countPushSentToday — כמה push notifications נשלחו היום.
 * @param {Array<{sent_at: string}>} logRows
 * @returns {number}
 */
export function countPushSentToday(logRows) {
  if (!Array.isArray(logRows)) return 0;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return logRows.filter(r => r.sent_at && new Date(r.sent_at) >= startOfDay).length;
}

/**
 * isWithinSendHours — בדוק שהשעה בין 06:00–22:00 UTC.
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isWithinSendHours(now = new Date()) {
  const hour = now.getUTCHours();
  return hour >= 6 && hour < 22;
}

/**
 * filterActiveSubscriptions — מסנן subscriptions פעילות.
 * @param {Array} subs
 * @returns {Array}
 */
export function filterActiveSubscriptions(subs) {
  if (!Array.isArray(subs)) return [];
  return subs.filter(s => s.active && s.endpoint && s.p256dh && s.auth_key);
}

/**
 * buildWebPushOptions — בונה את אובייקט ה-subscription לweb-push.
 * @param {object} sub — שורה מ-push_subscriptions
 * @returns {object}
 */
export function buildWebPushOptions(sub) {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth:   sub.auth_key,
    },
  };
}

/**
 * isValidVapidConfig — בדוק שה-VAPID config קיים.
 * @param {string} pub
 * @param {string} priv
 * @returns {boolean}
 */
export function isValidVapidConfig(pub, priv) {
  return Boolean(pub && priv && pub.length > 10 && priv.length > 10);
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
    deals_updated: stats.sent,
    errors:        stats.errors,
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB
// ════════════════════════════════════════════════════════════

async function fetchDealsForPush() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, currency, discount, score, store_name, seo_slug, category')
    .eq('status', 'active')
    .gte('score', MIN_SCORE)
    .is('push_sent_at', null)
    .order('score', { ascending: false })
    .limit(10);
  if (error) throw new Error(`fetchDeals: ${error.message}`);
  return data || [];
}

async function fetchActiveSubscriptions() {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key, active')
    .eq('active', true)
    .limit(10000);
  if (error) throw new Error(`fetchSubs: ${error.message}`);
  return data || [];
}

async function fetchTodayPushCount() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('push_log')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', startOfDay.toISOString());
  if (error) return 0;
  return count || 0;
}

async function markDealPushSent(dealId) {
  await supabase.from('deals')
    .update({ push_sent_at: new Date().toISOString() })
    .eq('id', dealId);
}

async function deactivateSubscription(subId) {
  await supabase.from('push_subscriptions')
    .update({ active: false })
    .eq('id', subId);
}

async function logPushSend(dealId, targeted, sent, failed) {
  await supabase.from('push_log').insert({
    deal_id:                dealId,
    subscriptions_targeted: targeted,
    subscriptions_sent:     sent,
    subscriptions_failed:   failed,
  });
}

// ════════════════════════════════════════════════════════════
// sendPushToSubscription — שולח push יחיד
// ════════════════════════════════════════════════════════════

async function sendPushToSubscription(webPush, subscription, payload) {
  try {
    await webPush.sendNotification(
      buildWebPushOptions(subscription),
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err) {
    // 410 Gone — subscription נמחקה על ידי הדפדפן
    if (err.statusCode === 410 || err.statusCode === 404) {
      return { ok: false, gone: true };
    }
    return { ok: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Push Notifications`);

  if (!isValidVapidConfig(VAPID_PUB, VAPID_PRIV)) {
    log.warn('VAPID keys חסרים — לא שולח');
    return { sent: 0, errors: ['missing VAPID keys'] };
  }

  if (!isWithinSendHours()) {
    log.log('מחוץ לשעות שליחה (06:00–22:00 UTC) — מדלג');
    return { sent: 0, errors: [] };
  }

  let logId;
  const stats = { sent: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    // בדוק מכסה יומית
    const sentToday = await fetchTodayPushCount();
    if (sentToday >= MAX_PER_DAY) {
      log.log(`✅ מכסה יומית הושגה (${sentToday}/${MAX_PER_DAY})`);
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    // טעינת web-push דינמית (לא חובה בטסטים)
    let webPush;
    try {
      webPush = (await import('web-push')).default;
      webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUB, VAPID_PRIV);
    } catch {
      log.warn('web-push לא מותקן — הרץ: npm install web-push');
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    const deals = await fetchDealsForPush();
    const subs  = filterActiveSubscriptions(await fetchActiveSubscriptions());
    log.log(`📋 ${deals.length} deals, ${subs.length} subscriptions`);

    const remaining = MAX_PER_DAY - sentToday;
    for (const deal of deals.slice(0, remaining)) {
      const payload = buildPushPayload(deal);
      let sent = 0, failed = 0, gone = 0;

      for (const sub of subs) {
        const result = await sendPushToSubscription(webPush, sub, payload);
        if (result.ok) {
          sent++;
        } else {
          failed++;
          if (result.gone) {
            gone++;
            await deactivateSubscription(sub.id);
          }
        }
        await sleep(50); // throttle קל
      }

      await markDealPushSent(deal.id);
      await logPushSend(deal.id, subs.length, sent, failed);
      stats.sent++;
      log.log(`✅ Push sent for deal ${deal.id}: ${sent} delivered, ${failed} failed, ${gone} deactivated`);
    }

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot35.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-35 crashed:', err); process.exit(1); });
}
