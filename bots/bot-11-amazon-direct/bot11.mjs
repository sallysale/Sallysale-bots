// ════════════════════════════════════════════════════════════
// BOT-11 — Amazon Direct
// תפקיד: סורק עמודי deals של Amazon דרך ScraperAPI,
//         מחלץ ASIN + מחיר + הנחה ומעלה ל-Supabase.
//
// שיטה: ScraperAPI עם amazon=true (מצב מיוחד לAmazon)
//         → מעקף anti-bot של Amazon
//         → מחזיר JSON מובנה עם פרטי מוצר
//
// עמודי סריקה:
//   /deals — Deals of the Day
//   /gp/goldbox — Lightning Deals
//   קטגוריות: Electronics, Fashion, Home, Toys
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID            = 'BOT-11';
const DELAY_MS          = 3000;   // 3 שניות בין בקשות ScraperAPI
const MIN_DISCOUNT_PCT  = 15;     // הנחה מינימלית
const MAX_PER_PAGE      = 20;     // דילים מקסימליים לדף

const log = createLogger(BOT_ID);

// ── Credentials ──────────────────────────────────────────────

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';

// ── עמודי Amazon לסריקה ──────────────────────────────────────

export const AMAZON_TARGETS = [
  {
    id:       'amazon_deals_electronics',
    url:      'https://www.amazon.com/deals?deals-widget=%7B%22version%22%3A1%2C%22viewIndex%22%3A0%2C%22presetId%22%3A%22deals-collection-deals%22%2C%22sorting%22%3A%22FEATURED%22%7D',
    category: 'electronics',
    label:    'Amazon Deals Electronics',
  },
  {
    id:       'amazon_deals_fashion',
    url:      'https://www.amazon.com/deals?deals-widget=%7B%22version%22%3A1%2C%22viewIndex%22%3A0%2C%22presetId%22%3A%22deals-collection-deals%22%2C%22sorting%22%3A%22FEATURED%22%7D',
    category: 'fashion',
    label:    'Amazon Deals Fashion',
  },
  {
    id:       'amazon_deals_home',
    url:      'https://www.amazon.com/deals?deals-widget=%7B%22version%22%3A1%2C%22viewIndex%22%3A0%2C%22presetId%22%3A%22deals-collection-deals%22%2C%22sorting%22%3A%22FEATURED%22%7D',
    category: 'home',
    label:    'Amazon Deals Home',
  },
  {
    id:       'amazon_bestsellers_electronics',
    url:      'https://www.amazon.com/Best-Sellers-Electronics/zgbs/electronics',
    category: 'electronics',
    label:    'Amazon Best Sellers Electronics',
  },
];

// ── ScraperAPI URL builder ────────────────────────────────────

/**
 * buildScraperUrl — בונה URL של ScraperAPI לAmazon.
 * משתמש ב-autoparse=true לקבלת JSON מובנה.
 *
 * @param {string} amazonUrl — כתובת Amazon מלאה
 * @param {string} apiKey    — SCRAPERAPI_KEY
 * @returns {string}
 */
export function buildScraperUrl(amazonUrl, apiKey) {
  if (!amazonUrl || !apiKey) return null;
  const encoded = encodeURIComponent(amazonUrl);
  return `https://api.scraperapi.com/?api_key=${apiKey}&url=${encoded}&autoparse=true&country_code=us`;
}

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * parseAmazonPrice — מחלץ מחיר ממחרוזת Amazon.
 * תומך ב: "$49.99", "49.99", "$1,299.00", "1299"
 *
 * @param {string|number} str
 * @returns {number|null}
 */
export function parseAmazonPrice(str) {
  if (str == null) return null;
  if (typeof str === 'number') return isNaN(str) ? null : str;
  const s = String(str).replace(/[£$€¥₩₪]/g, '').trim();
  // הסר פסיקי אלפים (US format: 1,299.00)
  const cleaned = s.replace(/,(\d{3})/g, '$1').replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * calcDiscount — אחוז הנחה.
 * @param {number} current
 * @param {number} original
 * @returns {number|null}
 */
export function calcAmazonDiscount(current, original) {
  if (!current || !original || original <= 0 || current >= original) return null;
  return Math.round(((original - current) / original) * 100);
}

/**
 * extractAsin — מחלץ ASIN מ-URL של Amazon.
 * תומך ב: /dp/ASIN / /gp/product/ASIN / /product/ASIN
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractAsin(url) {
  if (!url) return null;
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:\/|\?|$)/,
    /\/gp\/product\/([A-Z0-9]{10})(?:\/|\?|$)/,
    /\/product\/([A-Z0-9]{10})(?:\/|\?|$)/,
    /\/([A-Z0-9]{10})(?:\/|\?|$)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * buildAffiliateUrl — מוסיף tag=sallysale-20 ל-URL.
 * @param {string} asin
 * @param {string} tag — Amazon Associates tag
 * @returns {string}
 */
export function buildAffiliateUrl(asin, tag = 'sallysale-20') {
  if (!asin) return null;
  return `https://www.amazon.com/dp/${asin}?tag=${tag}`;
}

/**
 * mapAmazonCategory — ממיר breadcrumb / department name לslug.
 * @param {string} dept — שם דפרטמנט מAmazon
 * @returns {string}
 */
export function mapAmazonCategory(dept) {
  if (!dept) return 'general';
  const d = dept.toLowerCase();
  if (/electronic|computer|laptop|phone|camera|tv|audio|headphone|gaming|console/.test(d)) return 'electronics';
  if (/clothing|fashion|shoe|apparel|dress|shirt|jeans|bag|jewelry|watch/.test(d)) return 'fashion';
  if (/home|kitchen|furniture|bedding|bath|appliance|garden|tool/.test(d)) return 'home';
  if (/toy|game|lego|baby|infant|kids|children/.test(d)) return 'toys';
  if (/book|kindle|novel|education/.test(d)) return 'books';
  if (/beauty|health|vitamin|supplement|skincare|makeup/.test(d)) return 'beauty';
  if (/sport|fitness|outdoor|camping|gym/.test(d)) return 'sports';
  return 'general';
}

/**
 * parseScraperApiProduct — מפרסר תגובת ScraperAPI מוצר יחיד.
 * ScraperAPI עם autoparse מחזיר אובייקט עם שדות מוכרים.
 *
 * @param {object} data   — תגובת JSON מScraperAPI
 * @param {string} category — קטגוריה מה-target
 * @returns {object|null}  — payload מוכן לSupabase
 */
export function parseScraperApiProduct(data, category = 'general') {
  if (!data) return null;

  // ScraperAPI autoparse מחזיר שדות שונים לפי סוג הדף
  const title         = data.name || data.title || data.product_title || null;
  const priceStr      = data.price || data.sale_price || data.current_price || null;
  const origPriceStr  = data.original_price || data.list_price || data.was_price || null;
  const imageUrl      = data.image || data.main_image || data.thumbnail || null;
  const productUrl    = data.url || data.product_url || null;
  const asin          = data.asin || (productUrl ? extractAsin(productUrl) : null);
  const dept          = data.department || data.category || data.breadcrumb || '';

  if (!title) return null;

  const currentPrice  = parseAmazonPrice(priceStr);
  const originalPrice = parseAmazonPrice(origPriceStr);
  const discount      = calcAmazonDiscount(currentPrice, originalPrice);

  // מסנן: חייב לעבור סף הנחה מינימלי
  if (discount !== null && discount < MIN_DISCOUNT_PCT) return null;
  // אם אין מחיר כלל — דלג
  if (!currentPrice) return null;

  const resolvedCategory = mapAmazonCategory(dept) !== 'general'
    ? mapAmazonCategory(dept)
    : category;

  const url = buildAffiliateUrl(asin) || productUrl;

  return {
    title:          String(title).substring(0, 500),
    description:    data.description ? String(data.description).substring(0, 2000) : null,
    url:            url,
    product_url:    productUrl || url,
    image_url:      imageUrl,
    price:          currentPrice,
    original_price: originalPrice,
    currency:       'USD',
    discount:       discount,
    category:       resolvedCategory,
    store_name:     'Amazon',
    source:         'amazon_direct',
    scrape_source:  'amazon_scraperapi',
    asin:           asin,
    status:         'active',
    scraped_at:     new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  };
}

/**
 * parseProductListPage — מפרסר דף רשימת מוצרים מScraperAPI.
 * ScraperAPI מחזיר { results: [...] } או { products: [...] }.
 *
 * @param {object|string} raw — תגובה גולמית (JSON object או string)
 * @param {string} category
 * @returns {Array<object>}
 */
export function parseProductListPage(raw, category = 'general') {
  if (!raw) return [];

  let data;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return []; }
  } else {
    data = raw;
  }

  // ScraperAPI יכול להחזיר רשימה ישירות או תוך שדה
  const items = Array.isArray(data)
    ? data
    : (data.results || data.products || data.items || []);

  const payloads = [];
  for (const item of items.slice(0, MAX_PER_PAGE)) {
    const p = parseScraperApiProduct(item, category);
    if (p) payloads.push(p);
  }
  return payloads;
}

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════
// sleep
// ════════════════════════════════════════════════════════════

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
// HTTP — קריאת ScraperAPI
// ════════════════════════════════════════════════════════════

async function fetchFromScraperApi(amazonUrl, category) {
  if (!SCRAPERAPI_KEY) {
    log.warn('SCRAPERAPI_KEY חסר — מדלג');
    return [];
  }

  const scraperUrl = buildScraperUrl(amazonUrl, SCRAPERAPI_KEY);

  try {
    const res = await fetch(scraperUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      log.warn(`ScraperAPI HTTP ${res.status} for ${amazonUrl}`);
      return [];
    }

    const text = await res.text();
    return parseProductListPage(text, category);

  } catch (err) {
    log.warn(`fetchFromScraperApi error: ${err.message}`);
    return [];
  }
}

// ════════════════════════════════════════════════════════════
// upsert ל-Supabase
// ════════════════════════════════════════════════════════════

async function upsertDeals(payloads) {
  if (payloads.length === 0) return { added: 0, updated: 0 };

  // UPSERT לפי ASIN (אם קיים) או product_url
  const { data, error } = await supabase
    .from('deals')
    .upsert(payloads, {
      onConflict:       'asin',
      ignoreDuplicates: false,
    })
    .select('id');

  if (error) {
    // fallback: nסת product_url אם asin conflict נכשל
    log.warn(`upsert by asin failed: ${error.message} — מנסה product_url`);
    const { data: d2, error: e2 } = await supabase
      .from('deals')
      .upsert(payloads, { onConflict: 'product_url', ignoreDuplicates: false })
      .select('id');
    if (e2) { log.error(`upsert fallback error: ${e2.message}`); return { added: 0, updated: 0 }; }
    return { added: d2?.length || 0, updated: 0 };
  }

  return { added: data?.length || 0, updated: 0 };
}

// ════════════════════════════════════════════════════════════
// processTarget — מעבד target אחד
// ════════════════════════════════════════════════════════════

async function processTarget(target) {
  log.info(`🛒 סורק: ${target.label}`);
  const payloads = await fetchFromScraperApi(target.url, target.category);
  log.info(`   נמצאו ${payloads.length} דילים ב-${target.id}`);
  return upsertDeals(payloads);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.info(`🚀 ${BOT_ID} — Amazon Direct Scraper`);

  let logId;
  const totalStats = { added: 0, updated: 0, errors: [] };

  try { logId = await logStart(); } catch (err) {
    log.error(`bots_log פתיחה נכשלה: ${err.message}`);
  }

  for (const target of AMAZON_TARGETS) {
    try {
      const result = await processTarget(target);
      totalStats.added   += result.added;
      totalStats.updated += result.updated;
    } catch (err) {
      log.error(`${target.id}: ${err.message}`);
      totalStats.errors.push(`${target.id}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  log.info(`✅ סיום: +${totalStats.added} נוספו, ${totalStats.updated} עודכנו`);

  if (logId) await logFinish(logId, totalStats);
  return totalStats;
}

// ── הרצה ישירה ──────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('bot11.mjs');
if (isMain) {
  main().catch(err => {
    console.error('❌ BOT-11 crashed:', err);
    process.exit(1);
  });
}
