// ════════════════════════════════════════════════════════════
// BOT-09 — Scraping Tier 1
// תפקיד: סורק עמודי סייל של 5 חנויות גדולות (H&M, Zara, Mango, IKEA, NET-A-PORTER)
//         דרך ScraperAPI, מחלץ דילים ומעלה ל-Supabase.
//
// כלי ניתוח HTML: node-html-parser
// שיטת scraping: ScraperAPI עם render=true (JavaScript rendering)
// שיטת UPSERT: onConflict='productUrl' — ימנע כפילויות
//
// תדירות: כל 6 שעות (Railway cron: 0 */6 * * *)
// ════════════════════════════════════════════════════════════

import pkg from 'node-html-parser';
const { parse } = pkg;
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID           = 'BOT-09';
const DELAY_MS         = 2000;   // 2 שניות בין בקשות — לא לעמיס את ScraperAPI
const MAX_PER_STORE    = 50;     // מקסימום מוצרים לחנות בהרצה אחת
const MIN_DISCOUNT_PCT = 10;     // הנחה מינימלית לקבלת דיל

// ── sleep ─────────────────────────────────────────────────────
/** עיכוב אסינכרוני פשוט (ms) */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
// פונקציות עזר — נטו (pure), ללא תלות ב-DB או HTTP
// ════════════════════════════════════════════════════════════

/**
 * cleanPrice — מחלץ מספר מחרוזת מחיר.
 * תומך ב: £29.99 / $49 / was £99.99 / 29,99 / "49.00 GBP"
 * מחזיר מספר, או null אם לא נמצא.
 *
 * @param {string} str
 * @returns {number|null}
 */
export function cleanPrice(str) {
  if (str == null) return null;
  // מסיר תוויות מטבע, טקסט "was", רווחים, פסיקים
  const cleaned = String(str)
    .replace(/was\s*/i, '')
    .replace(/[£$€¥₩₪]/g, '')
    .replace(/[^\d.]/g, '');  // משאיר רק ספרות ונקודה

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * extractDiscount — מחשב אחוז הנחה.
 * מחזיר מספר שלם (e.g. 33), או null אם הנתונים חסרים.
 *
 * @param {number|null} price        — מחיר נוכחי
 * @param {number|null} originalPrice — מחיר מקורי
 * @returns {number|null}
 */
export function extractDiscount(price, originalPrice) {
  if (price == null || originalPrice == null) return null;
  if (originalPrice <= 0) return null;
  if (price >= originalPrice) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

/**
 * isValidDeal — האם הדיל תקין ועומד בסף המינימום?
 * תנאים: originalPrice > price, discount >= MIN_DISCOUNT_PCT, price > 0
 *
 * @param {number|null} price
 * @param {number|null} originalPrice
 * @returns {boolean}
 */
export function isValidDeal(price, originalPrice) {
  if (price == null || originalPrice == null) return false;
  if (price <= 0) return false;
  const discount = extractDiscount(price, originalPrice);
  if (discount == null) return false;
  return discount >= MIN_DISCOUNT_PCT;
}

/**
 * buildDealPayload — בונה אובייקט מוכן ל-Supabase INSERT/UPSERT.
 *
 * @param {{title, price, originalPrice, productUrl, imageUrl, description}} product
 * @param {string} storeName
 * @param {string} categorySlug
 * @param {string} currency
 * @param {string} country
 * @returns {object}
 */
export function buildDealPayload(product, storeName, categorySlug, currency, country) {
  return {
    title_en:      product.title      || null,
    title_he:      null,               // יתורגם ע"י BOT-25
    storeName_en:  storeName,
    category_slug: categorySlug,
    price:         product.price,
    originalPrice: product.originalPrice,
    currency:      currency,
    productUrl:    product.productUrl  || null,
    affiliateUrl:  product.productUrl  || null, // BOT-29 יחליף לקישור אפיליאציה
    imageUrl:      product.imageUrl    || null,
    description_en: product.description || null,
    shippingCost:  0,
    country:       country,
    inStock:       true,
    status:        'pending',           // עובר דרך pipeline BOT-17/22/23
    source:        'scraper_t1',
    tags:          [storeName.toLowerCase(), categorySlug, 'sale'],
  };
}

// ════════════════════════════════════════════════════════════
// פונקציות Scraping — פר-חנות
// ════════════════════════════════════════════════════════════

/**
 * fetchViaScraperAPI — מבצע GET דרך ScraperAPI ומחזיר HTML כטקסט.
 * אם ScraperAPI_KEY חסר, זורק שגיאה.
 *
 * @param {string} targetUrl
 * @returns {Promise<string>}
 */
async function fetchViaScraperAPI(targetUrl) {
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) throw new Error('SCRAPERAPI_KEY לא הוגדר ב-.env');

  const scraperUrl = `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true`;
  const res = await fetch(scraperUrl, { signal: AbortSignal.timeout(60_000) });

  if (!res.ok) {
    throw new Error(`ScraperAPI החזיר ${res.status} עבור: ${targetUrl}`);
  }
  return res.text();
}

// ── H&M parser ───────────────────────────────────────────────
/**
 * parseHM — מחלץ מוצרים מ-HTML של H&M.
 * H&M משתמש ב-<article class="product-item"> עם data-title, data-price.
 * כ-fallback מחפשים <h3> ו-<a> עם מחירים.
 */
function parseHM(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  // H&M article-based structure
  const articles = root.querySelectorAll('article');
  for (const article of articles.slice(0, MAX_PER_STORE)) {
    const titleEl   = article.querySelector('h3, h2, [class*="product-item__name"], [class*="product-name"]');
    const linkEl    = article.querySelector('a[href]');
    const imgEl     = article.querySelector('img[src]');
    const priceEl   = article.querySelector('[class*="price--sale"], [class*="sale-price"], [class*="current-price"]');
    const origEl    = article.querySelector('[class*="price--regular"], [class*="regular-price"], del, s');

    const title        = titleEl?.text?.trim();
    const rawPrice     = priceEl?.text?.trim() || '';
    const rawOrigPrice = origEl?.text?.trim()  || '';
    const href         = linkEl?.getAttribute('href') || '';
    const imgSrc       = imgEl?.getAttribute('src')   || imgEl?.getAttribute('data-src') || '';

    const price     = cleanPrice(rawPrice);
    const origPrice = cleanPrice(rawOrigPrice);

    if (!title || !price) continue;

    const productUrl = href.startsWith('http') ? href : `${storeBaseUrl}${href}`;
    const imageUrl   = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc;

    products.push({ title, price, originalPrice: origPrice, productUrl, imageUrl, description: '' });
  }

  return products;
}

// ── Zara parser ───────────────────────────────────────────────
/**
 * parseZara — מחלץ מוצרים מ-HTML של Zara.
 * Zara משתמש ב-<li class="product"> עם <a class="link">.
 */
function parseZara(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll('li[class*="product"], div[class*="product-grid-product"]');
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="product-grid-product-info__name"], h2, h3');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="price__amount--sale"], [class*="sale"]');
    const origEl    = item.querySelector('[class*="price__amount--line-through"], del, s');

    const title        = titleEl?.text?.trim();
    const rawPrice     = priceEl?.text?.trim() || '';
    const rawOrigPrice = origEl?.text?.trim()  || '';
    const href         = linkEl?.getAttribute('href') || '';
    const imgSrc       = imgEl?.getAttribute('src')   || imgEl?.getAttribute('data-src') || '';

    const price     = cleanPrice(rawPrice);
    const origPrice = cleanPrice(rawOrigPrice);

    if (!title || !price) continue;

    const productUrl = href.startsWith('http') ? href : `${storeBaseUrl}${href}`;
    const imageUrl   = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc;

    products.push({ title, price, originalPrice: origPrice, productUrl, imageUrl, description: '' });
  }

  return products;
}

// ── Mango parser ──────────────────────────────────────────────
/**
 * parseMango — מחלץ מוצרים מ-HTML של Mango.
 */
function parseMango(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll('[class*="product-item"], [class*="product-card"], article');
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="product-item__name"], [class*="name"], h3, h2');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="sale"], [class*="reduced"], [class*="offer-price"]');
    const origEl    = item.querySelector('del, s, [class*="original"], [class*="old-price"]');

    const title        = titleEl?.text?.trim();
    const rawPrice     = priceEl?.text?.trim() || '';
    const rawOrigPrice = origEl?.text?.trim()  || '';
    const href         = linkEl?.getAttribute('href') || '';
    const imgSrc       = imgEl?.getAttribute('src')   || imgEl?.getAttribute('data-src') || '';

    const price     = cleanPrice(rawPrice);
    const origPrice = cleanPrice(rawOrigPrice);

    if (!title || !price) continue;

    const productUrl = href.startsWith('http') ? href : `${storeBaseUrl}${href}`;
    const imageUrl   = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc;

    products.push({ title, price, originalPrice: origPrice, productUrl, imageUrl, description: '' });
  }

  return products;
}

// ── IKEA parser ───────────────────────────────────────────────
/**
 * parseIKEA — מחלץ מוצרים מ-HTML של IKEA (עמוד offers).
 * IKEA משתמש ב-<div class="range-offer-message"> ו-<article>.
 */
function parseIKEA(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[class*="plp-fragment-wrapper"], [class*="pip-product"], article, [class*="range-offer"]'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="pip-header__label"], h3, h2, [class*="product-compact__name"]');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="pip-price__integer"], [class*="price"]');
    const origEl    = item.querySelector('del, s, [class*="pip-price--previous"]');

    const title        = titleEl?.text?.trim();
    const rawPrice     = priceEl?.text?.trim() || '';
    const rawOrigPrice = origEl?.text?.trim()  || '';
    const href         = linkEl?.getAttribute('href') || '';
    const imgSrc       = imgEl?.getAttribute('src')   || imgEl?.getAttribute('data-src') || '';

    const price     = cleanPrice(rawPrice);
    const origPrice = cleanPrice(rawOrigPrice);

    if (!title || !price) continue;

    const productUrl = href.startsWith('http') ? href : `${storeBaseUrl}${href}`;
    const imageUrl   = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc;

    products.push({ title, price, originalPrice: origPrice, productUrl, imageUrl, description: '' });
  }

  return products;
}

// ── NET-A-PORTER parser ───────────────────────────────────────
/**
 * parseNAP — מחלץ מוצרים מ-HTML של NET-A-PORTER.
 */
function parseNAP(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[class*="product-card"], [class*="productCard"], [class*="product-item"], li[data-product-id]'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="product-card__name"], [class*="product-name"], h3, h2');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="sale-price"], [class*="price--sale"], [class*="price--red"]');
    const origEl    = item.querySelector('[class*="was-price"], del, s, [class*="full-price"]');

    const title        = titleEl?.text?.trim();
    const rawPrice     = priceEl?.text?.trim() || '';
    const rawOrigPrice = origEl?.text?.trim()  || '';
    const href         = linkEl?.getAttribute('href') || '';
    const imgSrc       = imgEl?.getAttribute('src')   || imgEl?.getAttribute('data-src') || '';

    const price     = cleanPrice(rawPrice);
    const origPrice = cleanPrice(rawOrigPrice);

    if (!title || !price) continue;

    const productUrl = href.startsWith('http') ? href : `${storeBaseUrl}${href}`;
    const imageUrl   = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc;

    products.push({ title, price, originalPrice: origPrice, productUrl, imageUrl, description: '' });
  }

  return products;
}

// ════════════════════════════════════════════════════════════
// קונפיגורציית חנויות
// ════════════════════════════════════════════════════════════

const STORE_CONFIGS = [
  {
    name:     'H&M',
    category: 'fashion',
    currency: 'GBP',
    country:  'GB',
    baseUrl:  'https://www2.hm.com',
    urls: [
      'https://www2.hm.com/en_gb/sale/ladies.html',
      'https://www2.hm.com/en_gb/sale/men.html',
    ],
    parser: parseHM,
  },
  {
    name:     'Zara',
    category: 'fashion',
    currency: 'GBP',
    country:  'GB',
    baseUrl:  'https://www.zara.com',
    urls: [
      'https://www.zara.com/gb/en/woman-specials-l1358.html',
      'https://www.zara.com/gb/en/man-specials-l1364.html',
    ],
    parser: parseZara,
  },
  {
    name:     'Mango',
    category: 'fashion',
    currency: 'GBP',
    country:  'GB',
    baseUrl:  'https://shop.mango.com',
    urls: [
      'https://shop.mango.com/gb/women/specials-new-collection',
    ],
    parser: parseMango,
  },
  {
    name:     'IKEA',
    category: 'home',
    currency: 'GBP',
    country:  'GB',
    baseUrl:  'https://www.ikea.com',
    urls: [
      'https://www.ikea.com/gb/en/offers/',
    ],
    parser: parseIKEA,
  },
  {
    name:     'NET-A-PORTER',
    category: 'fashion',
    currency: 'GBP',
    country:  'GB',
    baseUrl:  'https://www.net-a-porter.com',
    urls: [
      'https://www.net-a-porter.com/en-gb/shop/sale',
    ],
    parser: parseNAP,
  },
];

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`logStart failed: ${error.message}`);
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
// scrapeStore — סריקת חנות אחת (כל ה-URLs שלה)
// ════════════════════════════════════════════════════════════

/**
 * scrapeStore — מביא HTML לכל URL של חנות, מנתח, ומחזיר מערך payloads תקינים.
 *
 * @param {object} storeConfig
 * @param {object} logger
 * @returns {Promise<object[]>}
 */
export async function scrapeStore(storeConfig, logger) {
  const { name, category, currency, country, baseUrl, urls, parser } = storeConfig;
  const allPayloads = [];

  for (const url of urls) {
    logger.log(`[${name}] מביא: ${url}`);
    let html;
    try {
      html = await fetchViaScraperAPI(url);
    } catch (e) {
      logger.err(`[${name}] fetchViaScraperAPI נכשל (${url}): ${e.message}`);
      continue; // ממשיך ל-URL הבא — לא עוצר את כל החנות
    }

    let rawProducts;
    try {
      rawProducts = parser(html, baseUrl);
    } catch (e) {
      logger.err(`[${name}] parser נכשל (${url}): ${e.message}`);
      continue;
    }

    logger.log(`[${name}] נמצאו ${rawProducts.length} מוצרים גולמיים ב-${url}`);

    for (const prod of rawProducts) {
      if (!isValidDeal(prod.price, prod.originalPrice)) continue;
      if (!prod.productUrl) continue;

      const payload = buildDealPayload(prod, name, category, currency, country);
      allPayloads.push(payload);

      if (allPayloads.length >= MAX_PER_STORE) break;
    }

    if (allPayloads.length >= MAX_PER_STORE) break;
    await sleep(DELAY_MS);
  }

  logger.ok(`[${name}] ${allPayloads.length} דילים תקינים לאחר סינון`);
  return allPayloads;
}

// ════════════════════════════════════════════════════════════
// upsertDeals — UPSERT ל-Supabase
// ════════════════════════════════════════════════════════════

/**
 * upsertDeals — מכניס/מעדכן batch של דילים.
 * onConflict: 'productUrl' — מונע כפילויות.
 *
 * @param {object[]} payloads
 * @param {object} logger
 * @returns {Promise<{added: number, updated: number}>}
 */
async function upsertDeals(payloads, logger) {
  if (payloads.length === 0) return { added: 0, updated: 0 };

  const { data, error } = await supabase
    .from('deals')
    .upsert(payloads, { onConflict: 'productUrl', ignoreDuplicates: false })
    .select('id');

  if (error) {
    logger.err(`upsert נכשל: ${error.message}`);
    return { added: 0, updated: 0 };
  }

  // Supabase לא מחזיר מה חדש ומה עודכן ב-upsert, אז נחשיב הכל כ"added"
  logger.ok(`upsert הצליח: ${data?.length || 0} שורות`);
  return { added: data?.length || 0, updated: 0 };
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-09 Scraping Tier 1 — מתחיל ===');
  logger.log(`חנויות: ${STORE_CONFIGS.map(s => s.name).join(', ')}`);

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { added: 0, updated: 0, errors: [] };

  try {
    for (const storeConfig of STORE_CONFIGS) {
      logger.log(`\n--- מתחיל חנות: ${storeConfig.name} ---`);

      const payloads = await scrapeStore(storeConfig, logger);

      if (payloads.length > 0) {
        const result = await upsertDeals(payloads, logger);
        stats.added   += result.added;
        stats.updated += result.updated;
      }

      // עיכוב בין חנויות שונות
      await sleep(DELAY_MS);
    }

    logger.ok(`=== BOT-09 סיים — added: ${stats.added}, updated: ${stats.updated} — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) {
      await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
    }
  }
}

main();
