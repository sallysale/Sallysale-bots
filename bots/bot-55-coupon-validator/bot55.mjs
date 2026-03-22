// ════════════════════════════════════════════════════════════
// BOT-55 — Coupon Validator
// תפקיד: מאמת קופונים פעילים, שולף קופונים מדילים, שומר ב-coupons table.
//
// לוגיקה:
//   1. שולף קופונים מ-coupons שדורשים אימות (needs_validation=true או last_checked_at > 4h)
//   2. מאמת תוקף (expires_at, is_active, uses_remaining)
//   3. סורק דילים פעילים לחילוץ קוד קופון מהטקסט
//   4. מחשב ציון לכל קופון (0-100)
//   5. מעדכן deals: has_coupon, coupon_code
//   6. כותב ל-bots_log
//
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
//
// Env vars:
//   SUPABASE_URL        — מ-Supabase
//   SUPABASE_SERVICE_KEY — service role key
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID             = 'BOT-55';
const VALIDATION_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in ms
const MAX_DEALS_PER_RUN  = 500;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * normalizeCouponCode — ממיר קוד קופון לפורמט סטנדרטי.
 * uppercase, trim whitespace, מסיר תווים מיוחדים פרט למקף ותחתית.
 * @param {string} code
 * @returns {string}
 */
export function normalizeCouponCode(code) {
  if (!code || typeof code !== 'string') return '';
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, '');
}

/**
 * isCouponExpired — בודק אם קופון פג תוקף.
 * @param {string|Date|null} expiresAt — תאריך פקיעה (null = אין פקיעה)
 * @param {Date} [now] — תאריך נוכחי (ברירת מחדל: עכשיו)
 * @returns {boolean}
 */
export function isCouponExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return false; // no expiry = never expires
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (isNaN(expiry.getTime())) return false;
  return expiry < now;
}

/**
 * detectCouponInText — מחלץ קודי קופון מטקסט.
 * מזהה תבניות: 'code: XXX', 'coupon: XXX', 'use code XXX',
 *               'promo code XXX', 'discount code XXX'
 * @param {string} text
 * @returns {string[]} — מערך קודים (ריק אם לא נמצא)
 */
export function detectCouponInText(text) {
  if (!text || typeof text !== 'string') return [];

  // Patterns require either a colon separator, or a preceding keyword phrase.
  // The captured group must contain at least one digit or uppercase letter sequence
  // that looks like a real coupon (alphanumeric, not a plain word).
  const patterns = [
    /\bcode:\s*([A-Z0-9][A-Z0-9_\-]{2,29})/gi,          // "code: SAVE20"
    /\bcoupon:\s*([A-Z0-9][A-Z0-9_\-]{2,29})/gi,         // "coupon: SUMMER10"
    /\buse\s+code\s+([A-Z0-9][A-Z0-9_\-]{2,29})/gi,      // "use code SAVE20"
    /\bpromo\s+code\s+([A-Z0-9][A-Z0-9_\-]{2,29})/gi,    // "promo code FLASH50"
    /\bdiscount\s+code\s+([A-Z0-9][A-Z0-9_\-]{2,29})/gi, // "discount code EXTRA30"
    /\bvoucher\s+code\s+([A-Z0-9][A-Z0-9_\-]{2,29})/gi,  // "voucher code VC10"
    /\benter\s+code\s+([A-Z0-9][A-Z0-9_\-]{2,29})/gi,    // "enter code XYZ"
    /\bapply\s+code\s+([A-Z0-9][A-Z0-9_\-]{2,29})/gi,    // "apply code ABC"
  ];

  const found = new Set();
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const m of matches) {
      const code = normalizeCouponCode(m[1]);
      if (code.length >= 3) found.add(code);
    }
  }
  return [...found];
}

/**
 * scoreCoupon — מחשב ציון 0-100 לקופון.
 * discount_amount (40%) + verified (30%) + uses_remaining (20%) + freshness (10%)
 * @param {Object} coupon
 * @returns {number} ציון 0-100
 */
export function scoreCoupon(coupon) {
  if (!coupon) return 0;

  // 0 if expired or inactive
  const now = new Date();
  if (isCouponExpired(coupon.expires_at, now)) return 0;
  if (coupon.is_active === false) return 0;

  let score = 0;

  // discount_amount (40 pts) — scaled to 100% = 40 pts
  if (coupon.discount_amount > 0) {
    if (coupon.discount_type === 'percent') {
      // cap at 100%
      const pct = Math.min(coupon.discount_amount, 100);
      score += Math.round((pct / 100) * 40);
    } else {
      // fixed — map $0-$100 → 0-40 pts
      const val = Math.min(coupon.discount_amount, 100);
      score += Math.round((val / 100) * 40);
    }
  }

  // verified (30 pts)
  if (coupon.is_verified) score += 30;

  // uses_remaining (20 pts)
  if (coupon.uses_remaining === null || coupon.uses_remaining === undefined) {
    // unlimited — full points
    score += 20;
  } else if (coupon.uses_remaining > 100) {
    score += 20;
  } else if (coupon.uses_remaining > 10) {
    score += 14;
  } else if (coupon.uses_remaining > 0) {
    score += 7;
  }
  // 0 uses → 0 pts

  // freshness (10 pts) — based on created_at
  if (coupon.created_at) {
    const ageMs = now - new Date(coupon.created_at);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 1) score += 10;
    else if (ageDays < 7) score += 7;
    else if (ageDays < 30) score += 4;
    else score += 1;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * formatCouponDisplay — מחזיר מחרוזת תצוגה לקופון.
 * @param {Object} coupon
 * @returns {string}
 */
export function formatCouponDisplay(coupon) {
  if (!coupon || !coupon.code) return '';

  const code = coupon.code.toUpperCase();
  let discountStr = '';

  if (coupon.discount_amount > 0) {
    if (coupon.discount_type === 'percent') {
      discountStr = `${coupon.discount_amount}% off`;
    } else {
      const symbol = coupon.currency === 'ILS' ? '₪'
        : coupon.currency === 'EUR' ? '€'
        : coupon.currency === 'GBP' ? '£'
        : '$';
      discountStr = `${symbol}${coupon.discount_amount} off`;
    }
  } else if (coupon.description) {
    discountStr = coupon.description;
  }

  const verifiedBadge = coupon.is_verified ? ' (verified ✅)' : '';
  const expiryStr = coupon.expires_at
    ? ` · expires ${new Date(coupon.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  return discountStr
    ? `${code} — ${discountStr}${verifiedBadge}${expiryStr}`
    : `${code}${verifiedBadge}${expiryStr}`;
}

/**
 * isCouponValid — בודק אם קופון תקין לשימוש.
 * @param {Object} coupon
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isCouponValid(coupon, now = new Date()) {
  if (!coupon) return false;
  if (coupon.is_active === false) return false;
  if (isCouponExpired(coupon.expires_at, now)) return false;
  if (coupon.uses_remaining !== null && coupon.uses_remaining !== undefined && coupon.uses_remaining <= 0) return false;
  return true;
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  return data?.id;
}

async function logFinish(id, stats) {
  await supabase.from('bots_log').update({
    finished_at: new Date().toISOString(),
    status: stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    deals_added: stats.added || 0,
    errors: stats.errors || [],
  }).eq('id', id);
}

/**
 * fetchCouponsNeedingValidation — שולף קופונים שדורשים בדיקה.
 */
async function fetchCouponsNeedingValidation() {
  const cutoff = new Date(Date.now() - VALIDATION_INTERVAL).toISOString();

  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .or(`needs_validation.eq.true,last_checked_at.lt.${cutoff},last_checked_at.is.null`)
    .limit(200);

  if (error) {
    log.err(`fetchCouponsNeedingValidation: ${error.message}`);
    return [];
  }
  return data || [];
}

/**
 * validateAndUpdateCoupon — מאמת קופון ומעדכן ב-DB.
 */
async function validateAndUpdateCoupon(coupon) {
  const now = new Date();
  const isValid = isCouponValid(coupon, now);
  const score = scoreCoupon({ ...coupon, is_active: isValid ? coupon.is_active : false });

  const { error } = await supabase
    .from('coupons')
    .update({
      is_active: isValid ? coupon.is_active : false,
      needs_validation: false,
      last_checked_at: now.toISOString(),
      score,
    })
    .eq('id', coupon.id);

  if (error) {
    log.err(`validateAndUpdateCoupon ${coupon.code}: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * fetchActiveDealsForExtraction — שולף דילים פעילים לחילוץ קופונים.
 */
async function fetchActiveDealsForExtraction() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, description, store_id, price, currency')
    .eq('status', 'active')
    .is('has_coupon', null)
    .limit(MAX_DEALS_PER_RUN);

  if (error) {
    log.err(`fetchActiveDealsForExtraction: ${error.message}`);
    return [];
  }
  return data || [];
}

/**
 * upsertCoupon — מכניס או מעדכן קופון ב-DB.
 */
async function upsertCoupon(couponData) {
  const { error } = await supabase
    .from('coupons')
    .upsert(couponData, { onConflict: 'code,store_id', ignoreDuplicates: false });

  if (error) {
    log.err(`upsertCoupon ${couponData.code}: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * updateDealCoupon — מעדכן has_coupon ו-coupon_code על דיל.
 */
async function updateDealCoupon(dealId, hasCoupon, couponCode) {
  const { error } = await supabase
    .from('deals')
    .update({
      has_coupon: hasCoupon,
      coupon_code: couponCode || null,
    })
    .eq('id', dealId);

  if (error) {
    log.err(`updateDealCoupon ${dealId}: ${error.message}`);
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════

export async function runBot55() {
  log.log('BOT-55 Coupon Validator — start');
  const logId = await logStart();

  const stats = { updated: 0, added: 0, errors: [] };

  try {
    // Step 1: validate existing coupons
    const couponsToValidate = await fetchCouponsNeedingValidation();
    log.log(`Found ${couponsToValidate.length} coupons needing validation`);

    for (const coupon of couponsToValidate) {
      const ok = await validateAndUpdateCoupon(coupon);
      if (ok) {
        stats.updated++;
        const valid = isCouponValid(coupon);
        log.log(`${coupon.code} → ${valid ? 'valid' : 'invalid'} (score ${scoreCoupon(coupon)})`);
      } else {
        stats.errors.push(`Failed to validate coupon ${coupon.code}`);
      }
    }

    // Step 2: extract coupons from active deals
    const deals = await fetchActiveDealsForExtraction();
    log.log(`Scanning ${deals.length} active deals for coupon codes`);

    for (const deal of deals) {
      const textToSearch = [deal.title, deal.description].filter(Boolean).join(' ');
      const foundCodes = detectCouponInText(textToSearch);

      if (foundCodes.length > 0) {
        const primaryCode = foundCodes[0];
        log.log(`Deal ${deal.id}: found coupon(s) ${foundCodes.join(', ')}`);

        // upsert each found coupon
        for (const code of foundCodes) {
          const couponData = {
            deal_id: deal.id,
            store_id: deal.store_id || null,
            code,
            discount_type: 'percent',
            currency: deal.currency || 'USD',
            is_verified: false,
            is_active: true,
            needs_validation: true,
            score: 0,
            created_at: new Date().toISOString(),
          };
          const ok = await upsertCoupon(couponData);
          if (ok) stats.added++;
        }

        // update deal
        await updateDealCoupon(deal.id, true, primaryCode);
      } else {
        // mark as checked (no coupon)
        await updateDealCoupon(deal.id, false, null);
      }
    }

    log.ok(`Done — validated ${stats.updated}, extracted ${stats.added} coupons`);
  } catch (e) {
    log.err(`Unexpected error: ${e.message}`);
    stats.errors.push(e.message);
  }

  await logFinish(logId, stats);
  return stats;
}

// ════════════════════════════════════════════════════════════
// Entry point
// ════════════════════════════════════════════════════════════
const isMain = process.argv[1] && process.argv[1].endsWith('bot55.mjs');
if (isMain) {
  runBot55().then(stats => {
    console.log('\nStats:', stats);
    process.exit(stats.errors.length > 0 ? 1 : 0);
  }).catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
