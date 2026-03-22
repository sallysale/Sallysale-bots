// ════════════════════════════════════════════════════════════
// BOT-44 — Alert Sender
// תפקיד: שולח התראות ירידת מחיר למשתמשים דרך Resend.com.
//         קורא wishlist_alerts עם status='pending' ושולח מייל.
//
// לוגיקה:
//   1. שולף pending alerts (join עם user email + deal)
//   2. בונה HTML email לכל התראה
//   3. שולח דרך Resend.com API
//   4. מעדכן status → 'sent' / 'failed'
//   5. מקסימום 200 מיילים להרצה (safety limit)
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
//
// Env vars:
//   RESEND_API_KEY  — מ-resend.com
//   FROM_EMAIL      — hello@sallysale.com
//   SITE_URL        — https://sallysale.com
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID          = 'BOT-44';
const RESEND_API      = 'https://api.resend.com/emails';
const MAX_PER_RUN     = 200;
const DELAY_BETWEEN_MS = 200;
const FROM_EMAIL      = process.env.FROM_EMAIL  || 'hello@sallysale.com';
const FROM_NAME       = 'SallySale';
const RESEND_KEY      = process.env.RESEND_API_KEY || '';
const SITE_URL        = process.env.SITE_URL || 'https://sallysale.com';

const log = createLogger(BOT_ID);
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * getCurrencySymbol — מחזיר סמל מטבע.
 * @param {string} currency
 * @returns {string}
 */
export function getCurrencySymbol(currency) {
  const map = {
    USD: '$', EUR: '€', GBP: '£', ILS: '₪', JPY: '¥',
    CAD: 'CA$', AUD: 'A$', CHF: 'CHF', SEK: 'kr', NOK: 'kr',
    DKK: 'kr', PLN: 'zł', CZK: 'Kč', HUF: 'Ft', CNY: '¥',
  };
  return map[currency] || currency || '$';
}

/**
 * formatSavings — מחרוזת תצוגה לחיסכון.
 * @param {number} oldPrice
 * @param {number} newPrice
 * @param {string} currency
 * @returns {string}
 */
export function formatSavings(oldPrice, newPrice, currency = 'USD') {
  const sym  = getCurrencySymbol(currency);
  if (
    typeof oldPrice !== 'number' || typeof newPrice !== 'number' ||
    oldPrice <= 0 || newPrice < 0
  ) return `${sym}0 saved`;

  const saved = oldPrice - newPrice;
  if (saved <= 0) return `${sym}0 saved`;

  const pct = Math.round((saved / oldPrice) * 100);
  return `Save ${sym}${saved.toFixed(2)} (${pct}% off)`;
}

/**
 * buildAlertSubject — subject line למייל התראה.
 * @param {object} deal
 * @param {number} savingsPct
 * @returns {string}
 */
export function buildAlertSubject(deal, savingsPct) {
  const title = deal?.title || 'a deal on your wishlist';
  const short = title.substring(0, 50);
  if (savingsPct && savingsPct > 0) {
    return `🔔 Price dropped ${savingsPct}% on ${short}`;
  }
  return `🔔 Price dropped on ${short}`;
}

/**
 * buildEmailRecipient — פורמט נמען ל-Resend.
 * @param {string} email
 * @param {string|null} name
 * @returns {string}
 */
export function buildEmailRecipient(email, name) {
  if (name && name.trim()) return `${name.trim()} <${email}>`;
  return email;
}

/**
 * shouldSendEmail — בדוק אם ה-alert כשיר לשליחה.
 * @param {object} alert
 * @returns {boolean}
 */
export function shouldSendEmail(alert) {
  if (!alert) return false;
  return alert.status === 'pending';
}

/**
 * buildAlertEmailHtml — HTML מלא של מייל התראה.
 * @param {object} alert  — { old_price, new_price, savings_pct, alert_type }
 * @param {object} deal   — { title, seo_slug, store_name, image_url, currency }
 * @param {string} siteUrl
 * @returns {string}
 */
export function buildAlertEmailHtml(alert, deal, siteUrl = SITE_URL) {
  const currency   = deal?.currency || 'USD';
  const sym        = getCurrencySymbol(currency);
  const title      = deal?.title || 'Deal on your wishlist';
  const storeName  = deal?.store_name || '';
  const slug       = deal?.seo_slug;
  const dealUrl    = slug ? `${siteUrl}/deals/${slug}` : siteUrl;
  const unsubUrl   = `${siteUrl}/unsubscribe`;
  const imageUrl   = deal?.image_url || '';

  const oldPriceStr  = alert?.old_price ? `${sym}${Number(alert.old_price).toFixed(2)}` : '';
  const newPriceStr  = alert?.new_price != null ? `${sym}${Number(alert.new_price).toFixed(2)}` : '';
  const savingsStr   = formatSavings(
    Number(alert?.old_price || 0),
    Number(alert?.new_price || 0),
    currency
  );

  const alertTypeLabel = alert?.alert_type === 'below_target'
    ? 'Reached your target price!'
    : 'Price dropped!';

  const imageBlock = imageUrl
    ? `<div style="text-align:center;padding:16px 32px 0"><img src="${imageUrl}" alt="${title}" style="max-width:200px;max-height:200px;object-fit:contain;border-radius:8px" /></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Price Alert — SallySale</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">💎 SallySale</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">Wishlist Price Alert</div>
    </div>
    <!-- Alert headline -->
    <div style="padding:24px 32px 16px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:#1a1a1a">${alertTypeLabel}</div>
      <div style="font-size:15px;color:#555;margin-top:6px">${title.substring(0, 80)}</div>
      ${storeName ? `<div style="font-size:13px;color:#999;margin-top:4px">${storeName}</div>` : ''}
    </div>
    ${imageBlock}
    <!-- Price block -->
    <div style="padding:20px 32px;text-align:center;background:#f9fafb;margin:0 24px;border-radius:10px">
      ${oldPriceStr
        ? `<div style="font-size:16px;color:#999;text-decoration:line-through;margin-bottom:6px">${oldPriceStr}</div>`
        : ''}
      ${newPriceStr
        ? `<div style="font-size:32px;font-weight:800;color:#22c55e">${newPriceStr}</div>`
        : ''}
      <div style="font-size:14px;color:#f59e0b;font-weight:600;margin-top:8px">${savingsStr}</div>
    </div>
    <!-- CTA -->
    <div style="padding:28px 32px;text-align:center">
      <a href="${dealUrl}" style="display:inline-block;padding:14px 32px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600">View Deal →</a>
    </div>
    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:12px;color:#999;margin:0">SallySale — The Google of Sales 🌍</p>
      <p style="font-size:12px;color:#999;margin:4px 0 0">
        You received this because you added this deal to your wishlist.
        <a href="${unsubUrl}" style="color:#999">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * buildAlertEmailText — plain text fallback.
 * @param {object} alert
 * @param {object} deal
 * @param {string} siteUrl
 * @returns {string}
 */
export function buildAlertEmailText(alert, deal, siteUrl = SITE_URL) {
  const currency  = deal?.currency || 'USD';
  const sym       = getCurrencySymbol(currency);
  const title     = deal?.title || 'Deal on your wishlist';
  const slug      = deal?.seo_slug;
  const dealUrl   = slug ? `${siteUrl}/deals/${slug}` : siteUrl;

  const oldStr = alert?.old_price ? `${sym}${Number(alert.old_price).toFixed(2)}` : '';
  const newStr = alert?.new_price != null ? `${sym}${Number(alert.new_price).toFixed(2)}` : '';
  const pct    = alert?.savings_pct ? `${alert.savings_pct}% off` : '';

  const lines = [
    'SallySale — Wishlist Price Alert',
    '================================',
    '',
    `Price dropped on: ${title}`,
  ];

  if (oldStr) lines.push(`Was: ${oldStr}`);
  if (newStr) lines.push(`Now: ${newStr}`);
  if (pct)    lines.push(`Savings: ${pct}`);

  lines.push('', `View deal: ${dealUrl}`, '', `© SallySale — ${siteUrl}/unsubscribe to unsubscribe`);

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
// Resend API
// ════════════════════════════════════════════════════════════

/**
 * sendAlertEmail — שולח מייל התראה יחיד דרך Resend.com.
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
async function sendAlertEmail(toEmail, toName, subject, html, text) {
  if (!RESEND_KEY) return { ok: false, error: 'RESEND_API_KEY חסר' };

  try {
    const res = await fetch(RESEND_API, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `${FROM_NAME} <${FROM_EMAIL}>`,
        to:      [buildEmailRecipient(toEmail, toName)],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.message || `HTTP ${res.status}` };
    return { ok: true, id: data.id };

  } catch (err) {
    return { ok: false, error: err.message };
  }
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
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchPendingAlerts() {
  // JOIN wishlist_alerts עם deals (ישיר), user email דרך auth.users (service role)
  const { data, error } = await supabase
    .from('wishlist_alerts')
    .select(`
      id,
      wishlist_id,
      user_id,
      deal_id,
      alert_type,
      old_price,
      new_price,
      savings_pct,
      status,
      created_at,
      deal:deals (
        id,
        title,
        price,
        original_price,
        currency,
        discount,
        score,
        seo_slug,
        store_name,
        image_url
      )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) throw new Error(`fetchPendingAlerts: ${error.message}`);
  return data || [];
}

async function fetchUserEmail(userId) {
  // service role מאפשר גישה ל-auth.users
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return { email: data.user.email, name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || null };
}

async function markAlertSent(alertId, resendId) {
  await supabase.from('wishlist_alerts').update({
    status:  'sent',
    sent_at: new Date().toISOString(),
  }).eq('id', alertId);
}

async function markAlertFailed(alertId, errorMsg) {
  await supabase.from('wishlist_alerts').update({
    status: 'failed',
  }).eq('id', alertId);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Alert Sender`);

  if (!RESEND_KEY) {
    log.warn('RESEND_API_KEY חסר — לא שולח');
    return { sent: 0, errors: ['missing RESEND_API_KEY'] };
  }

  let logId;
  const stats = { sent: 0, failed: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const alerts = await fetchPendingAlerts();
    log.log(`📬 ${alerts.length} התראות ממתינות`);

    for (const alert of alerts) {
      if (!shouldSendEmail(alert)) continue;

      const deal = alert.deal;
      if (!deal) {
        await markAlertFailed(alert.id, 'deal not found');
        stats.failed++;
        continue;
      }

      // שלוף email של המשתמש
      const userInfo = await fetchUserEmail(alert.user_id);
      if (!userInfo?.email) {
        log.warn(`⚠️ לא נמצא email ל-user ${alert.user_id}`);
        await markAlertFailed(alert.id, 'user email not found');
        stats.failed++;
        continue;
      }

      const subject = buildAlertSubject(deal, alert.savings_pct);
      const html    = buildAlertEmailHtml(alert, deal);
      const text    = buildAlertEmailText(alert, deal);

      const result = await sendAlertEmail(userInfo.email, userInfo.name, subject, html, text);

      if (result.ok) {
        await markAlertSent(alert.id, result.id);
        stats.sent++;
        log.ok(`✅ נשלח ל: ${userInfo.email} — ${deal.title?.substring(0, 40)}`);
      } else {
        await markAlertFailed(alert.id, result.error);
        stats.failed++;
        stats.errors.push(`${userInfo.email}: ${result.error}`);
        log.warn(`⚠️ נכשל: ${userInfo.email} — ${result.error}`);
      }

      await sleep(DELAY_BETWEEN_MS);
    }

    log.log(`✅ סיום: ${stats.sent} נשלחו, ${stats.failed} נכשלו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot44.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-44 crashed:', err); process.exit(1); });
}
