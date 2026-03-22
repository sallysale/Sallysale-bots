// ════════════════════════════════════════════════════════════
// BOT-07 — eBay EPN (Finding API)
// תפקיד: מחפש פריטים במבצע בeBay דרך Finding API,
//         מסנן לפי הנחה מינימלית 15%, ומוסיף לSupabase.
//
// API: eBay Finding API v1 — findItemsAdvanced
// קטגוריות: ביגוד נשים, ביגוד גברים, נעליים, אלקטרוניקה
// תדירות: כל שעה (Railway cron: 0 * * * *)
// מקסימום: 200 פריטים להרצה (2 עמודים × 100)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-07';

// ── קונפיגורציה ────────────────────────────────────────────

const EBAY_APP_ID     = process.env.EBAY_APP_ID     || '';
const EBAY_CAMPAIGN_ID = process.env.EBAY_CAMPAIGN_ID || '';

// eBay Finding API endpoint
const FINDING_API_URL = 'https://svcs.ebay.com/services/search/FindingService/v1';

// קטגוריות eBay לסריקה:
// 11450 = Women's Clothing, 15032 = Men's Clothing,
// 58058 = Shoes, 9355 = Electronics
const CATEGORY_IDS = ['11450', '15032', '58058', '9355'];

const MAX_PAGES          = 2;
const ITEMS_PER_PAGE     = 100;
const MIN_DISCOUNT_PCT   = 15;
const DELAY_BETWEEN_PAGES_MS = 500;

// ── מיפוי קטגוריות eBay → SallySale slugs ──────────────────

/**
 * ממיר שם קטגוריה של eBay לslug של SallySale.
 * @param {string} categoryName — שם הקטגוריה מתגובת eBay
 * @returns {string} slug: 'fashion' | 'electronics' | 'home' | 'fashion'
 */
export function mapEbayCategory(categoryName) {
  if (!categoryName) return 'fashion';
  const name = categoryName.toLowerCase();

  if (name.includes('electronic') || name.includes('cell phone') || name.includes('computer') || name.includes('camera')) {
    return 'electronics';
  }
  if (name.includes('home') || name.includes('garden') || name.includes('furniture') || name.includes('kitchen')) {
    return 'home';
  }
  // ביגוד, נעליים, אביזרים — כולם fashion
  return 'fashion';
}

// ── חישוב הנחה ─────────────────────────────────────────────

/**
 * מחשב אחוז הנחה.
 * @param {number|null} currentPrice  — מחיר נוכחי
 * @param {number|null} originalPrice — מחיר מקורי
 * @returns {number|null} אחוז הנחה (0-100) או null אם נתונים חסרים
 */
export function calculateDiscount(currentPrice, originalPrice) {
  if (currentPrice == null || originalPrice == null) return null;
  if (originalPrice <= 0) return null;
  const pct = ((originalPrice - currentPrice) / originalPrice) * 100;
  return Math.round(pct * 100) / 100;
}

// ── בניית payload לSupabase ─────────────────────────────────

/**
 * בונה אובייקט דיל מתגובת eBay להכנסה לSupabase.
 * @param {object} item      — פריט בודד מתגובת eBay
 * @param {string} campaignId — EBAY_CAMPAIGN_ID לקישור EPN
 * @returns {object} אובייקט מוכן ל-INSERT
 */
export function buildEbayPayload(item, campaignId) {
  const title         = item.title?.[0] || '';
  const currentPrice  = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0');
  const currency      = item.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId'] || 'USD';
  const originalPrice = parseFloat(item.discountPriceInfo?.[0]?.originalRetailPrice?.[0]?.['__value__'] || '0') || null;
  const productUrl    = item.viewItemURL?.[0] || '';
  const imageUrl      = item.galleryURL?.[0]  || '';
  const categoryName  = item.primaryCategory?.[0]?.categoryName?.[0] || '';
  const condition     = item.condition?.[0]?.conditionDisplayName?.[0] || '';

  // קישור EPN — affiliate link של eBay Partner Network
  const affiliateUrl = campaignId
    ? `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${campaignId}&toolid=10001&type=2&ff3=4&pub=5575433651&mpre=${encodeURIComponent(productUrl)}`
    : productUrl;

  return {
    title_en:      title,
    title_he:      null,
    storeName_en:  'eBay',                        // תמיד eBay
    category_slug: mapEbayCategory(categoryName),
    price:         currentPrice,
    originalPrice: originalPrice,
    currency,
    productUrl,
    affiliateUrl,
    imageUrl,
    description_en: condition ? `Condition: ${condition}` : null,
    shippingCost:  null,
    country:       'US',
    inStock:       true,
    status:        'pending',                     // ממתין לאימות BOT-17/18/23
    source:        'ebay_epn',
    tags:          ['ebay', 'sale'],
    addedAt:       new Date().toISOString(),
  };
}

// ── בדיקת תקינות דיל ────────────────────────────────────────

/**
 * מחזיר true אם הדיל עומד בתנאי המינימום:
 * - יש מחיר מקורי
 * - ההנחה >= 15%
 * - המחיר הנוכחי חוקי
 * @param {object} item — פריט מתגובת eBay
 * @returns {boolean}
 */
export function isValidEbayDeal(item) {
  const currentPrice  = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.['__value__'] || '0');
  const originalPrice = parseFloat(item.discountPriceInfo?.[0]?.originalRetailPrice?.[0]?.['__value__'] || '0');

  if (!currentPrice || currentPrice <= 0)   return false;
  if (!originalPrice || originalPrice <= 0)  return false;

  const discount = calculateDiscount(currentPrice, originalPrice);
  if (discount === null)              return false;
  if (discount < MIN_DISCOUNT_PCT)    return false;

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
      finished_at:  new Date().toISOString(),
      status,
      deals_added:  stats.added,
      deals_updated: stats.updated,
      errors:       stats.errors,
    })
    .eq('id', logId);
}

// ── קריאה ל-eBay Finding API ────────────────────────────────

/**
 * שולח בקשה ל-eBay Finding API ומחזיר מערך פריטים.
 * @param {number} pageNumber — מספר העמוד (1-based)
 * @returns {object[]} מערך פריטים גולמיים
 */
async function fetchEbayPage(pageNumber) {
  const params = new URLSearchParams({
    'OPERATION-NAME':                'findItemsAdvanced',
    'SERVICE-VERSION':               '1.0.3',
    'SECURITY-APPNAME':              EBAY_APP_ID,
    'RESPONSE-DATA-FORMAT':          'JSON',
    'REST-PAYLOAD':                  '',
    'keywords':                      'sale clearance',
    'categoryId':                    CATEGORY_IDS.join(','),
    'itemFilter(0).name':            'ListingType',
    'itemFilter(0).value':           'FixedPrice',
    'itemFilter(1).name':            'SoldItemsOnly',
    'itemFilter(1).value':           'false',
    'itemFilter(2).name':            'MinPrice',
    'itemFilter(2).value':           '5',
    'itemFilter(3).name':            'MaxPrice',
    'itemFilter(3).value':           '500',
    'itemFilter(4).name':            'HideDuplicateItems',
    'itemFilter(4).value':           'true',
    'sortOrder':                     'BestMatch',
    'paginationInput.entriesPerPage': String(ITEMS_PER_PAGE),
    'paginationInput.pageNumber':    String(pageNumber),
    'outputSelector(0)':             'GalleryInfo',
    'outputSelector(1)':             'PictureURLSuperSize',
    'outputSelector(2)':             'ConditionHistogram',
  });

  const url = `${FINDING_API_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal:  AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`eBay API HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const searchResult = json?.findItemsAdvancedResponse?.[0]?.searchResult?.[0];

  if (!searchResult || searchResult['@count'] === '0') return [];

  return searchResult.item || [];
}

// ── שמירה ל-Supabase ────────────────────────────────────────

/**
 * שומר batch של דילים לSupabase עם upsert לפי productUrl.
 * @param {object[]} deals   — מערך אובייקטי דיל
 * @param {object}   logger  — logger instance
 * @returns {{ added: number, updated: number, errors: string[] }}
 */
async function saveDealsBatch(deals, logger) {
  let added   = 0;
  let updated = 0;
  const errors = [];

  for (const deal of deals) {
    try {
      // בדיקה אם הדיל כבר קיים לפי productUrl
      const { data: existing } = await supabase
        .from('deals')
        .select('id, price')
        .eq('productUrl', deal.productUrl)
        .maybeSingle();

      if (existing) {
        // עדכון מחיר אם השתנה
        if (existing.price !== deal.price) {
          const { error } = await supabase
            .from('deals')
            .update({ price: deal.price, affiliateUrl: deal.affiliateUrl })
            .eq('id', existing.id);
          if (error) throw new Error(error.message);
          updated++;
        }
      } else {
        // הכנסת דיל חדש
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
  logger.log('=== BOT-07 eBay EPN — מתחיל ===');

  if (!EBAY_APP_ID) {
    logger.err('EBAY_APP_ID חסר ב-.env — לא ניתן להמשיך');
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
    let totalFetched  = 0;
    let totalValid    = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      logger.log(`מביא עמוד ${page}/${MAX_PAGES} מeBay...`);

      let items;
      try {
        items = await fetchEbayPage(page);
      } catch (e) {
        logger.err(`שגיאה בעמוד ${page}: ${e.message}`);
        stats.errors.push(e.message);
        break;
      }

      logger.log(`עמוד ${page}: ${items.length} פריטים התקבלו`);
      totalFetched += items.length;

      // סינון לפי הנחה מינימלית
      const validItems = items.filter(isValidEbayDeal);
      logger.log(`עמוד ${page}: ${validItems.length} פריטים עם הנחה ≥${MIN_DISCOUNT_PCT}%`);
      totalValid += validItems.length;

      // המרה לפורמט SallySale
      const deals = validItems.map(item => buildEbayPayload(item, EBAY_CAMPAIGN_ID));

      // שמירה לDB
      const batchResult = await saveDealsBatch(deals, logger);
      stats.added   += batchResult.added;
      stats.updated += batchResult.updated;
      stats.errors.push(...batchResult.errors);

      logger.ok(`עמוד ${page}: +${batchResult.added} חדשים, ~${batchResult.updated} עודכנו`);

      // עצירה אם קיבלנו פחות מהמצופה (עמוד אחרון)
      if (items.length < ITEMS_PER_PAGE) break;

      if (page < MAX_PAGES) await sleep(DELAY_BETWEEN_PAGES_MS);
    }

    logger.ok(`סיכום: נסרקו ${totalFetched} פריטים, ${totalValid} תקינים`);
    logger.ok(`נוספו: ${stats.added} | עודכנו: ${stats.updated} | שגיאות: ${stats.errors.length}`);
    logger.ok(`=== BOT-07 סיים בהצלחה — ${logger.elapsed()} ===`);

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

// הרץ רק כשהקובץ הוא entry point (לא בייבוא מטסטים)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('bot07.mjs') || process.argv[1].endsWith('bot07')
);
if (isMain) main();
