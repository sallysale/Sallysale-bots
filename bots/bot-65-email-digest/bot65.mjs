// ════════════════════════════════════════════════════════════
// BOT-65 — Email Digest (Personalized)
// תפקיד: שולח weekly email digests מותאמים אישית לפי העדפות
//         קטגוריות ו-wishlist של כל משתמש.
//
// הבדל מ-BOT-36: BOT-36 שולח daily top-10 לכולם.
//                BOT-65 שולח weekly מותאם לפי preferences.
//
// לוגיקה:
//   1. שולף email_subscribers עם preferences
//   2. לכל משתמש — מוצא דילים מתאימים (score >= 60)
//   3. מדרג לפי: category match(40%) + score(40%) + freshness(20%)
//   4. מייצר HTML email מותאם
//   5. שולח דרך Resend
//   6. מקסימום 500 לריצה
//
// תדירות: כל שני 09:00 UTC (Railway cron: 0 9 * * 1)
//
// Env vars:
//   RESEND_API_KEY  — מ-resend.com
//   FROM_EMAIL      — hello@sallysale.com
//   SITE_URL        — https://sallysale.com
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID         = 'BOT-65';
const RESEND_API     = 'https://api.resend.com/emails';
const MAX_PER_RUN    = 500;
const DEFAULT_TOP_N  = 10;
const MIN_SCORE      = 60;
const DELAY_BETWEEN  = 200; // ms
const FROM_EMAIL     = process.env.FROM_EMAIL    || 'hello@sallysale.com';
const FROM_NAME      = 'SallySale';
const RESEND_KEY     = process.env.RESEND_API_KEY || '';
const SITE_URL       = process.env.SITE_URL      || 'https://sallysale.com';

const log = createLogger(BOT_ID);
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — export לבדיקות
// ════════════════════════════════════════════════════════════

/**
 * matchDealsToUser — מסנן דילים לפי העדפות קטגוריות של המשתמש.
 * אם אין העדפות — כל הדילים מתאימים.
 * @param {Array<object>} deals
 * @param {{ preferred_categories?: string[], min_discount?: number }} userPrefs
 * @returns {Array<object>}
 */
export function matchDealsToUser(deals, userPrefs) {
  if (!deals || deals.length === 0) return [];
  if (!userPrefs) return deals;

  const cats     = userPrefs.preferred_categories || [];
  const minDisc  = userPrefs.min_discount ?? 0;

  if (cats.length === 0 && minDisc === 0) return deals;

  return deals.filter(deal => {
    // Category match (case-insensitive)
    const catMatch = cats.length === 0
      || cats.some(c => c.toLowerCase() === (deal.category || '').toLowerCase());

    // Discount threshold
    const discMatch = minDisc === 0 || (deal.discount || 0) >= minDisc;

    return catMatch && discMatch;
  });
}

/**
 * rankDealsForUser — מדרג דילים לפי score מורכב.
 * category match: 40%, score: 40%, freshness: 20%
 * @param {Array<object>} deals
 * @param {{ preferred_categories?: string[] }} userPrefs
 * @returns {Array<object>} — ממויין מהגבוה לנמוך
 */
export function rankDealsForUser(deals, userPrefs) {
  if (!deals || deals.length === 0) return [];

  const cats     = (userPrefs?.preferred_categories || []).map(c => c.toLowerCase());
  const now      = Date.now();

  return [...deals].sort((a, b) => {
    const scoreA = computeUserScore(a, cats, now);
    const scoreB = computeUserScore(b, cats, now);
    return scoreB - scoreA;
  });
}

function computeUserScore(deal, cats, now) {
  // Category match: 40 points
  const catMatch = cats.length === 0
    || cats.includes((deal.category || '').toLowerCase());
  const catScore = catMatch ? 40 : 0;

  // Deal score: normalized 0-40
  const dealScore = Math.min(40, ((deal.score || 0) / 100) * 40);

  // Freshness: 20 points — newer = more points (within 7 days)
  const createdAt    = deal.created_at ? new Date(deal.created_at).getTime() : 0;
  const ageMs        = createdAt ? now - createdAt : Infinity;
  const ageDays      = ageMs / (1000 * 60 * 60 * 24);
  const freshScore   = ageDays <= 7 ? Math.max(0, 20 * (1 - ageDays / 7)) : 0;

  return catScore + dealScore + freshScore;
}

/**
 * buildPersonalizedDigest — מחזיר top N דילים מותאמים למשתמש.
 * @param {object} user
 * @param {Array<object>} deals
 * @param {number} topN
 * @returns {Array<object>}
 */
export function buildPersonalizedDigest(user, deals, topN = DEFAULT_TOP_N) {
  if (!deals || deals.length === 0) return [];
  const matched = matchDealsToUser(deals, user);
  const ranked  = rankDealsForUser(matched, user);
  return ranked.slice(0, topN);
}

/**
 * generateDigestSubject — subject line מותאם.
 * "Your weekly SallySale picks — Nike 40% OFF + 9 more deals"
 * @param {object} user
 * @param {object|null} topDeal
 * @returns {string}
 */
export function generateDigestSubject(user, topDeal) {
  const name = user?.name || 'Shopper';

  if (!topDeal) {
    return `\ud83d\udd25 Your weekly SallySale picks are here, ${name}!`;
  }

  const title = topDeal.title?.substring(0, 40) || 'top deals';
  const disc  = topDeal.discount && topDeal.discount >= 10
    ? `${Math.round(topDeal.discount)}% OFF`
    : 'great price';

  return `\ud83d\udd25 Your weekly SallySale picks — ${title} ${disc} + more deals`;
}

/**
 * formatDigestHtml — HTML email מותאם עם deal cards.
 * @param {object} user
 * @param {Array<object>} deals
 * @param {string} siteUrl
 * @returns {string}
 */
export function formatDigestHtml(user, deals, siteUrl = SITE_URL) {
  const name      = user?.name || 'Shopper';
  const unsubUrl  = `${siteUrl}/unsubscribe`;
  const allDeals  = `${siteUrl}/deals`;

  const rows = deals.map((deal, i) => {
    const sym       = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', ILS: '\u20aa' }[deal.currency || 'USD'] || '$';
    const disc      = deal.discount && deal.discount >= 10 ? `${Math.round(deal.discount)}% OFF` : '';
    const priceStr  = deal.price ? `${sym}${deal.price}` : '';
    const origStr   = deal.original_price && deal.original_price > (deal.price || 0)
      ? `${sym}${deal.original_price}` : '';
    const url       = deal.seo_slug ? `${siteUrl}/deals/${deal.seo_slug}` : siteUrl;
    const imgBlock  = deal.image_url
      ? `<img src="${deal.image_url}" alt="${deal.title}" style="width:64px;height:64px;object-fit:contain;border-radius:6px;vertical-align:middle;margin-right:12px" />`
      : '';

    return `
  <tr>
    <td style="padding:14px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top;width:24px;color:#aaa;font-size:13px;font-weight:700">#${i + 1}</td>
    <td style="padding:14px 8px;border-bottom:1px solid #f0f0f0;vertical-align:middle">
      <div style="display:flex;align-items:center">
        ${imgBlock}
        <div>
          <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:3px">${(deal.title || '').substring(0, 80)}</div>
          <div style="font-size:12px;color:#888">${deal.store_name || ''}${disc ? ` &middot; <span style="color:#e44c4c;font-weight:600">${disc}</span>` : ''}</div>
          <div style="margin-top:6px">
            ${priceStr ? `<span style="font-size:15px;font-weight:700;color:#22c55e">${priceStr}</span>` : ''}
            ${origStr  ? `<span style="font-size:12px;color:#bbb;text-decoration:line-through;margin-left:6px">${origStr}</span>` : ''}
          </div>
          <a href="${url}" style="display:inline-block;margin-top:8px;padding:5px 12px;background:#6366f1;color:#fff;text-decoration:none;border-radius:5px;font-size:12px;font-weight:500">View Deal \u2192</a>
        </div>
      </div>
    </td>
  </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Weekly SallySale Picks</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,&apos;Segoe UI&apos;,sans-serif">
  <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">\ud83d\udc8e SallySale</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px">Your Weekly Personalized Picks</div>
    </div>
    <div style="padding:24px 32px 12px">
      <p style="font-size:16px;color:#333;margin:0">Hi ${name}! \ud83d\udc4b</p>
      <p style="font-size:14px;color:#666;margin-top:8px">Here are this week&apos;s top ${deals.length} deals picked just for you.</p>
    </div>
    <div style="padding:0 32px">
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>
    <div style="padding:24px 32px;text-align:center">
      <a href="${allDeals}" style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">See All Deals \u2192</a>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="font-size:12px;color:#999;margin:0">SallySale \u2014 The Google of Sales \ud83c\udf0d</p>
      <p style="font-size:12px;color:#999;margin:4px 0 0"><a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * segmentUsers — מקבץ משתמשים לפי קטגוריה ראשית.
 * @param {Array<object>} users
 * @returns {Object<string, Array<object>>}
 */
export function segmentUsers(users) {
  if (!users || users.length === 0) return {};

  const segments = {};
  for (const user of users) {
    const cats = user.preferred_categories || [];
    const primary = cats.length > 0 ? cats[0].toLowerCase() : 'general';
    if (!segments[primary]) segments[primary] = [];
    segments[primary].push(user);
  }
  return segments;
}

/**
 * shouldSendDigest — האם לשלוח digest השבוע?
 * @param {object} user
 * @param {string|null} lastSentAt — ISO string
 * @param {Date} now
 * @returns {boolean}
 */
export function shouldSendDigest(user, lastSentAt, now = new Date()) {
  if (!lastSentAt) return true;

  const last    = new Date(lastSentAt);
  const diffMs  = now.getTime() - last.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Don't send if last digest was within the past 7 days
  return diffDays >= 7;
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
    errors:        stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchSubscribers() {
  const { data, error } = await supabase
    .from('email_subscribers')
    .select('id, email, name, preferred_categories, preferred_stores, min_discount, digest_frequency, last_weekly_digest_at, digest_count')
    .eq('active', true)
    .limit(MAX_PER_RUN);

  if (error) throw new Error(`fetchSubscribers: ${error.message}`);
  return data || [];
}

async function fetchActiveDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, currency, discount, score, store_name, seo_slug, category, image_url, created_at')
    .eq('status', 'active')
    .gte('score', MIN_SCORE)
    .order('score', { ascending: false })
    .limit(500);

  if (error) throw new Error(`fetchDeals: ${error.message}`);
  return data || [];
}

async function markSubscriberSent(subscriberId) {
  await supabase
    .from('email_subscribers')
    .update({
      last_weekly_digest_at: new Date().toISOString(),
      digest_count: supabase.rpc ? undefined : undefined, // increment handled separately
    })
    .eq('id', subscriberId);

  // Increment digest_count
  await supabase.rpc('increment_digest_count', { subscriber_id: subscriberId })
    .catch(() => {}); // Non-critical — ignore if RPC missing
}

async function sendEmailViaResend(toEmail, toName, subject, html) {
  if (!RESEND_KEY) return { ok: false, error: 'RESEND_API_KEY missing' };

  try {
    const to = toName ? [`${toName} <${toEmail}>`] : [toEmail];
    const res = await fetch(RESEND_API, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to,
        subject,
        html,
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
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`\ud83d\ude80 ${BOT_ID} — Personalized Email Digest`);

  if (!RESEND_KEY) {
    log.warn('RESEND_API_KEY חסר — לא שולח');
    return { sent: 0, updated: 0, errors: ['missing RESEND_API_KEY'] };
  }

  let logId;
  const stats = { sent: 0, skipped: 0, updated: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const [subscribers, deals] = await Promise.all([
      fetchSubscribers(),
      fetchActiveDeals(),
    ]);

    log.log(`\ud83d\udcca ${subscribers.length} subscribers, ${deals.length} deals`);

    const now = new Date();

    for (const sub of subscribers) {
      // Skip if already got digest this week
      if (!shouldSendDigest(sub, sub.last_weekly_digest_at, now)) {
        stats.skipped++;
        continue;
      }

      // Skip non-weekly subscribers
      if (sub.digest_frequency && sub.digest_frequency !== 'weekly') {
        stats.skipped++;
        continue;
      }

      const topDeals  = buildPersonalizedDigest(sub, deals, DEFAULT_TOP_N);
      if (topDeals.length === 0) {
        stats.skipped++;
        continue;
      }

      const subject = generateDigestSubject(sub, topDeals[0]);
      const html    = formatDigestHtml(sub, topDeals);
      const result  = await sendEmailViaResend(sub.email, sub.name, subject, html);

      if (result.ok) {
        await markSubscriberSent(sub.id);
        stats.sent++;
        stats.updated += topDeals.length;
        log.ok(`\u2705 נשלח ל: ${sub.email} (${topDeals.length} deals)`);
      } else {
        stats.errors.push(`${sub.email}: ${result.error}`);
        log.warn(`\u26a0\ufe0f נכשל: ${sub.email} — ${result.error}`);
      }

      await sleep(DELAY_BETWEEN);
    }

    log.log(`\u2705 סיום: ${stats.sent} נשלחו, ${stats.skipped} דולגו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot65.mjs');
if (isMain) {
  main().catch(err => { console.error('\u274c BOT-65 crashed:', err); process.exit(1); });
}
