// ════════════════════════════════════════════════════════════
// BOT-03 — Impact.com API
// תפקיד: מושך דילים מ-Impact REST API,
//         מסנן לפי הנחה מינימלית 10%, ומוסיף לSupabase.
//
// API: Impact Mediapartners REST API v2
// Auth: Basic Auth (AccountSid:AuthToken)
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-03';

// ── קונפיגורציה ────────────────────────────────────────────

const IMPACT_SID   = process.env.IMPACT_ACCOUNT_SID  || '';
const IMPACT_TOKEN = process.env.IMPACT_AUTH_TOKEN    || '';

const IMPACT_API_BASE = 'https://api.impact.com';
const ITEMS_PER_PAGE  = 100;
const MAX_PAGES       = 8;
const MIN_DISCOUNT    = 10;
const DELAY_MS        = 700;

// ── Basic Auth header ───────────────────────────────────────

export function buildAuthHeader(sid, token) {
  const encoded = Buffer.from(`${sid}:${token}`).toString('base64');
  return `Basic ${encoded}`;
}

// ── מיפוי קטגוריות Impact → SallySale slugs ────────────────

/**
 * ממיר קטגוריה של Impact לslug של SallySale.
 * @param {string} category
 * @returns {string}
 */
export function mapImpactCategory(category) {
  if (!category) return 'fashion';
  const cat = category.toLowerCase();

  if (cat.includes('electron') || cat.includes('computer') || cat.includes('phone') ||
      cat.includes('software') || cat.includes('tech') || cat.includes('gaming')) {
    return 'electronics';
  }
  if (cat.includes('home') || cat.includes('garden') || cat.includes('furniture') ||
      cat.includes('kitchen') || cat.includes('appliance')) {
    return 'home';
  }
  if (cat.includes('sport') || cat.includes('fitness') || cat.includes('outdoor') ||
      cat.includes('athletic')) {
    return 'sports';
  }
  if (cat.includes('beauty') || cat.includes('health') || cat.includes('wellness') ||
      cat.includes('cosmetic') || cat.includes('vitamin')) {
    return 'beauty';
  }
  if (cat.includes('toy') || cat.includes('kids') || cat.includes('children') ||
      cat.includes('baby')) {
    return 'kids';
  }
  if (cat.includes('travel') || cat.includes('hotel') || cat.includes('flight')) {
    return 'travel';
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

// ── בניית payload לSupabase ─────────────────────────────────

/**
 * בונה אובייקט דיל מתגובת Impact להכנסה לSupabase.
 * @param {object} item — פריט מ-Impact
 * @returns {object}
 */
export function buildImpactPayload(item) {
  // Impact item fields:
  // Name, Price, RetailPrice, TrackingLink, ImageUrl, CampaignName,
  // Category, Currency, Description, Availability
  const title        = item.Name       || item.name       || '';
  const price        = parseFloat(item.Price      || item.salePrice  || '0') || null;
  const origPrice    = parseFloat(item.RetailPrice || item.retailPrice || '0') || null;
  const currency     = item.Currency   || item.currency   || 'USD';
  const affiliateUrl = item.TrackingLink || item.trackingLink || item.Url || '';
  const productUrl   = item.Url        || item.productUrl  || affiliateUrl;
  const imageUrl     = item.ImageUrl   || item.imageUrl    || '';
  const storeName    = item.CampaignName || item.campaignName || item.BrandName || 'Impact';
  const category     = item.Category  || item.category    || '';

  return {
    title_en:       title,
    title_he:       null,
    storeName_en:   storeName,
    category_slug:  mapImpactCategory(category),
    price,
    originalPrice:  origPrice,
    currency,
    productUrl:     productUrl || affiliateUrl,
    affiliateUrl,
    imageUrl,
    description_en: item.Description || item.description || null,
    shippingCost:   null,
    country:        item.Country || 'US',
    inStock:        item.Availability !== 'OutOfStock',
    status:         'pending',
    source:         'impact',
    tags:           ['impact', 'sale'],
    addedAt:        new Date().toISOString(),
  };
}

// ── בדיקת תקינות דיל ────────────────────────────────────────

/**
 * מחזיר true אם הדיל עומד בתנאי המינימום.
 * @param {object} item
 * @returns {boolean}
 */
export function isValidImpactDeal(item) {
  const price     = parseFloat(item.Price      || item.salePrice   || '0');
  const origPrice = parseFloat(item.RetailPrice || item.retailPrice || '0');
  const url       = item.TrackingLink || item.Url || '';

  if (!url)                         return false;
  if (!price || price <= 0)         return false;
  if (!origPrice || origPrice <= 0) return false;
  if (price >= origPrice)           return false;

  const discount = calculateDiscount(price, origPrice);
  if (discount === null || discount < MIN_DISCOUNT) return false;

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

// ── קריאה ל-Impact API ──────────────────────────────────────

/**
 * מביא רשימת קטלוגים פעילים.
 * @returns {object[]} קטלוגים
 */
export async function fetchImpactCatalogs() {
  const url = `${IMPACT_API_BASE}/Mediapartners/${IMPACT_SID}/Catalogs`;
  const res = await fetch(url, {
    headers: {
      'Authorization': buildAuthHeader(IMPACT_SID, IMPACT_TOKEN),
      'Accept':        'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Impact Catalogs HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return json?.Catalogs || json?.catalogs || [];
}

/**
 * מביא עמוד של פריטים מקטלוג ספציפי.
 * @param {string} catalogId
 * @param {number} pageNo
 * @returns {object[]}
 */
export async function fetchImpactItems(catalogId, pageNo) {
  const params = new URLSearchParams({
    Page:         String(pageNo),
    PageSize:     String(ITEMS_PER_PAGE),
    OnSale:       'true',
  });

  const url = `${IMPACT_API_BASE}/Mediapartners/${IMPACT_SID}/Catalogs/${catalogId}/Items?${params}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': buildAuthHeader(IMPACT_SID, IMPACT_TOKEN),
      'Accept':        'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Impact Items HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return json?.Items || json?.items || json?.data || [];
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
  logger.log('=== BOT-03 Impact.com — מתחיל ===');

  if (!IMPACT_SID || !IMPACT_TOKEN) {
    logger.err('IMPACT_ACCOUNT_SID או IMPACT_AUTH_TOKEN חסרים ב-.env — יציאה');
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
    // שלב 1: קבל רשימת קטלוגים
    let catalogs;
    try {
      catalogs = await fetchImpactCatalogs();
      logger.log(`נמצאו ${catalogs.length} קטלוגים`);
    } catch (e) {
      logger.err(`שגיאה בטעינת קטלוגים: ${e.message}`);
      stats.errors.push(e.message);
      catalogs = [];
    }

    // שלב 2: עבור כל קטלוג — אסוף פריטים
    for (const catalog of catalogs.slice(0, 10)) {  // מקסימום 10 קטלוגים
      const catalogId = catalog.Id || catalog.id || catalog.CatalogId;
      const catalogName = catalog.Name || catalog.name || catalogId;
      logger.log(`סורק קטלוג: ${catalogName}`);

      for (let page = 1; page <= MAX_PAGES; page++) {
        let items;
        try {
          items = await fetchImpactItems(catalogId, page);
        } catch (e) {
          logger.err(`  שגיאה בקטלוג ${catalogName} עמוד ${page}: ${e.message}`);
          stats.errors.push(e.message);
          break;
        }

        if (!items.length) break;

        const validItems = items.filter(isValidImpactDeal);
        logger.log(`  עמוד ${page}: ${items.length} פריטים, ${validItems.length} תקינים`);

        const deals = validItems.map(buildImpactPayload);
        const batchResult = await saveDealsBatch(deals, logger);
        stats.added   += batchResult.added;
        stats.updated += batchResult.updated;
        stats.errors.push(...batchResult.errors);

        if (items.length < ITEMS_PER_PAGE) break;
        await sleep(DELAY_MS);
      }
    }

    logger.ok(`סיכום: +${stats.added} חדשים | ~${stats.updated} עודכנו | ❌ ${stats.errors.length} שגיאות`);
    logger.ok(`=== BOT-03 סיים בהצלחה — ${logger.elapsed()} ===`);

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
  process.argv[1].endsWith('bot03.mjs') || process.argv[1].endsWith('bot03')
);
if (isMain) main();
