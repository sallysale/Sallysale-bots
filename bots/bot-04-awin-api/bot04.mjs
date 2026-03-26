// ════════════════════════════════════════════════════════════
// BOT-04 — AWIN API
// תפקיד: מושך דילים מ-AWIN Publisher API,
//         מסנן לפי הנחה מינימלית 10%, ומוסיף לSupabase.
//
// API: AWIN Publisher API v3
// Docs: https://wiki.awin.com/index.php/Publisher_API
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-04';

// ── קונפיגורציה ────────────────────────────────────────────

const AWIN_API_KEY       = process.env.AWIN_API_KEY       || '';
const AWIN_PUBLISHER_ID  = process.env.AWIN_PUBLISHER_ID  || '';

const AWIN_API_BASE  = 'https://api.awin.com';
const PROMO_PER_PAGE = 100;
const MAX_PAGES      = 8;
const MIN_DISCOUNT   = 10;
const DELAY_MS       = 700;

// סוגי פרומוציות לאסוף
const PROMO_TYPES = ['deal', 'promotion', 'sale'];

// ── מיפוי קטגוריות AWIN → SallySale slugs ─────────────────

/**
 * ממיר קטגוריה של AWIN לslug של SallySale.
 * @param {string} category
 * @returns {string}
 */
export function mapAwinCategory(category) {
  if (!category) return 'fashion';
  const cat = category.toLowerCase();

  if (cat.includes('electron') || cat.includes('tech') || cat.includes('computer') ||
      cat.includes('phone') || cat.includes('camera') || cat.includes('gaming')) {
    return 'electronics';
  }
  if (cat.includes('home') || cat.includes('garden') || cat.includes('diy') ||
      cat.includes('furniture') || cat.includes('kitchen')) {
    return 'home';
  }
  if (cat.includes('sport') || cat.includes('fitness') || cat.includes('outdoor') ||
      cat.includes('bicycle') || cat.includes('gym')) {
    return 'sports';
  }
  if (cat.includes('beauty') || cat.includes('health') || cat.includes('pharmacy') ||
      cat.includes('cosmetic') || cat.includes('skincare')) {
    return 'beauty';
  }
  if (cat.includes('toy') || cat.includes('baby') || cat.includes('child') ||
      cat.includes('kids')) {
    return 'kids';
  }
  if (cat.includes('book') || cat.includes('music') || cat.includes('film') ||
      cat.includes('game') || cat.includes('entertain')) {
    return 'entertainment';
  }
  return 'fashion';
}

// ── חישוב הנחה ─────────────────────────────────────────────

/**
 * מחשב אחוז הנחה.
 * @param {number|null} salePrice
 * @param {number|null} regularPrice
 * @returns {number|null}
 */
export function calculateDiscount(salePrice, regularPrice) {
  if (salePrice == null || regularPrice == null) return null;
  if (regularPrice <= 0) return null;
  if (salePrice >= regularPrice) return null;
  const pct = ((regularPrice - salePrice) / regularPrice) * 100;
  return Math.round(pct * 100) / 100;
}

// ── פירוש אחוז הנחה מטקסט ──────────────────────────────────

/**
 * מוציא אחוז הנחה מטקסט (למשל: "Save 30%" → 30).
 * @param {string} text
 * @returns {number|null}
 */
export function parseDiscountFromText(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const pct = parseFloat(match[1]);
  return pct > 0 && pct <= 100 ? pct : null;
}

// ── בניית payload לSupabase ─────────────────────────────────

/**
 * בונה אובייקט דיל מפרומוציית AWIN להכנסה לSupabase.
 * @param {object} promo — פרומוציה מ-AWIN
 * @returns {object}
 */
export function buildAwinPayload(promo) {
  // AWIN promotion fields:
  // id, title, description, promotionType, code, startDate, endDate,
  // advertiserName, advertiserId, promotionUrl, logoUrl,
  // discount { amount, currency, percent }
  const title       = promo.title       || promo.name       || '';
  const storeName   = promo.advertiserName || promo.merchantName || 'AWIN';
  const affiliateUrl = promo.promotionUrl  || promo.url       || '';
  const imageUrl    = promo.logoUrl      || promo.imageUrl   || '';
  const category    = promo.category    || promo.sector      || '';
  const currency    = promo.discount?.currency || 'USD';

  // מחיר: AWIN promotions לא תמיד כוללים מחיר מפורש
  const discountAmt = parseFloat(promo.discount?.amount || '0') || null;
  const discountPct = promo.discount?.percent || parseDiscountFromText(promo.description || title) || null;

  // אם יש discountAmount אבל לא originalPrice — נשתמש בדמי placeholder
  const originalPrice = promo.originalPrice || null;
  const salePrice     = promo.salePrice     || null;

  return {
    title_en:       title,
    title_he:       null,
    storeName_en:   storeName,
    category_slug:  mapAwinCategory(category),
    price:          salePrice,
    originalPrice,
    currency,
    discount:       discountPct,
    productUrl:     affiliateUrl,
    affiliateUrl,
    imageUrl,
    description_en: promo.description || null,
    shippingCost:   null,
    country:        promo.country || 'GB',
    inStock:        true,
    status:         'pending',
    source:         'awin',
    tags:           ['awin', 'sale', promo.promotionType || 'deal'].filter(Boolean),
    addedAt:        new Date().toISOString(),
    ...(promo.endDate ? { expires_at: promo.endDate } : {}),
  };
}

// ── בדיקת תקינות פרומוציה ───────────────────────────────────

/**
 * מחזיר true אם הפרומוציה תקינה.
 * @param {object} promo
 * @returns {boolean}
 */
export function isValidAwinDeal(promo) {
  const url   = promo.promotionUrl || promo.url || '';
  const title = promo.title || promo.name || '';

  if (!url)   return false;
  if (!title) return false;

  // בדוק שלא פג תוקף
  if (promo.endDate) {
    const end = new Date(promo.endDate);
    if (end < new Date()) return false;
  }

  // אם יש מחירים — בדוק הנחה
  const salePrice    = parseFloat(promo.salePrice    || '0');
  const origPrice    = parseFloat(promo.originalPrice || '0');
  if (salePrice > 0 && origPrice > 0 && salePrice >= origPrice) return false;

  // אם יש % הנחה מפורש — בדוק מינימום
  const discountPct = promo.discount?.percent || parseDiscountFromText(promo.description || title);
  if (discountPct !== null && discountPct < MIN_DISCOUNT) return false;

  return true;
}

// ── bots_log helpers ────────────────────────────────────────

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`logStart: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats, status = 'done') {
  await supabase
    .from('bots_log')
    .update({
      finished_at:   new Date().toISOString(),
      status,
      deals_added:   stats.added,
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── קריאה ל-AWIN API ────────────────────────────────────────

/**
 * מביא פרומוציות מ-AWIN API.
 * @param {string} type  — סוג פרומוציה
 * @param {number} page  — עמוד (1-based)
 * @returns {object[]}
 */
export async function fetchAwinPromotions(type, page) {
  const params = new URLSearchParams({
    type,
    page:     String(page),
    pageSize: String(PROMO_PER_PAGE),
    status:   'active',
  });

  const url = `${AWIN_API_BASE}/publishers/${AWIN_PUBLISHER_ID}/promotions?${params}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${AWIN_API_KEY}`,
      'Accept':        'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`AWIN API HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return Array.isArray(json) ? json : (json?.promotions || json?.data || []);
}

// ── שמירה ל-Supabase ────────────────────────────────────────

async function saveDealsBatch(deals, logger) {
  let added   = 0;
  let updated = 0;
  const errors = [];

  for (const deal of deals) {
    try {
      const { data: existing } = await supabase
        .from('deals')
        .select('id, price')
        .eq('productUrl', deal.productUrl)
        .maybeSingle();

      if (existing) {
        if (existing.price !== deal.price) {
          const { error } = await supabase
            .from('deals')
            .update({ price: deal.price, affiliateUrl: deal.affiliateUrl })
            .eq('id', existing.id);
          if (error) throw new Error(error.message);
          updated++;
        }
      } else {
        const { error } = await supabase.from('deals').insert(deal);
        if (error) throw new Error(error.message);
        added++;
      }
    } catch (e) {
      logger.err(`שגיאה בשמירת דיל "${deal.title_en}": ${e.message}`);
      errors.push(e.message);
    }
  }

  return { added, updated, errors };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ───────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-04 AWIN — מתחיל ===');

  if (!AWIN_API_KEY || !AWIN_PUBLISHER_ID) {
    logger.err('AWIN_API_KEY או AWIN_PUBLISHER_ID חסרים ב-.env — יציאה');
    process.exit(1);
  }

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { added: 0, updated: 0, errors: [] };

  try {
    for (const type of PROMO_TYPES) {
      logger.log(`מביא פרומוציות מסוג: "${type}"`);

      for (let page = 1; page <= MAX_PAGES; page++) {
        let promos;
        try {
          promos = await fetchAwinPromotions(type, page);
        } catch (e) {
          logger.err(`  שגיאה בסוג ${type} עמוד ${page}: ${e.message}`);
          stats.errors.push(e.message);
          break;
        }

        if (!promos.length) {
          logger.log(`  עמוד ${page}: אין פרומוציות — סיום`);
          break;
        }

        const validPromos = promos.filter(isValidAwinDeal);
        logger.log(`  עמוד ${page}: ${promos.length} פרומוציות, ${validPromos.length} תקינות`);

        const deals = validPromos.map(buildAwinPayload);
        const batchResult = await saveDealsBatch(deals, logger);
        stats.added   += batchResult.added;
        stats.updated += batchResult.updated;
        stats.errors.push(...batchResult.errors);

        logger.ok(`  עמוד ${page}: +${batchResult.added} חדשים, ~${batchResult.updated} עודכנו`);

        if (promos.length < PROMO_PER_PAGE) break;
        await sleep(DELAY_MS);
      }

      await sleep(DELAY_MS * 2);
    }

    logger.ok(`סיכום: +${stats.added} חדשים | ~${stats.updated} עודכנו | ❌ ${stats.errors.length} שגיאות`);
    logger.ok(`=== BOT-04 סיים בהצלחה — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) {
      await logFinish(logId, stats, stats.errors.length > 0 ? 'error' : 'done');
    }
  }
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('bot04.mjs') || process.argv[1].endsWith('bot04')
);
if (isMain) main();
