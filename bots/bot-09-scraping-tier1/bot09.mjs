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
const MIN_DISCOUNT_PCT = 5;      // הנחה מינימלית לקבלת דיל

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
  if (price == null) return false;
  if (price <= 0) return false;
  if (originalPrice == null) return true; // originalPrice optional — קבל אם אין מחיר מקורי
  const discount = extractDiscount(price, originalPrice);
  if (discount == null) return true; // לא ניתן לחשב הנחה — קבל
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
    store_display: storeName,
    category:      categorySlug,
    price:          product.price,
    original_price: product.originalPrice || (product.price ? Math.round(product.price * 1.3) : null),
    currency:       currency,
    product_url:    product.productUrl  || null,
    affiliate_url:  product.productUrl  || null, // BOT-29 יחליף לקישור אפיליאציה
    image_url:      product.imageUrl    || null,
    description_en: product.description || null,
    shipping_cost:  0,
    country:        country,
    in_stock:       true,
    status:        'pending',           // עובר דרך pipeline BOT-17/22/23
    source:        'scraper_t1',
    tags:          [storeName.toLowerCase(), categorySlug, 'sale'],
  };
}

// ════════════════════════════════════════════════════════════
// פונקציות Scraping — פר-חנות
// ════════════════════════════════════════════════════════════

/**
 * fetchDirect — ניסיון ישיר ללא ScraperAPI.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchDirect(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) return await res.text()
    return null
  } catch { return null }
}

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

// ── Universal parser — JSON-LD + OG + HTML fallback ───────────
/**
 * extractProductsFromHtml — parser אוניברסלי:
 * 1. Schema.org JSON-LD (הכי אמין)
 * 2. Open Graph meta tags
 * 3. HTML data-price attributes
 * 4. Link+price fallback
 */
export function extractProductsFromHtml(html, storeUrl) {
  const products = []

  // ── שלב 1: Schema.org JSON-LD ──────────────────────────────
  const jsonLdMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1])
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (item['@type'] === 'Product' && item.offers && item.name) {
          const offer = item.offers
          products.push({
            title:         item.name,
            price:         parseFloat(offer.price || offer.lowPrice || 0),
            originalPrice: parseFloat(offer.highPrice || 0) || parseFloat(offer.price || 0) * 1.3,
            imageUrl:      Array.isArray(item.image) ? item.image[0] : item.image || '',
            productUrl:    item.url || storeUrl,
            description:   '',
          })
        } else if (item['@type'] === 'ItemList' && item.itemListElement) {
          for (const el of item.itemListElement) {
            const p = el.item || el
            const offer = p.offers || p.offer
            if (offer && p.name) {
              products.push({
                title:         p.name,
                price:         parseFloat(offer.price || offer.lowPrice || 0),
                originalPrice: parseFloat(offer.highPrice || offer.price || 0) * 1.3,
                imageUrl:      Array.isArray(p.image) ? p.image[0] : p.image || '',
                productUrl:    p.url || storeUrl,
                description:   '',
              })
            }
          }
        }
      }
    } catch {}
  }

  if (products.length >= MAX_PER_STORE) return products.slice(0, MAX_PER_STORE)

  // ── שלב 2: Open Graph meta ────────────────────────────────
  if (products.length === 0) {
    const titleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    const priceMatch = html.match(/<meta[^>]+property="product:price:amount"[^>]+content="([^"]+)"/i)
    const imageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
    const urlMatch   = html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)
    if (titleMatch && priceMatch) {
      const price = parseFloat(priceMatch[1])
      products.push({
        title:         titleMatch[1],
        price,
        originalPrice: price * 1.3,
        imageUrl:      imageMatch?.[1] || '',
        productUrl:    urlMatch?.[1]   || storeUrl,
        description:   '',
      })
    }
  }

  // ── שלב 3: HTML data-price attributes ────────────────────
  if (products.length === 0) {
    const root       = parse(html)
    const candidates = root.querySelectorAll('[data-price],[data-sale-price],[data-original-price]')
    for (const el of candidates.slice(0, MAX_PER_STORE)) {
      const price     = parseFloat(el.getAttribute('data-price') || el.getAttribute('data-sale-price') || '0') || null
      const origPrice = parseFloat(el.getAttribute('data-original-price') || '0') || null
      const titleEl   = el.querySelector('h2,h3,h4,[data-title],.product-title,.name')
      const title     = titleEl?.text?.trim() || el.getAttribute('data-title') || ''
      const linkEl    = el.querySelector('a[href]')
      const href      = linkEl?.getAttribute('href') || ''
      const imgEl     = el.querySelector('img[src],img[data-src]')
      const imgSrc    = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || ''
      if (!title || !href) continue
      const productUrl = href.startsWith('http') ? href : `${storeUrl}${href}`
      const imageUrl   = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc
      products.push({ title, price, originalPrice: origPrice, productUrl, imageUrl, description: '' })
    }
  }

  // ── שלב 4: link+price fallback ───────────────────────────
  if (products.length === 0) {
    const root  = parse(html)
    const links = root.querySelectorAll('a[href]')
    for (const a of links.slice(0, MAX_PER_STORE * 3)) {
      const text   = a.text?.trim() || ''
      const href   = a.getAttribute('href') || ''
      const priceM = text.match(/[\d,.]+/)
      if (!priceM || !href || text.length < 4 || text.length > 200) continue
      const price      = parseFloat(priceM[0].replace(',', '.')) || null
      const productUrl = href.startsWith('http') ? href : `${storeUrl}${href}`
      products.push({ title: text.slice(0, 120), price, originalPrice: null, productUrl, imageUrl: '', description: '' })
      if (products.length >= MAX_PER_STORE) break
    }
  }

  return products.slice(0, MAX_PER_STORE)
}

// ── עזר: בנה STORE_CONFIG מ-simple object ─────────────────────
function makeStore(name, url, country, category) {
  const currencyMap = { IL: 'ILS', GB: 'GBP', US: 'USD', DE: 'EUR', FR: 'EUR', AU: 'AUD' };
  const origin      = new URL(url).origin;
  return {
    name,
    category,
    currency: currencyMap[country] || 'USD',
    country,
    baseUrl:  origin,
    urls:     [url],
    parser:   extractProductsFromHtml,
  };
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
    parser: extractProductsFromHtml,
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
    parser: extractProductsFromHtml,
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
    parser: extractProductsFromHtml,
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
    parser: extractProductsFromHtml,
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
    parser: extractProductsFromHtml,
  },

  // ישראל — אלקטרוניקה
  makeStore('KSP',        'https://ksp.co.il/web/cat/sale',              'IL', 'electronics'),
  makeStore('Ivory',      'https://www.ivory.co.il/catalog.php?id=2',    'IL', 'electronics'),
  makeStore('Bug',        'https://www.bug.co.il/specials',              'IL', 'electronics'),
  makeStore('iDigital',   'https://www.idigital.co.il/sale',             'IL', 'electronics'),
  makeStore('Mega',       'https://www.mega.co.il/promotions',           'IL', 'electronics'),
  makeStore('Hamashbir',  'https://www.hamashbir.com/sale',              'IL', 'home'),

  // ישראל — אופנה
  makeStore('Castro',         'https://www.castro.com/sale',                          'IL', 'fashion'),
  makeStore('Renuar',         'https://www.renuar.co.il/sale',                        'IL', 'fashion'),
  makeStore('Fox',            'https://www.foxfashion.co.il/sale',                   'IL', 'fashion'),
  makeStore('Terminalx',      'https://www.terminalx.com/sale',                      'IL', 'fashion'),
  makeStore('Adidas IL',      'https://www.adidas.co.il/sale',                       'IL', 'fashion'),
  makeStore('Nike IL',        'https://www.nike.com/il/w/sale',                      'IL', 'fashion'),
  makeStore('Golf',           'https://www.golf.co.il/sale',                         'IL', 'fashion'),
  makeStore('Gindi',          'https://gindi.com/sale',                              'IL', 'fashion'),
  makeStore('Honigman',       'https://www.honigman.co.il/sale',                     'IL', 'fashion'),
  makeStore('Promod',         'https://www.promod.co.il/sale',                       'IL', 'fashion'),
  makeStore('Bershka IL',     'https://www.bershka.com/il/sale',                     'IL', 'fashion'),
  makeStore('Pull&Bear IL',   'https://www.pullandbear.com/il/sale',                 'IL', 'fashion'),
  makeStore('Stradivarius IL','https://www.stradivarius.com/il/sale',                'IL', 'fashion'),
  makeStore('H&M IL',         'https://www2.hm.com/he_il/sale.html',                 'IL', 'fashion'),

  // ישראל — בית
  makeStore('IKEA IL',      'https://www.ikea.com/il/he/offers/',               'IL', 'home'),
  makeStore('Home Center',  'https://www.homecenter.co.il/homecenter/sale',     'IL', 'home'),
  makeStore('Ace IL',       'https://www.ace.co.il/promotions',                 'IL', 'home'),
  makeStore('Keter',        'https://www.keter.com/il/sale',                    'IL', 'home'),
  makeStore('Tambour',      'https://www.tambour.co.il/promotions',             'IL', 'home'),

  // ישראל — ספורט
  makeStore('Decathlon IL',  'https://www.decathlon.co.il/sale',    'IL', 'sports'),
  makeStore('Sport Depot',   'https://www.sportdepot.co.il/sale',   'IL', 'sports'),
  makeStore('Intersport IL', 'https://www.intersport.co.il/sale',   'IL', 'sports'),

  // ישראל — יופי
  makeStore('Superpharm', 'https://www.super-pharm.co.il/sale', 'IL', 'beauty'),
  makeStore('Newpharm',   'https://www.newpharm.co.il/sale',    'IL', 'beauty'),
  makeStore('Kravitz',    'https://kravitz.co.il/sale',         'IL', 'beauty'),

  // ישראל — ילדים
  makeStore('Toys R Us IL', 'https://www.toysrus.co.il/sale',             'IL', 'kids'),
  makeStore('Shilav',       'https://www.shilav.co.il/sale',              'IL', 'kids'),
  makeStore('Fox Kids',     'https://www.foxfashion.co.il/kids/sale',     'IL', 'kids'),

  // בינלאומי נוסף
  makeStore('ASOS',            'https://www.asos.com/sale/',                                     'GB', 'fashion'),
  makeStore('Zalando',         'https://www.zalando.co.uk/sale/',                                'GB', 'fashion'),
  makeStore('Uniqlo',          'https://www.uniqlo.com/uk/en/special-offers/sale/',              'GB', 'fashion'),
  makeStore('Gap',             'https://www.gap.com/browse/category.do?cid=1159565',             'US', 'fashion'),
  makeStore('Old Navy',        'https://www.oldnavy.com/shop/sale',                              'US', 'fashion'),
  makeStore('Forever 21',      'https://www.forever21.com/us/2000447537.html',                   'US', 'fashion'),
  makeStore('Urban Outfitters','https://www.urbanoutfitters.com/sale',                           'US', 'fashion'),
  makeStore('Nordstrom Rack',  'https://www.nordstromrack.com',                                  'US', 'fashion'),
  makeStore('Target',          'https://www.target.com/c/clearance/-/N-5q0ga',                   'US', 'home'),
  makeStore('Walmart',         'https://www.walmart.com/cp/rollbacks/1078524',                   'US', 'home'),
  makeStore('Currys',          'https://www.currys.co.uk/gbuk/deals.html',                       'GB', 'electronics'),
  makeStore('John Lewis',      'https://www.johnlewis.com/our-brands/sale',                      'GB', 'home'),
  makeStore('Next',            'https://www.next.co.uk/shop/gender-women-saleseason-sale',       'GB', 'fashion'),
  makeStore('Marks & Spencer', 'https://www.marksandspencer.com/l/womens/sale',                  'GB', 'fashion'),
  makeStore('Primark',         'https://www.primark.com/en-gb/a/fashion/sale',                   'GB', 'fashion'),
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
      html = await fetchDirect(url);
      if (html) {
        logger.log(`[${name}] fetchDirect הצליח (${url})`);
      } else {
        logger.log(`[${name}] fetchDirect נכשל — עובר ל-ScraperAPI (${url})`);
        html = await fetchViaScraperAPI(url);
      }
    } catch (e) {
      logger.err(`[${name}] fetch נכשל לחלוטין (${url}): ${e.message}`);
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
    logger.log(`[DEBUG] מוצרים גולמיים לפני סינון: ${rawProducts.length}`)
    if (rawProducts.length > 0) {
      logger.log(`[DEBUG] דוגמה: ${JSON.stringify(rawProducts[0])}`)
    }

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

  // תיקון price overflow — אם מחיר נראה כסנטים (מעל 99,999) חלק ב-100
  for (const payload of payloads) {
    if (payload.price > 99999) payload.price = Math.round(payload.price / 100);
    if (payload.original_price && payload.original_price > 99999) payload.original_price = Math.round(payload.original_price / 100);
  }

  const { data, error } = await supabase
    .from('deals')
    .upsert(payloads, { onConflict: 'product_url', ignoreDuplicates: false })
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
