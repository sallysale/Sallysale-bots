// ════════════════════════════════════════════════════════════
// BOT-10 — Scraping Tier 2
// תפקיד: סורק חנויות ישראליות + חנויות EU קטנות.
//         Fox, Castro, Terminal X, Renuar (ILS), ASOS, About You (GBP/EUR).
//
// כלי ניתוח HTML: node-html-parser
// שיטת scraping: ScraperAPI עם render=true
// שיטת UPSERT: onConflict='productUrl' — מונע כפילויות
//
// תדירות: כל 12 שעות (Railway cron: 0 */12 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import { parse } from 'node-html-parser';
import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID           = 'BOT-10';
const DELAY_MS         = 2000;   // 2 שניות בין בקשות
const MAX_PER_STORE    = 50;     // מקסימום מוצרים לחנות בהרצה אחת
const MIN_DISCOUNT_PCT = 10;     // סף הנחה מינימלי

// ── sleep ─────────────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
// פונקציות עזר — נטו (pure), ללא תלות ב-DB או HTTP
// ════════════════════════════════════════════════════════════

/**
 * cleanPrice — מחלץ מספר מחרוזת מחיר.
 * תומך ב:
 *   ₪299       → 299
 *   299 ש"ח    → 299
 *   £29.99     → 29.99
 *   $49        → 49
 *   €49.99     → 49.99
 *   was £99.99 → 99.99
 *   1,299      → 1299
 *
 * @param {string} str
 * @returns {number|null}
 */
export function cleanPrice(str) {
  if (str == null) return null;
  const s = String(str);

  // מסיר "was", רווחים מיותרים
  let cleaned = s.replace(/was\s*/i, '').trim();

  // מסיר ש"ח (עברית) ו-שקל
  cleaned = cleaned.replace(/ש["״]ח/g, '').replace(/שקל/g, '');

  // מסיר סימני מטבע ותוויות
  cleaned = cleaned.replace(/[£$€¥₩₪]/g, '');

  // מסיר פסיקים (1,299 → 1299)
  cleaned = cleaned.replace(/,/g, '');

  // מסיר כל מה שאינו ספרה או נקודה
  cleaned = cleaned.replace(/[^\d.]/g, '');

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * extractDiscount — מחשב אחוז הנחה.
 * מחזיר מספר שלם, או null אם נתונים חסרים.
 *
 * @param {number|null} price
 * @param {number|null} originalPrice
 * @returns {number|null}
 */
export function extractDiscount(price, originalPrice) {
  if (price == null || originalPrice == null) return null;
  if (originalPrice <= 0) return null;
  if (price >= originalPrice) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

/**
 * isValidDeal — בודק תקינות דיל.
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
 * @param {string} currency    — 'ILS' / 'GBP' / 'EUR'
 * @param {string} country     — 'IL' / 'GB' / 'DE'
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
    affiliateUrl:  product.productUrl  || null, // BOT-29 יחליף
    imageUrl:      product.imageUrl    || null,
    description_en: product.description || null,
    shippingCost:  0,
    country:       country,
    inStock:       true,
    status:        'pending',           // עובר דרך pipeline BOT-17/22/23
    source:        'scraper_t2',
    tags:          [storeName.toLowerCase(), categorySlug, 'sale'],
  };
}

// ════════════════════════════════════════════════════════════
// פונקציות Scraping — פר-חנות
// ════════════════════════════════════════════════════════════

/**
 * fetchViaScraperAPI — מביא HTML דרך ScraperAPI.
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

// ── Fox (Israel) parser ───────────────────────────────────────
/**
 * parseFox — מחלץ מוצרי סייל מאתר FOX ישראל.
 * FOX משתמש ב-ILS (₪) ובמבנה אנגלי/עברי מעורב.
 */
function parseFox(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[class*="product-item"], [class*="product-card"], [class*="plp-item"], li[class*="item"]'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="product-name"], [class*="title"], h3, h2');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    // מחיר מבצע / מקורי — FOX מציג ₪ לידם
    const priceEl   = item.querySelector('[class*="sale-price"], [class*="discount-price"], [class*="special-price"]');
    const origEl    = item.querySelector('[class*="regular-price"], [class*="old-price"], del, s');

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

// ── Castro (Israel) parser ───────────────────────────────────
/**
 * parseCastro — מחלץ מוצרים מאתר קסטרו ישראל.
 */
function parseCastro(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[class*="product"], article, [class*="item"], li[data-product-id]'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="name"], h3, h2, [class*="title"]');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="sale"], [class*="offer"], [class*="special"]');
    const origEl    = item.querySelector('del, s, [class*="old"], [class*="origin"]');

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

// ── Terminal X (Israel) parser ───────────────────────────────
/**
 * parseTerminalX — מחלץ מוצרים מ-Terminal X.
 * Terminal X משתמש ב-React SSR — נחפש JSON מוטמע ב-HTML.
 */
function parseTerminalX(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  // ניסיון ראשון: JSON מוטמע ב-script
  const scriptTags = root.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scriptTags) {
    try {
      const json = JSON.parse(script.text);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item['@type'] !== 'Product') continue;
        const offer      = item.offers?.offers?.[0] || item.offers;
        if (!offer) continue;
        const price      = parseFloat(offer.price || 0);
        const origPrice  = parseFloat(offer.originalPrice || offer.highPrice || 0);
        const productUrl = item.url || '';
        const imageUrl   = Array.isArray(item.image) ? item.image[0] : item.image || '';
        const title      = item.name || '';
        if (!title || !price) continue;
        products.push({ title, price, originalPrice: origPrice || null, productUrl, imageUrl, description: '' });
        if (products.length >= MAX_PER_STORE) break;
      }
    } catch (_) { /* לא JSON תקין — נמשיך */ }
    if (products.length >= MAX_PER_STORE) break;
  }

  // fallback: HTML parsing
  if (products.length === 0) {
    const items = root.querySelectorAll('[class*="product"], article, li[class*="item"]');
    for (const item of items.slice(0, MAX_PER_STORE)) {
      const titleEl   = item.querySelector('[class*="name"], h3, h2');
      const linkEl    = item.querySelector('a[href]');
      const imgEl     = item.querySelector('img');
      const priceEl   = item.querySelector('[class*="sale"], [class*="price"]');
      const origEl    = item.querySelector('del, s');

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
  }

  return products;
}

// ── Renuar (Israel) parser ───────────────────────────────────
/**
 * parseRenuar — מחלץ מוצרים מ-Renuar.co.il.
 */
function parseRenuar(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[class*="product-item"], [class*="item-inner"], [class*="product-card"], article'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="product-name"], [class*="title"], h3, h2');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="special-price"], [class*="sale"], [class*="new-price"]');
    const origEl    = item.querySelector('[class*="old-price"], [class*="regular"], del, s');

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

// ── ASOS parser ───────────────────────────────────────────────
/**
 * parseASOS — מחלץ מוצרים מ-ASOS.
 * ASOS משתמש ב-JSON data-bind ב-HTML.
 */
function parseASOS(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[data-auto-id="productList"] article, [class*="product-link-container"], li[class*="product"]'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="product-description"], [data-auto-id="productDescription"], h3, h2');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="reduced-price"], [class*="sale"], [data-auto-id="reducedPrice"]');
    const origEl    = item.querySelector('[class*="previous-price"], [data-auto-id="previousPrice"], del, s');

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

// ── About You parser ──────────────────────────────────────────
/**
 * parseAboutYou — מחלץ מוצרים מ-About You (EU).
 */
function parseAboutYou(html, storeBaseUrl) {
  const root     = parse(html);
  const products = [];

  const items = root.querySelectorAll(
    '[data-testid="product-card"], [class*="ProductCard"], [class*="product-card"], article'
  );
  for (const item of items.slice(0, MAX_PER_STORE)) {
    const titleEl   = item.querySelector('[class*="ProductName"], [class*="product-name"], h3, h2');
    const linkEl    = item.querySelector('a[href]');
    const imgEl     = item.querySelector('img');
    const priceEl   = item.querySelector('[class*="SalePrice"], [class*="sale-price"], [class*="reduced"]');
    const origEl    = item.querySelector('[class*="BasePrice"], [class*="original-price"], del, s');

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
    name:     'Fox',
    category: 'fashion',
    currency: 'ILS',
    country:  'IL',
    baseUrl:  'https://www.fox.co.il',
    urls:     ['https://www.fox.co.il/sale'],
    parser:   parseFox,
  },
  {
    name:     'Castro',
    category: 'fashion',
    currency: 'ILS',
    country:  'IL',
    baseUrl:  'https://www.castro.com',
    urls:     ['https://www.castro.com/sale'],
    parser:   parseCastro,
  },
  {
    name:     'Terminal X',
    category: 'fashion',
    currency: 'ILS',
    country:  'IL',
    baseUrl:  'https://www.terminalx.com',
    urls:     ['https://www.terminalx.com/sale'],
    parser:   parseTerminalX,
  },
  {
    name:     'Renuar',
    category: 'fashion',
    currency: 'ILS',
    country:  'IL',
    baseUrl:  'https://www.renuar.co.il',
    urls:     ['https://www.renuar.co.il/sale/'],
    parser:   parseRenuar,
  },
  {
    name:     'ASOS',
    category: 'fashion',
    currency: 'GBP',
    country:  'GB',
    baseUrl:  'https://www.asos.com',
    urls:     ['https://www.asos.com/women/sale/'],
    parser:   parseASOS,
  },
  {
    name:     'About You',
    category: 'fashion',
    currency: 'EUR',
    country:  'DE',
    baseUrl:  'https://www.aboutyou.com',
    urls:     ['https://www.aboutyou.com/c/sale'],
    parser:   parseAboutYou,
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
// scrapeStore — סריקת חנות אחת
// ════════════════════════════════════════════════════════════

/**
 * scrapeStore — מביא + מנתח + מסנן דילים לחנות אחת.
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
      continue;
    }

    let rawProducts;
    try {
      rawProducts = parser(html, baseUrl);
    } catch (e) {
      logger.err(`[${name}] parser נכשל (${url}): ${e.message}`);
      continue;
    }

    logger.log(`[${name}] נמצאו ${rawProducts.length} מוצרים גולמיים`);

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

  logger.ok(`[${name}] ${allPayloads.length} דילים תקינים אחרי סינון`);
  return allPayloads;
}

// ════════════════════════════════════════════════════════════
// upsertDeals
// ════════════════════════════════════════════════════════════

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

  logger.ok(`upsert הצליח: ${data?.length || 0} שורות`);
  return { added: data?.length || 0, updated: 0 };
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-10 Scraping Tier 2 — מתחיל ===');
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
      logger.log(`\n--- מתחיל חנות: ${storeConfig.name} (${storeConfig.currency}/${storeConfig.country}) ---`);

      const payloads = await scrapeStore(storeConfig, logger);

      if (payloads.length > 0) {
        const result = await upsertDeals(payloads, logger);
        stats.added   += result.added;
        stats.updated += result.updated;
      }

      await sleep(DELAY_MS);
    }

    logger.ok(`=== BOT-10 סיים — added: ${stats.added}, updated: ${stats.updated} — ${logger.elapsed()} ===`);

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
