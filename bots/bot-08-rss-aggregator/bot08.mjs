// ════════════════════════════════════════════════════════════
// BOT-08 — RSS Aggregator
// תפקיד: סורק RSS feeds של Amazon Deals ו-BestBuy Deals,
//         מחלץ דילים ומעלה ל-Supabase.
//
// מקורות:
//   Amazon — Deals of the Day RSS (public)
//   BestBuy — Deals RSS (public)
//   SlickDeals — Popular Deals RSS (public, גיבוי)
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID        = 'BOT-08';
const DELAY_MS      = 1500;   // עיכוב בין בקשות RSS
const MIN_DISCOUNT  = 10;     // הנחה מינימלית %

const log = createLogger(BOT_ID);

// ── RSS Feed URLs ────────────────────────────────────────────

export const RSS_FEEDS = [
  {
    id:       'amazon_deals',
    name:     'Amazon Deals of the Day',
    url:      'https://www.amazon.com/rss/deals?pf_rd_r=deals&pf_rd_p=deals&ie=UTF8',
    store:    'Amazon',
    currency: 'USD',
    source:   'rss_amazon',
  },
  {
    id:       'amazon_lightning',
    name:     'Amazon Lightning Deals',
    url:      'https://www.amazon.com/gp/rss/bestsellers/sports',
    store:    'Amazon',
    currency: 'USD',
    source:   'rss_amazon',
  },
  {
    id:       'bestbuy_deals',
    name:     'BestBuy Deals',
    url:      'https://www.bestbuy.com/site/misc/rss-feeds/pcmcat748301881271.c?id=pcmcat748301881271',
    store:    'BestBuy',
    currency: 'USD',
    source:   'rss_bestbuy',
  },
  {
    id:       'slickdeals_front',
    name:     'SlickDeals Frontpage',
    url:      'https://slickdeals.net/slickdeals.rss?src=fp',
    store:    'Various',
    currency: 'USD',
    source:   'rss_slickdeals',
  },
];

// ── sleep ────────────────────────────────────────────────────

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — ניתן לבדיקה ללא HTTP/DB
// ════════════════════════════════════════════════════════════

/**
 * parsePrice — מחלץ מחיר מחרוזת טקסט.
 * תומך ב: "$49.99", "49.99", "$49", "USD 49.99", "49,99"
 * @param {string} str
 * @returns {number|null}
 */
export function parsePrice(str) {
  if (!str) return null;
  let s = String(str)
    .replace(/USD\s*/i, '')
    .replace(/[£$€¥₩₪]/g, '')
    .trim();

  // 1,299.99 — פסיק = אלפים, נקודה = עשרוני (פורמט US)
  // 49,99    — פסיק = עשרוני (פורמט EU)
  let cleaned;
  if (s.includes(',') && s.includes('.')) {
    // שני סימנים — פסיק הוא אלפים
    cleaned = s.replace(/,/g, '').replace(/[^\d.]/g, '');
  } else if (s.includes(',') && !s.includes('.')) {
    // פסיק בלבד — נחליף לנקודה עשרונית
    cleaned = s.replace(',', '.').replace(/[^\d.]/g, '');
  } else {
    cleaned = s.replace(/[^\d.]/g, '');
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * extractPricesFromText — מחפש מחירים בתוך טקסט חופשי.
 * מחזיר { currentPrice, originalPrice } או null.
 *
 * דפוסים נתמכים:
 *   "$49.99 (was $99.99)"
 *   "Save $50 — Now $49.99"
 *   "$29.99, originally $59.99"
 *
 * @param {string} text
 * @returns {{ currentPrice: number, originalPrice: number }|null}
 */
export function extractPricesFromText(text) {
  if (!text) return null;

  // דפוס: מחיר נוכחי + was/originally/reg/regular
  const wasPattern = /\$?([\d,]+\.?\d*)\s*(?:\(was\s*\$?([\d,]+\.?\d*)\)|,?\s*(?:was|originally|reg\.?|regular)\s*\$?([\d,]+\.?\d*))/i;
  let m = text.match(wasPattern);
  if (m) {
    const current  = parsePrice(m[1]);
    const original = parsePrice(m[2] || m[3]);
    if (current && original && original > current) {
      return { currentPrice: current, originalPrice: original };
    }
  }

  // דפוס: "Save $X — Now $Y" (בסדר הפוך)
  const savePattern = /save\s+\$?([\d,]+\.?\d*).*?now\s+\$?([\d,]+\.?\d*)/i;
  m = text.match(savePattern);
  if (m) {
    const saved   = parsePrice(m[1]);
    const current = parsePrice(m[2]);
    if (saved && current) {
      return { currentPrice: current, originalPrice: current + saved };
    }
  }

  // מחיר יחיד — רק currentPrice
  const singlePrice = /\$?([\d]+\.[\d]{2})/;
  m = text.match(singlePrice);
  if (m) {
    const current = parsePrice(m[1]);
    if (current) return { currentPrice: current, originalPrice: null };
  }

  return null;
}

/**
 * calcDiscount — חישוב אחוז הנחה.
 * @param {number} current
 * @param {number} original
 * @returns {number|null}
 */
export function calcDiscount(current, original) {
  if (!current || !original || original <= 0 || current >= original) return null;
  return Math.round(((original - current) / original) * 100);
}

/**
 * mapRssCategory — מנחש קטגוריה מטיטל/תוכן.
 * @param {string} title
 * @param {string} [description]
 * @returns {string} SallySale category slug
 */
export function mapRssCategory(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();

  if (/laptop|computer|phone|tablet|tv|television|headphone|camera|gaming|console|speaker|earbud|monitor/.test(text))
    return 'electronics';
  if (/dress|shirt|jacket|jeans|shoes|sneaker|boots|clothing|fashion|apparel|wear/.test(text))
    return 'fashion';
  if (/sofa|furniture|kitchen|bed|bath|home\s*decor|lamp|vacuum|appliance/.test(text))
    return 'home';
  if (/toy|game|lego|puzzle|doll|action\s*figure|board\s*game/.test(text))
    return 'toys';
  if (/book|kindle|novel|textbook/.test(text))
    return 'books';
  if (/vitamin|supplement|skincare|makeup|beauty|perfume|cologne/.test(text))
    return 'beauty';
  if (/sport|fitness|gym|yoga|bike|outdoor|camping|hiking/.test(text))
    return 'sports';
  if (/baby|infant|toddler|diaper|stroller/.test(text))
    return 'baby';

  return 'general';
}

/**
 * extractAsin — מחלץ ASIN מ-URL של Amazon.
 * @param {string} url
 * @returns {string|null}
 */
export function extractAsin(url) {
  if (!url) return null;
  const m = url.match(/\/([A-Z0-9]{10})(?:\/|\?|$)/);
  return m ? m[1] : null;
}

/**
 * buildRssDealPayload — בונה payload לSupabase מפריט RSS.
 * @param {object} item        — פריט RSS מפורסר
 * @param {object} feedConfig  — קונפיג מ-RSS_FEEDS
 * @returns {object|null}
 */
export function buildRssDealPayload(item, feedConfig) {
  if (!item || !item.title) return null;

  const title = (item.title || '').trim();
  if (!title) return null;

  const description = item.description || item.summary || '';
  const url         = item.link || item.url || '';

  // מחלץ מחירים מהטיטל ומהתיאור
  const pricesFromTitle = extractPricesFromText(title);
  const pricesFromDesc  = extractPricesFromText(description);
  const prices = pricesFromTitle || pricesFromDesc;

  const currentPrice  = prices?.currentPrice  || null;
  const originalPrice = prices?.originalPrice || null;
  const discountPct   = calcDiscount(currentPrice, originalPrice);

  // סינון: אם אין מחיר, עדיין נכניס עם status=pending לאישור ידני
  // אם יש מחיר והנחה קטנה מסף — נדלג
  if (currentPrice && discountPct !== null && discountPct < MIN_DISCOUNT) {
    return null;
  }

  const category = mapRssCategory(title, description);
  const asin     = feedConfig.source.includes('amazon') ? extractAsin(url) : null;

  return {
    title:          title.substring(0, 500),
    description:    description.substring(0, 2000) || null,
    url:            url || null,
    product_url:    url || null,
    price:          currentPrice,
    original_price: originalPrice,
    currency:       feedConfig.currency,
    discount:       discountPct,
    category:       category,
    store_name:     feedConfig.store,
    source:         feedConfig.source,
    scrape_source:  feedConfig.id,
    status:         currentPrice ? 'active' : 'pending',
    asin:           asin,
    scraped_at:     new Date().toISOString(),
    created_at:     item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════
// XML Parser — פשוט ללא תלות חיצונית
// ════════════════════════════════════════════════════════════

/**
 * parseRssXml — ממיר XML גולמי למערך של items.
 * @param {string} xml
 * @returns {Array<{title,link,description,pubDate}>}
 */
export function parseRssXml(xml) {
  if (!xml || typeof xml !== 'string') return [];

  const items = [];
  // חילוץ כל ה-<item> tags
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const extract = (tag) => {
      // תמיכה ב-CDATA
      const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const plainRe  = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const cm = block.match(cdataRe);
      if (cm) return cm[1].trim();
      const pm = block.match(plainRe);
      return pm ? pm[1].replace(/<[^>]+>/g, '').trim() : null;
    };

    items.push({
      title:       extract('title'),
      link:        extract('link') || extract('guid'),
      description: extract('description') || extract('summary'),
      pubDate:     extract('pubDate') || extract('dc:date'),
    });
  }

  return items;
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
      finished_at:  new Date().toISOString(),
      status,
      deals_added:  stats.added,
      deals_updated: stats.updated,
      errors:       stats.errors,
    })
    .eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// HTTP fetch — טעינת RSS
// ════════════════════════════════════════════════════════════

async function fetchRssFeed(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SallySale/1.0 (deals aggregator; contact hello@sallysale.com)',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(15000), // 15 שניות timeout
    });

    if (!res.ok) {
      log.warn(`HTTP ${res.status} from ${url}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    log.warn(`fetchRssFeed error: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// upsert דילים ל-Supabase
// ════════════════════════════════════════════════════════════

async function upsertDeals(payloads) {
  if (payloads.length === 0) return { added: 0, updated: 0 };

  const { data, error } = await supabase
    .from('deals')
    .upsert(payloads, {
      onConflict:         'product_url',
      ignoreDuplicates:   false,
    })
    .select('id');

  if (error) {
    log.error(`upsertDeals error: ${error.message}`);
    return { added: 0, updated: 0 };
  }

  return { added: data?.length || 0, updated: 0 };
}

// ════════════════════════════════════════════════════════════
// processFeed — מעבד feed אחד
// ════════════════════════════════════════════════════════════

async function processFeed(feedConfig) {
  log.info(`📡 מוריד: ${feedConfig.name}`);

  const xml = await fetchRssFeed(feedConfig.url);
  if (!xml) {
    log.warn(`⚠️  לא הצלחנו לקרוא: ${feedConfig.id}`);
    return { added: 0, updated: 0, errors: [`fetch failed: ${feedConfig.id}`] };
  }

  const items = parseRssXml(xml);
  log.info(`   נמצאו ${items.length} פריטים ב-${feedConfig.id}`);

  const payloads = [];
  for (const item of items) {
    const payload = buildRssDealPayload(item, feedConfig);
    if (payload && payload.url) {
      payloads.push(payload);
    }
  }

  log.info(`   ${payloads.length} דילים עברו סינון`);

  const result = await upsertDeals(payloads);
  return { ...result, errors: [] };
}

// ════════════════════════════════════════════════════════════
// main — נקודת כניסה ראשית
// ════════════════════════════════════════════════════════════

export async function main() {
  log.info(`🚀 ${BOT_ID} — מתחיל סריקת RSS`);

  let logId;
  const totalStats = { added: 0, updated: 0, errors: [] };

  try {
    logId = await logStart();
  } catch (err) {
    log.error(`לא הצלחנו לפתוח bots_log: ${err.message}`);
  }

  for (const feed of RSS_FEEDS) {
    try {
      const result = await processFeed(feed);
      totalStats.added   += result.added;
      totalStats.updated += result.updated;
      totalStats.errors.push(...result.errors);
    } catch (err) {
      log.error(`שגיאה ב-${feed.id}: ${err.message}`);
      totalStats.errors.push(`${feed.id}: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  log.info(`✅ סיום: +${totalStats.added} נוספו, ${totalStats.updated} עודכנו`);

  if (logId) {
    await logFinish(logId, totalStats);
  }

  return totalStats;
}

// ── הרצה ישירה ──────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('bot08.mjs');
if (isMain) {
  main().catch(err => {
    console.error('❌ BOT-08 crashed:', err);
    process.exit(1);
  });
}
