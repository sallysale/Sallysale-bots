// ════════════════════════════════════════════════════════════
// BOT-12 — Google Shopping
// תפקיד: סורק Google Shopping דרך ScraperAPI,
//         מחפש מוצרים עם Sale badges ומוסיף לSupabase.
//
// שיטה: ScraperAPI → Google Shopping results
// חיפושים: "sale clearance" + 8 קטגוריות
// תדירות: פעם ביום (Railway cron: 0 8 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-12';

// ── קונפיגורציה ────────────────────────────────────────────

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';

const SCRAPERAPI_BASE = 'https://api.scraperapi.com/structured/google/shopping';
const DELAY_MS        = 3000;   // ScraperAPI rate limit
const MIN_DISCOUNT    = 10;

// שאילתות חיפוש — קטגוריה + "sale"
const SEARCH_QUERIES = [
  { query: 'electronics sale clearance',    category: 'electronics' },
  { query: 'fashion clothing sale',         category: 'fashion'     },
  { query: 'home decor sale clearance',     category: 'home'        },
  { query: 'sports fitness sale',           category: 'sports'      },
  { query: 'beauty skincare sale',          category: 'beauty'      },
  { query: 'toys kids sale clearance',      category: 'kids'        },
  { query: 'shoes footwear sale',           category: 'fashion'     },
  { query: 'kitchen appliances sale',       category: 'home'        },
];

// ── מיפוי קטגוריות Google Shopping → SallySale ────────────

/**
 * ממיר שם קטגוריה של Google Shopping לslug של SallySale.
 * @param {string} title     — שם מוצר
 * @param {string} category  — קטגוריית חיפוש
 * @returns {string} slug
 */
export function mapGoogleShoppingCategory(title, category) {
  if (category) return category;   // משתמש בקטגוריה מהשאילתה
  if (!title)   return 'fashion';
  const t = title.toLowerCase();
  if (t.includes('phone') || t.includes('laptop') || t.includes('tv') ||
      t.includes('camera') || t.includes('tablet') || t.includes('headphone')) {
    return 'electronics';
  }
  if (t.includes('shirt') || t.includes('dress') || t.includes('jeans') ||
      t.includes('jacket') || t.includes('shoe') || t.includes('sneaker')) {
    return 'fashion';
  }
  if (t.includes('sofa') || t.includes('lamp') || t.includes('rug') ||
      t.includes('pot') || t.includes('knife') || t.includes('towel')) {
    return 'home';
  }
  return 'fashion';
}

// ── חישוב הנחה ─────────────────────────────────────────────

/**
 * מחשב אחוז הנחה.
 * @param {number|null} salePrice
 * @param {number|null} originalPrice
 * @returns {number|null}
 */
export function calculateDiscount(salePrice, originalPrice) {
  if (salePrice == null || originalPrice == null) return null;
  if (originalPrice <= 0)          return null;
  if (salePrice >= originalPrice)  return null;
  return Math.round(((originalPrice - salePrice) / originalPrice) * 10000) / 100;
}

// ── פירוס מחיר מטקסט Google ────────────────────────────────

/**
 * מוציא מספר ממחרוזת מחיר: "$49.99" → 49.99
 * @param {string} priceStr
 * @returns {number|null}
 */
export function parseGooglePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = String(priceStr).replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? null : val;
}

// ── בניית payload לSupabase ─────────────────────────────────

/**
 * בונה אובייקט דיל מתוצאת Google Shopping.
 * @param {object} item     — פריט מ-Google Shopping
 * @param {string} category — slug קטגוריה
 * @returns {object}
 */
export function buildGoogleShoppingPayload(item, category) {
  const title      = item.title       || '';
  const price      = parseGooglePrice(item.price);
  const origPrice  = parseGooglePrice(item.old_price || item.original_price);
  const productUrl = item.link        || item.url    || '';
  const imageUrl   = item.thumbnail   || item.image  || '';
  const storeName  = item.source      || item.seller || 'Google Shopping';
  const currency   = item.currency    || 'USD';

  return {
    title_en:       title,
    title_he:       null,
    storeName_en:   storeName,
    category_slug:  mapGoogleShoppingCategory(title, category),
    price,
    originalPrice:  origPrice,
    currency,
    productUrl,
    affiliateUrl:   productUrl,
    imageUrl,
    description_en: item.snippet || null,
    shippingCost:   parseGooglePrice(item.delivery) || null,
    country:        'US',
    inStock:        true,
    status:         'pending',
    source:         'google_shopping',
    tags:           ['google_shopping', 'sale'],
    addedAt:        new Date().toISOString(),
  };
}

// ── בדיקת תקינות דיל ────────────────────────────────────────

/**
 * מחזיר true אם הדיל תקין.
 * @param {object} item
 * @returns {boolean}
 */
export function isValidGoogleShoppingDeal(item) {
  const price    = parseGooglePrice(item.price);
  const origPrice = parseGooglePrice(item.old_price || item.original_price);
  const url      = item.link || item.url || '';

  if (!url)                      return false;
  if (!price || price <= 0)      return false;
  // אם אין מחיר מקורי — בכל זאת שווה לשמור (Google מציין Sale badge)
  if (origPrice) {
    const disc = calculateDiscount(price, origPrice);
    if (disc !== null && disc < MIN_DISCOUNT) return false;
  }
  return true;
}

// ── בניית URL ל-ScraperAPI Google Shopping ─────────────────

/**
 * בונה URL ל-ScraperAPI Structured Google Shopping.
 * @param {string} query  — שאילתת חיפוש
 * @param {number} page   — עמוד (1-based)
 * @returns {string}
 */
export function buildScraperApiUrl(query, page = 1) {
  const params = new URLSearchParams({
    api_key: SCRAPERAPI_KEY,
    query,
    page:    String(page),
    country: 'us',
  });
  return `${SCRAPERAPI_BASE}?${params}`;
}

// ── bots_log helpers ────────────────────────────────────────

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
    finished_at: new Date().toISOString(), status,
    deals_added: stats.added, deals_updated: stats.updated, errors: stats.errors,
  }).eq('id', logId);
}

// ── קריאה ל-ScraperAPI ──────────────────────────────────────

export async function fetchGoogleShoppingResults(query) {
  const url = buildScraperApiUrl(query);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  // ScraperAPI structured: { shopping_results: [...] }
  return json?.shopping_results || json?.results || [];
}

// ── שמירה ל-Supabase ────────────────────────────────────────

async function saveDealsBatch(deals, logger) {
  let added = 0, updated = 0;
  const errors = [];
  for (const deal of deals) {
    try {
      const { data: existing } = await supabase.from('deals')
        .select('id, price').eq('productUrl', deal.productUrl).maybeSingle();
      if (existing) {
        if (existing.price !== deal.price) {
          const { error } = await supabase.from('deals')
            .update({ price: deal.price }).eq('id', existing.id);
          if (error) throw new Error(error.message);
          updated++;
        }
      } else {
        const { error } = await supabase.from('deals').insert(deal);
        if (error) throw new Error(error.message);
        added++;
      }
    } catch (e) {
      logger.err(`שגיאה: "${deal.title_en}": ${e.message}`);
      errors.push(e.message);
    }
  }
  return { added, updated, errors };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── main ───────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-12 Google Shopping — מתחיל ===');

  if (!SCRAPERAPI_KEY) {
    logger.err('SCRAPERAPI_KEY חסר ב-.env — יציאה');
    process.exit(1);
  }

  let logId;
  try { logId = await logStart(); } catch (e) { logger.err(`bots_log: ${e.message}`); }
  const stats = { added: 0, updated: 0, errors: [] };

  try {
    for (const { query, category } of SEARCH_QUERIES) {
      logger.log(`מחפש: "${query}"`);
      let items;
      try {
        items = await fetchGoogleShoppingResults(query);
      } catch (e) {
        logger.err(`שגיאה ב-"${query}": ${e.message}`);
        stats.errors.push(e.message);
        await sleep(DELAY_MS);
        continue;
      }

      const valid = items.filter(isValidGoogleShoppingDeal);
      logger.log(`  ${items.length} תוצאות, ${valid.length} תקינות`);

      const deals = valid.map(item => buildGoogleShoppingPayload(item, category));
      const batch = await saveDealsBatch(deals, logger);
      stats.added   += batch.added;
      stats.updated += batch.updated;
      stats.errors.push(...batch.errors);
      logger.ok(`  +${batch.added} חדשים, ~${batch.updated} עודכנו`);
      await sleep(DELAY_MS);
    }

    logger.ok(`סיכום: +${stats.added} | ~${stats.updated} | ❌ ${stats.errors.length}`);
    logger.ok(`=== BOT-12 סיים — ${logger.elapsed()} ===`);
  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, stats.errors.length > 0 ? 'error' : 'done');
  }
}

const isMain = process.argv[1]?.endsWith('bot12.mjs') || process.argv[1]?.endsWith('bot12');
if (isMain) main();
