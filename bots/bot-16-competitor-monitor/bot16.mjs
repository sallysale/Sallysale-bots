// ════════════════════════════════════════════════════════════
// BOT-16 — Competitor Monitor
// תפקיד: סורק dealabs.com ו-Slickdeals.net דרך ScraperAPI,
//         מחלץ דילים חמים ומוסיף לSallySale.
//
// מקורות: dealabs.com + slickdeals.net
// שיטה: ScraperAPI HTML scraping + regex
// תדירות: כל 3 שעות (Railway cron: 0 */3 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-16';

// ── קונפיגורציה ────────────────────────────────────────────

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY || '';

const SCRAPERAPI_BASE = 'https://api.scraperapi.com';
const DELAY_MS        = 4000;   // ScraperAPI rate limit
const MIN_TEMP        = 50;     // טמפרטורת דיל מינימלית (Slickdeals/dealabs)

// דפי מקור לסריקה
export const COMPETITOR_TARGETS = [
  {
    id:     'dealabs_hot',
    url:    'https://www.dealabs.com/discussions/hot-deals',
    source: 'dealabs',
    label:  'Dealabs Hot Deals',
  },
  {
    id:     'slickdeals_front',
    url:    'https://slickdeals.net/deals/',
    source: 'slickdeals',
    label:  'Slickdeals Front Page',
  },
  {
    id:     'slickdeals_top',
    url:    'https://slickdeals.net/deals/?sortby=toprated&pageNum=1',
    source: 'slickdeals',
    label:  'Slickdeals Top Rated',
  },
  {
    id:     'dealabs_new',
    url:    'https://www.dealabs.com/discussions/nouveaux-bons-plans',
    source: 'dealabs',
    label:  'Dealabs New Deals',
  },
];

// ── מיפוי קטגוריות מתחרים → SallySale ────────────────────

/**
 * ממיר קטגוריה ממתחרה לslug של SallySale.
 * @param {string} category
 * @returns {string}
 */
export function mapCompetitorCategory(category) {
  if (!category) return 'fashion';
  const cat = category.toLowerCase();

  if (cat.includes('tech') || cat.includes('electronic') || cat.includes('computer') ||
      cat.includes('phone') || cat.includes('gaming') || cat.includes('software')) {
    return 'electronics';
  }
  if (cat.includes('home') || cat.includes('appliance') || cat.includes('kitchen') ||
      cat.includes('garden') || cat.includes('furniture')) {
    return 'home';
  }
  if (cat.includes('sport') || cat.includes('fitness') || cat.includes('outdoor')) {
    return 'sports';
  }
  if (cat.includes('beauty') || cat.includes('health') || cat.includes('personal care')) {
    return 'beauty';
  }
  if (cat.includes('food') || cat.includes('grocery') || cat.includes('restaurant')) {
    return 'food';
  }
  if (cat.includes('toy') || cat.includes('kids') || cat.includes('baby')) {
    return 'kids';
  }
  return 'fashion';
}

// ── פירוס מחיר ─────────────────────────────────────────────

/**
 * מוציא מחיר מטקסט: "Only $49.99!" → 49.99
 * @param {string} text
 * @returns {number|null}
 */
export function parseCompetitorPrice(text) {
  if (!text) return null;
  const match = String(text).match(/[\$€£¥₪]?\s*(\d{1,6}(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const val = parseFloat(match[1].replace(',', '.'));
  return isNaN(val) || val <= 0 ? null : val;
}

/**
 * מוציא אחוז הנחה מטקסט: "50% off" → 50
 * @param {string} text
 * @returns {number|null}
 */
export function parseDiscountPercent(text) {
  if (!text) return null;
  const match = String(text).match(/(\d{1,3})\s*%\s*off/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  return val > 0 && val <= 100 ? val : null;
}

// ── בניית payload ───────────────────────────────────────────

/**
 * בונה payload מדיל מתחרה.
 * @param {object} item   — דיל מ-competitor
 * @param {string} source — 'dealabs' | 'slickdeals'
 * @returns {object}
 */
export function buildCompetitorPayload(item, source) {
  const title      = item.title    || item.name    || '';
  const price      = item.price    || null;
  const origPrice  = item.origPrice || null;
  const discount   = item.discount || null;
  const productUrl = item.url      || item.link    || '';
  const imageUrl   = item.image    || item.thumbnail || '';
  const storeName  = item.store    || item.merchant || source;
  const category   = item.category || '';
  const temp       = item.temperature || item.votes || 0;

  return {
    title_en:       title,
    title_he:       null,
    storeName_en:   storeName,
    category_slug:  mapCompetitorCategory(category),
    price,
    originalPrice:  origPrice,
    currency:       item.currency || 'USD',
    discount,
    productUrl,
    affiliateUrl:   productUrl,
    imageUrl,
    description_en: item.description || `Hot deal from ${source} — ${temp}°`,
    shippingCost:   null,
    country:        source === 'dealabs' ? 'FR' : 'US',
    inStock:        true,
    status:         'pending',
    source,
    tags:           [source, 'hot_deal', 'competitor'],
    addedAt:        new Date().toISOString(),
  };
}

// ── בדיקת תקינות ────────────────────────────────────────────

/**
 * מחזיר true אם הדיל תקין.
 * @param {object} item
 * @returns {boolean}
 */
export function isValidCompetitorDeal(item) {
  const url   = item.url  || item.link  || '';
  const title = item.title || item.name || '';
  if (!url)   return false;
  if (!title) return false;
  // דיל חם רק אם עבר סף טמפרטורה
  const temp = item.temperature || item.votes || 0;
  if (temp < MIN_TEMP && item.temperature !== undefined) return false;
  return true;
}

// ── פירוס HTML ──────────────────────────────────────────────

/**
 * מחלץ דילים מ-HTML של Slickdeals.
 * @param {string} html
 * @returns {object[]}
 */
export function parseSlickdealsHtml(html) {
  if (!html) return [];
  const deals = [];

  // חיפוש deal cards — Slickdeals משתמש ב-data attributes
  const titleMatches = [...html.matchAll(/data-title="([^"]+)"/g)];
  const priceMatches = [...html.matchAll(/class="[^"]*price[^"]*"[^>]*>\s*\$?([\d.,]+)/gi)];
  const urlMatches   = [...html.matchAll(/href="(\/f\/\d+[^"]*?)"/g)];

  for (let i = 0; i < Math.min(titleMatches.length, 20); i++) {
    const title = titleMatches[i]?.[1] || '';
    const price = parseCompetitorPrice(priceMatches[i]?.[1] || '');
    const path  = urlMatches[i]?.[1] || '';
    const url   = path ? `https://slickdeals.net${path}` : '';

    if (title && url) {
      deals.push({ title, price, url, temperature: 100, source: 'slickdeals' });
    }
  }
  return deals;
}

/**
 * מחלץ דילים מ-HTML של Dealabs.
 * @param {string} html
 * @returns {object[]}
 */
export function parseDealabsHtml(html) {
  if (!html) return [];
  const deals = [];

  // Dealabs — class="thread-title"
  const titleMatches = [...html.matchAll(/class="[^"]*thread-title[^"]*"[^>]*>([^<]+)</g)];
  const priceMatches = [...html.matchAll(/class="[^"]*thread-price[^"]*"[^>]*>([€\d.,\s]+)</g)];
  const urlMatches   = [...html.matchAll(/href="(\/bons-plans\/[^"]+)"/g)];
  const tempMatches  = [...html.matchAll(/class="[^"]*temperature[^"]*"[^>]*>(\d+)/g)];

  for (let i = 0; i < Math.min(titleMatches.length, 20); i++) {
    const title = titleMatches[i]?.[1]?.trim() || '';
    const price = parseCompetitorPrice(priceMatches[i]?.[1] || '');
    const path  = urlMatches[i]?.[1] || '';
    const url   = path ? `https://www.dealabs.com${path}` : '';
    const temp  = parseInt(tempMatches[i]?.[1] || '0', 10);

    if (title && url) {
      deals.push({ title, price, url, temperature: temp, source: 'dealabs' });
    }
  }
  return deals;
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

// ── scraping ────────────────────────────────────────────────

export async function scrapeCompetitorPage(targetUrl) {
  const params = new URLSearchParams({
    api_key: SCRAPERAPI_KEY,
    url:     targetUrl,
    render:  'false',
  });
  const res = await fetch(`${SCRAPERAPI_BASE}?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ScraperAPI HTTP ${res.status}`);
  return res.text();
}

// ── שמירה ל-Supabase ────────────────────────────────────────

async function saveDealsBatch(deals, logger) {
  let added = 0, updated = 0;
  const errors = [];
  for (const deal of deals) {
    try {
      const { data: existing } = await supabase.from('deals')
        .select('id').eq('productUrl', deal.productUrl).maybeSingle();
      if (!existing) {
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
  logger.log('=== BOT-16 Competitor Monitor — מתחיל ===');

  if (!SCRAPERAPI_KEY) {
    logger.err('SCRAPERAPI_KEY חסר ב-.env — יציאה');
    process.exit(1);
  }

  let logId;
  try { logId = await logStart(); } catch (e) { logger.err(`bots_log: ${e.message}`); }
  const stats = { added: 0, updated: 0, errors: [] };

  try {
    for (const target of COMPETITOR_TARGETS) {
      logger.log(`סורק: ${target.label}`);
      let html;
      try {
        html = await scrapeCompetitorPage(target.url);
      } catch (e) {
        logger.err(`  שגיאה ב-${target.id}: ${e.message}`);
        stats.errors.push(e.message);
        await sleep(DELAY_MS);
        continue;
      }

      const rawDeals = target.source === 'dealabs'
        ? parseDealabsHtml(html)
        : parseSlickdealsHtml(html);

      const valid = rawDeals.filter(isValidCompetitorDeal);
      logger.log(`  ${rawDeals.length} דילים נמצאו, ${valid.length} תקינים`);

      const deals = valid.map(item => buildCompetitorPayload(item, target.source));
      const batch = await saveDealsBatch(deals, logger);
      stats.added   += batch.added;
      stats.updated += batch.updated;
      stats.errors.push(...batch.errors);
      logger.ok(`  +${batch.added} דילים חדשים`);
      await sleep(DELAY_MS);
    }

    logger.ok(`סיכום: +${stats.added} חדשים | ❌ ${stats.errors.length} שגיאות`);
    logger.ok(`=== BOT-16 סיים — ${logger.elapsed()} ===`);
  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, stats.errors.length > 0 ? 'error' : 'done');
  }
}

const isMain = process.argv[1]?.endsWith('bot16.mjs') || process.argv[1]?.endsWith('bot16');
if (isMain) main();
