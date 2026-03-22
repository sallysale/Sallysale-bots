// ════════════════════════════════════════════════════════════
// BOT-36 — Daily Digest
// תפקיד: שולח מייל יומי עם Top 10 deals לכל subscriber.
//         מייצר HTML email מעוצב ושולח דרך Resend.com API.
//
// לוגיקה:
//   1. שולף Top 10 deals לפי score
//   2. מייצר HTML email (responsive design)
//   3. שולח לכל subscriber פעיל דרך Resend
//   4. שומר לוג ב-email_queue
//
// תדירות: פעם ביום 08:00 UTC (Railway cron: 0 8 * * *)
//
// Env vars:
//   RESEND_API_KEY  — מ-resend.com
//   FROM_EMAIL      — hello@sallysale.com
//   FROM_NAME       — SallySale
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID       = 'BOT-36';
const TOP_N        = 10;
const RESEND_API   = 'https://api.resend.com/emails';
const FROM_EMAIL   = process.env.FROM_EMAIL   || 'hello@sallysale.com';
const FROM_NAME    = process.env.FROM_NAME    || 'SallySale';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const SITE_URL     = process.env.SITE_URL || 'https://sallysale.com';
const DELAY_BETWEEN = 200; // ms בין מיילים

const log = createLogger(BOT_ID);
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — יצירת מייל
// ════════════════════════════════════════════════════════════

/**
 * formatDealRow — שורת HTML לדיל בודד.
 * @param {object} deal
 * @param {number} rank
 * @returns {string}
 */
export function formatDealRow(deal, rank) {
  const { title = '', price, original_price, currency = 'USD', discount, store_name = '', seo_slug } = deal;
  const symbols = { USD: '$', EUR: '€', GBP: '£', ILS: '₪' };
  const sym = symbols[currency] || '$';

  const discLabel = discount && discount >= 10 ? `${Math.round(discount)}% OFF` : '';
  const priceStr  = price ? `${sym}${price}` : '';
  const origStr   = original_price && original_price > (price || 0) ? `${sym}${original_price}` : '';
  const url       = seo_slug ? `${SITE_URL}/deals/${seo_slug}` : SITE_URL;

  return `
  <tr>
    <td style="padding:12px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top;width:30px;color:#999;font-size:14px;font-weight:bold">#${rank}</td>
    <td style="padding:12px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top">
      <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:4px">${title.substring(0, 80)}</div>
      <div style="font-size:13px;color:#666;margin-bottom:6px">${store_name}${discLabel ? ` · <span style="color:#e44c4c;font-weight:600">${discLabel}</span>` : ''}</div>
      <div style="margin-bottom:8px">
        ${priceStr ? `<span style="font-size:16px;font-weight:700;color:#22c55e">${priceStr}</span>` : ''}
        ${origStr  ? `<span style="font-size:13px;color:#999;text-decoration:line-through;margin-left:8px">${origStr}</span>` : ''}
      </div>
      <a href="${url}" style="display:inline-block;padding:6px 14px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500">View Deal →</a>
    </td>
  </tr>`;
}

/**
 * buildEmailHtml — בונה HTML מלא של ה-email.
 * @param {Array<object>} deals
 * @param {string} recipientName
 * @param {string} date
 * @returns {string}
 */
export function buildEmailHtml(deals, recipientName = 'Shopper', date = '') {
  const dateStr = date || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const rows = deals.map((d, i) => formatDealRow(d, i + 1)).join('');
  const unsubUrl = `${SITE_URL}/unsubscribe`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SallySale Daily Deals</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">💎 SallySale</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">Your Daily Deal Digest</div>
    </div>
    <!-- Greeting -->
    <div style="padding:24px 32px 16px">
      <p style="font-size:16px;color:#333;margin:0">Hi ${recipientName}! 👋</p>
      <p style="font-size:14px;color:#666;margin-top:8px">Here are today&apos;s top ${deals.length} deals — ${dateStr}.</p>
    </div>
    <!-- Deals table -->
    <div style="padding:0 32px">
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>
    <!-- CTA -->
    <div style="padding:24px 32px;text-align:center">
      <a href="${SITE_URL}/deals" style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">See All Deals →</a>
    </div>
    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:12px;color:#999;margin:0">SallySale — The Google of Sales 🌍</p>
      <p style="font-size:12px;color:#999;margin:4px 0 0"><a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * buildEmailText — plain text fallback.
 * @param {Array<object>} deals
 * @returns {string}
 */
export function buildEmailText(deals) {
  const lines = deals.map((d, i) => {
    const disc = d.discount && d.discount >= 10 ? ` (${Math.round(d.discount)}% OFF)` : '';
    const price = d.price ? ` - $${d.price}` : '';
    return `${i + 1}. ${d.title}${disc}${price} at ${d.store_name || 'various stores'}`;
  });

  return [
    'SallySale — Daily Deal Digest',
    '================================',
    '',
    ...lines,
    '',
    `See all deals: ${SITE_URL}/deals`,
    '',
    '© SallySale',
  ].join('\n');
}

/**
 * buildEmailSubject — subject line.
 * @param {Array<object>} deals
 * @returns {string}
 */
export function buildEmailSubject(deals) {
  const topDeal = deals[0];
  if (!topDeal) return '🔥 Your SallySale Daily Digest is here!';

  const disc = topDeal.discount && topDeal.discount >= 10
    ? `${Math.round(topDeal.discount)}% off`
    : 'a great deal';
  const short = topDeal.title?.substring(0, 40) || 'top deals';
  return `🔥 ${disc} on ${short} + ${deals.length - 1} more deals today`;
}

// ════════════════════════════════════════════════════════════
// Resend API
// ════════════════════════════════════════════════════════════

/**
 * sendEmailViaResend — שולח מייל יחיד דרך Resend.com.
 * @param {string} toEmail
 * @param {string} toName
 * @param {string} subject
 * @param {string} html
 * @param {string} text
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
export async function sendEmailViaResend(toEmail, toName, subject, html, text) {
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
        to:      toName ? [`${toName} <${toEmail}>`] : [toEmail],
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
// bots_log + DB
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

async function fetchTopDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, currency, discount, score, store_name, seo_slug, category, image_url')
    .eq('status', 'active')
    .order('score', { ascending: false })
    .limit(TOP_N);
  if (error) throw new Error(`fetchDeals: ${error.message}`);
  return data || [];
}

async function fetchActiveSubscribers() {
  const { data, error } = await supabase
    .from('email_subscribers')
    .select('id, email, name')
    .eq('active', true);
  if (error) throw new Error(`fetchSubs: ${error.message}`);
  return data || [];
}

async function logEmailSent(toEmail, subject, status, resendId, errorMsg) {
  await supabase.from('email_queue').insert({
    to_email:   toEmail,
    subject,
    html_body:  '(sent)',
    email_type: 'digest',
    status,
    resend_id:  resendId || null,
    sent_at:    status === 'sent' ? new Date().toISOString() : null,
    error_msg:  errorMsg || null,
  });
}

async function markDealsInDigest(dealIds) {
  if (dealIds.length === 0) return;
  await supabase.from('deals')
    .update({ last_digest_at: new Date().toISOString() })
    .in('id', dealIds);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Daily Digest`);

  if (!RESEND_KEY) {
    log.warn('RESEND_API_KEY חסר — לא שולח');
    return { sent: 0, errors: ['missing RESEND_API_KEY'] };
  }

  let logId;
  const stats = { sent: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const deals       = await fetchTopDeals();
    const subscribers = await fetchActiveSubscribers();
    log.log(`📊 ${deals.length} deals, ${subscribers.length} subscribers`);

    if (deals.length === 0) {
      log.warn('אין דילים לשליחה');
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    const subject = buildEmailSubject(deals);
    const html    = buildEmailHtml(deals);
    const text    = buildEmailText(deals);

    for (const sub of subscribers) {
      const result = await sendEmailViaResend(sub.email, sub.name, subject, html, text);

      if (result.ok) {
        stats.sent++;
        await logEmailSent(sub.email, subject, 'sent', result.id, null);
        log.log(`✅ נשלח ל: ${sub.email}`);
      } else {
        stats.errors.push(`${sub.email}: ${result.error}`);
        await logEmailSent(sub.email, subject, 'failed', null, result.error);
        log.warn(`⚠️ נכשל: ${sub.email} — ${result.error}`);
      }

      await sleep(DELAY_BETWEEN);
    }

    await markDealsInDigest(deals.map(d => d.id));
    log.log(`✅ סיום: ${stats.sent} נשלחו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot36.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-36 crashed:', err); process.exit(1); });
}
