// ════════════════════════════════════════════════════════════
// BOT-46 — Abandonment Bot
// תפקיד: מזהה משתמשים שצפו בדיל אבל לא לחצו תוך 2 שעות,
//         ושולח להם מייל תזכורת דרך Resend.com.
//
// לוגיקה:
//   1. שולף רשומות מ-abandonment_log עם status='pending'
//      ו-viewed_at ישן מ-2 שעות (ללא clicked_at)
//   2. בדיקת cooldown — לא נשלח מייל ב-24 שעות האחרונות
//   3. בונה HTML email עם פרטי הדיל
//   4. שולח דרך Resend.com API
//   5. מעדכן abandonment_log עם email_sent_at + status='sent'
//   6. מקסימום 100 מיילים להרצה
//   7. מתעד ב-bots_log
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

const BOT_ID           = 'BOT-46';
const RESEND_API       = 'https://api.resend.com/emails';
const MAX_PER_RUN      = 100;
const ABANDON_THRESHOLD_MS = 2 * 60 * 60 * 1000;   // 2 hours
const COOLDOWN_HOURS   = 24;
const DELAY_BETWEEN_MS = 200;
const FROM_NAME        = 'SallySale';

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL     || 'hello@sallysale.com';
const SITE_URL   = process.env.SITE_URL       || 'https://sallysale.com';

const log = createLogger(BOT_ID);

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════
// פונקציות טהורות (מיוצאות לטסטים)
// ════════════════════════════════════════════════════════════

/**
 * isAbandoned — האם המשתמש "נטש" את הדיל.
 * @param {Date|string|null} viewedAt   — מתי צפה
 * @param {Date|string|null} clickedAt  — מתי לחץ (null = לא לחץ)
 * @param {number} thresholdMs          — סף זמן במילישניות (ברירת מחדל: 2 שעות)
 * @returns {boolean}
 */
export function isAbandoned(viewedAt, clickedAt, thresholdMs = ABANDON_THRESHOLD_MS) {
  if (!viewedAt) return false;
  if (clickedAt) return false;

  const viewed = viewedAt instanceof Date ? viewedAt : new Date(viewedAt);
  if (isNaN(viewed.getTime())) return false;

  return (Date.now() - viewed.getTime()) >= thresholdMs;
}

/**
 * shouldSkipUser — האם לדלג על המשתמש בגלל cooldown.
 * @param {Date|string|null} lastSentAt  — מתי נשלח מייל אחרון
 * @param {number} cooldownHours         — שעות cooldown (ברירת מחדל: 24)
 * @returns {boolean}
 */
export function shouldSkipUser(lastSentAt, cooldownHours = COOLDOWN_HOURS) {
  if (!lastSentAt) return false;

  const last = lastSentAt instanceof Date ? lastSentAt : new Date(lastSentAt);
  if (isNaN(last.getTime())) return false;

  const elapsedMs  = Date.now() - last.getTime();
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  return elapsedMs < cooldownMs;
}

/**
 * formatDealUrl — מחזיר URL מלא לדיל.
 * @param {string} dealId
 * @param {string} baseUrl
 * @returns {string}
 */
export function formatDealUrl(dealId, baseUrl = SITE_URL) {
  if (!dealId) return baseUrl;
  return `${baseUrl}/deals/${dealId}`;
}

/**
 * getSubjectLine — subject line למייל abandonment.
 * @param {string} dealTitle
 * @param {number|null} discount  — אחוז הנחה (e.g. 30)
 * @returns {string}
 */
export function getSubjectLine(dealTitle, discount) {
  const title = dealTitle ? dealTitle.substring(0, 50) : 'a deal you viewed';

  if (discount && Number(discount) > 0) {
    return `Still interested in ${title}? Price dropped ${Math.round(discount)}%!`;
  }
  return `Still interested in ${title}? Don't miss this deal!`;
}

/**
 * buildAbandonmentEmail — בונה { subject, html } למייל.
 * @param {object} user  — { email, name }
 * @param {object} deal  — { id, title, price, original_price, currency, discount, image_url, seo_slug, store_name }
 * @param {string} siteUrl
 * @returns {{ subject: string, html: string }}
 */
export function buildAbandonmentEmail(user, deal, siteUrl = SITE_URL) {
  const title     = deal?.title     || 'Deal you recently viewed';
  const discount  = deal?.discount  || null;
  const currency  = deal?.currency  || 'USD';
  const storeName = deal?.store_name || '';
  const imageUrl  = deal?.image_url  || '';

  // deal URL — prefer slug, fallback to id
  const slug      = deal?.seo_slug;
  const dealId    = deal?.id;
  const dealUrl   = slug
    ? `${siteUrl}/deals/${slug}`
    : dealId
      ? formatDealUrl(dealId, siteUrl)
      : siteUrl;

  const unsubUrl  = `${siteUrl}/unsubscribe`;

  const subject   = getSubjectLine(title, discount);

  const sym = getCurrencySymbol(currency);
  const currentPrice  = deal?.price          != null ? `${sym}${Number(deal.price).toFixed(2)}`          : null;
  const originalPrice = deal?.original_price != null ? `${sym}${Number(deal.original_price).toFixed(2)}` : null;
  const discountBadge = discount && Number(discount) > 0 ? `${Math.round(discount)}% OFF` : null;

  const imageBlock = imageUrl
    ? `<div style="text-align:center;padding:16px 32px 0"><img src="${imageUrl}" alt="${title}" style="max-width:220px;max-height:220px;object-fit:contain;border-radius:8px" /></div>`
    : '';

  const priceBlock = currentPrice ? `
    <div style="padding:20px 32px;text-align:center;background:#f9fafb;margin:0 24px;border-radius:10px">
      ${originalPrice ? `<div style="font-size:15px;color:#999;text-decoration:line-through;margin-bottom:6px">${originalPrice}</div>` : ''}
      <div style="font-size:32px;font-weight:800;color:#22c55e">${currentPrice}</div>
      ${discountBadge ? `<div style="display:inline-block;background:#f59e0b;color:#fff;font-size:13px;font-weight:700;padding:4px 10px;border-radius:20px;margin-top:8px">${discountBadge}</div>` : ''}
    </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>You left something behind — SallySale</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:28px 32px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">💎 SallySale</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.9);margin-top:4px">You left something behind!</div>
    </div>
    <!-- Headline -->
    <div style="padding:24px 32px 16px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:#1a1a1a">Still thinking about it?</div>
      <div style="font-size:15px;color:#555;margin-top:8px">${title.substring(0, 80)}</div>
      ${storeName ? `<div style="font-size:13px;color:#999;margin-top:4px">${storeName}</div>` : ''}
    </div>
    ${imageBlock}
    ${priceBlock}
    <!-- CTA -->
    <div style="padding:28px 32px;text-align:center">
      <a href="${dealUrl}" style="display:inline-block;padding:14px 36px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:700">Grab the deal →</a>
    </div>
    <!-- Urgency note -->
    <div style="padding:0 32px 20px;text-align:center">
      <p style="font-size:13px;color:#ef4444;margin:0;font-weight:600">⚡ Sales don't last forever — deals can expire anytime.</p>
    </div>
    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:12px;color:#999;margin:0">SallySale — The Google of Sales 🌍</p>
      <p style="font-size:12px;color:#999;margin:4px 0 0">
        You received this because you viewed a deal on SallySale.
        <a href="${unsubUrl}" style="color:#999">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

// ════════════════════════════════════════════════════════════
// Currency helper (shared)
// ════════════════════════════════════════════════════════════

function getCurrencySymbol(currency) {
  const map = {
    USD: '$', EUR: '€', GBP: '£', ILS: '₪', JPY: '¥',
    CAD: 'CA$', AUD: 'A$', CHF: 'CHF', SEK: 'kr', NOK: 'kr',
    DKK: 'kr', PLN: 'zł', CNY: '¥',
  };
  return map[currency] || currency || '$';
}

// ════════════════════════════════════════════════════════════
// Resend API
// ════════════════════════════════════════════════════════════

async function sendAbandonmentEmail(toEmail, toName, subject, html) {
  if (!RESEND_KEY) return { ok: false, error: 'RESEND_API_KEY missing' };

  const to = toName && toName.trim()
    ? `${toName.trim()} <${toEmail}>`
    : toEmail;

  try {
    const res = await fetch(RESEND_API, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `${FROM_NAME} <${FROM_EMAIL}>`,
        to:      [to],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
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

async function logFinish(logId, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.sent || 0,
    errors:        stats.errors || [],
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

/**
 * fetchAbandonedCandidates — רשומות abandonment_log שמוכנות לשליחה.
 * viewed_at ישן מ-2 שעות, clicked_at = null, status = 'pending'
 */
async function fetchAbandonedCandidates() {
  const cutoff = new Date(Date.now() - ABANDON_THRESHOLD_MS).toISOString();

  const { data, error } = await supabase
    .from('abandonment_log')
    .select(`
      id,
      user_id,
      deal_id,
      viewed_at,
      clicked_at,
      email_sent_at,
      email_status,
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
    .eq('email_status', 'pending')
    .is('clicked_at', null)
    .lt('viewed_at', cutoff)
    .order('viewed_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) throw new Error(`fetchAbandonedCandidates: ${error.message}`);
  return data || [];
}

async function fetchUserEmail(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  const name = data.user.user_metadata?.full_name
    || data.user.email?.split('@')[0]
    || null;
  return { email: data.user.email, name };
}

async function markEmailSent(logId) {
  await supabase.from('abandonment_log').update({
    email_sent_at: new Date().toISOString(),
    email_status:  'sent',
  }).eq('id', logId);
}

async function markEmailSkipped(logId) {
  await supabase.from('abandonment_log').update({
    email_status: 'skipped',
  }).eq('id', logId);
}

/** fetchLastSentAt — מתי נשלח מייל abandonment אחרון למשתמש זה */
async function fetchLastSentAt(userId) {
  const { data } = await supabase
    .from('abandonment_log')
    .select('email_sent_at')
    .eq('user_id', userId)
    .eq('email_status', 'sent')
    .order('email_sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.email_sent_at || null;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log('Starting BOT-46 — Abandonment Bot');

  if (!RESEND_KEY) {
    log.warn('RESEND_API_KEY missing — skipping email sends');
  }

  let logId;
  const stats = { sent: 0, skipped: 0, failed: 0, errors: [] };

  try {
    logId = await logStart();
  } catch (e) {
    log.warn(`bots_log start: ${e.message}`);
  }

  try {
    const candidates = await fetchAbandonedCandidates();
    log.log(`Found ${candidates.length} abandonment candidates`);

    for (const row of candidates) {
      const deal = row.deal;
      if (!deal) {
        await markEmailSkipped(row.id);
        stats.skipped++;
        continue;
      }

      // cooldown check
      const lastSentAt = await fetchLastSentAt(row.user_id);
      if (shouldSkipUser(lastSentAt, COOLDOWN_HOURS)) {
        await markEmailSkipped(row.id);
        stats.skipped++;
        log.log(`Cooldown active for user ${row.user_id} — skipping`);
        continue;
      }

      // confirm still abandoned
      if (!isAbandoned(row.viewed_at, row.clicked_at, ABANDON_THRESHOLD_MS)) {
        await markEmailSkipped(row.id);
        stats.skipped++;
        continue;
      }

      // get user email
      const userInfo = await fetchUserEmail(row.user_id);
      if (!userInfo?.email) {
        log.warn(`No email for user ${row.user_id}`);
        await markEmailSkipped(row.id);
        stats.skipped++;
        continue;
      }

      const { subject, html } = buildAbandonmentEmail(userInfo, deal, SITE_URL);
      const result = await sendAbandonmentEmail(userInfo.email, userInfo.name, subject, html);

      if (result.ok) {
        await markEmailSent(row.id);
        stats.sent++;
        log.ok(`Sent to ${userInfo.email} — ${deal.title?.substring(0, 40)}`);
      } else {
        stats.failed++;
        stats.errors.push(`${userInfo.email}: ${result.error}`);
        log.warn(`Failed ${userInfo.email} — ${result.error}`);
      }

      await sleep(DELAY_BETWEEN_MS);
    }

    log.ok(`Done — sent: ${stats.sent}, skipped: ${stats.skipped}, failed: ${stats.failed}`);

  } catch (err) {
    log.err(err.message);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot46.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-46 crashed:', err); process.exit(1); });
}
