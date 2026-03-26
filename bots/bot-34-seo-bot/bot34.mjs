// ════════════════════════════════════════════════════════════
// BOT-34 — SEO Bot
// תפקיד: מייצר meta title, meta description, og:title, og:image,
//         seo_slug לכל דיל פעיל. מייצר sitemap.xml ומעלה לSupabase Storage.
//
// לוגיקה:
//   1. שולף דילים פעילים ללא seo_title (או שעודכנו לאחרונה)
//   2. מחשב seo_title / seo_description / seo_slug / og_*
//   3. מעדכן את deals עם השדות החדשים
//   4. מייצר sitemap.xml וסווב ל-Supabase Storage bucket "public"
//
// תדירות: פעם ביום 02:00 UTC (Railway cron: 0 2 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID         = 'BOT-34';
const BATCH_SIZE     = 100;    // דילים לעיבוד בכל batch
const DELAY_MS       = 100;    // עיכוב בין batches (ms)
const SITE_URL       = process.env.SITE_URL || 'https://sallysale.com';
const SITEMAP_BUCKET = 'public';
const SITEMAP_PATH   = 'sitemap.xml';

const log = createLogger(BOT_ID);

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — SEO generation
// ════════════════════════════════════════════════════════════

/**
 * generateSlug — ממיר כותרת ל-URL slug.
 * "Sony WH-1000XM5 37% OFF — Amazon" → "sony-wh-1000xm5-37-off-amazon"
 *
 * @param {string} title
 * @param {string} id — deal UUID (suffix למניעת כפילויות)
 * @returns {string}
 */
export function generateSlug(title, id) {
  const base = String(title || 'deal')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // הסר תווים מיוחדים
    .replace(/\s+/g, '-')            // רווחים → מקף
    .replace(/-+/g, '-')             // מקפים כפולים → אחד
    .replace(/^-+|-+$/g, '')         // חתוך מקפים בקצוות
    .substring(0, 80);               // מקסימום 80 תווים

  // suffix קצר מה-UUID למניעת כפילויות
  const suffix = id ? id.replace(/-/g, '').substring(0, 6) : '';
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * generateSeoTitle — כותרת SEO (מקס 70 תווים).
 * פורמט: "[X% OFF] Title — Store"
 *
 * @param {object} deal
 * @returns {string}
 */
export function generateSeoTitle(deal) {
  const { title = '', discount, store_name = '', category = '' } = deal;

  let prefix = '';
  if (discount && discount >= 10) prefix = `${Math.round(discount)}% OFF `;

  // חתוך כותרת בהתאם למקום הנותר
  const suffix = store_name ? ` — ${store_name}` : '';
  const maxTitle = 70 - prefix.length - suffix.length;
  const shortTitle = title.substring(0, Math.max(20, maxTitle));

  return `${prefix}${shortTitle}${suffix}`.substring(0, 70);
}

/**
 * generateSeoDescription — תיאור SEO (מקס 160 תווים).
 * פורמט: "Buy [Title] at [Store] for [Price]. Was [Original]. Save [X]% today!"
 *
 * @param {object} deal
 * @returns {string}
 */
export function generateSeoDescription(deal) {
  const { title = '', price, original_price, currency = 'USD', store_name = '', discount } = deal;

  const symbols = { USD: '$', EUR: '€', GBP: '£', ILS: '₪' };
  const sym = symbols[currency] || currency + ' ';

  let desc = `Buy ${title.substring(0, 60)} at ${store_name || 'top stores'}`;

  if (price) {
    desc += ` for ${sym}${price}`;
    if (original_price && original_price > price) {
      desc += ` (was ${sym}${original_price})`;
    }
  }

  if (discount && discount >= 10) {
    desc += `. Save ${Math.round(discount)}% today!`;
  } else {
    desc += '. Limited time deal!';
  }

  return desc.substring(0, 160);
}

/**
 * generateOgTitle — og:title (יכול להיות קצת יותר מפתה מseo_title).
 * @param {object} deal
 * @returns {string}
 */
export function generateOgTitle(deal) {
  const { title = '', discount } = deal;
  const discLabel = discount && discount >= 10 ? `🔥 ${Math.round(discount)}% OFF — ` : '';
  return `${discLabel}${title}`.substring(0, 70);
}

/**
 * generateOgDescription — og:description (200 תווים, יותר שיווקי).
 * @param {object} deal
 * @returns {string}
 */
export function generateOgDescription(deal) {
  const { title = '', price, currency = 'USD', store_name = '', discount } = deal;
  const symbols = { USD: '$', EUR: '€', GBP: '£', ILS: '₪' };
  const sym = symbols[currency] || '$';

  let desc = title.substring(0, 80);
  if (price) desc += ` — Only ${sym}${price}`;
  if (discount && discount >= 10) desc += ` (${Math.round(discount)}% OFF)`;
  if (store_name) desc += ` at ${store_name}`;
  desc += '. SallySale — The Google of Sales.';

  return desc.substring(0, 200);
}

/**
 * buildDealSeoPayload — מחזיר אובייקט עם כל שדות SEO לדיל.
 * @param {object} deal
 * @returns {object}
 */
export function buildDealSeoPayload(deal) {
  if (!deal || !deal.id) return null;

  return {
    seo_title:       generateSeoTitle(deal),
    seo_description: generateSeoDescription(deal),
    seo_slug:        generateSlug(deal.title, deal.id),
    og_title:        generateOgTitle(deal),
    og_description:  generateOgDescription(deal),
    og_image:        deal.image_url || null,
    seo_updated_at:  new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════
// Sitemap generation
// ════════════════════════════════════════════════════════════

/**
 * generateSitemapXml — מייצר sitemap.xml מרשימת דילים.
 * @param {Array<{seo_slug: string, updated_at: string}>} deals
 * @param {string} siteUrl
 * @returns {string} XML string
 */
export function generateSitemapXml(deals, siteUrl = SITE_URL) {
  const urls = deals
    .filter(d => d.seo_slug)
    .map(d => {
      const lastmod = d.updated_at
        ? new Date(d.updated_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      return `  <url>
    <loc>${siteUrl}/deals/${d.seo_slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${siteUrl}/deals</loc>
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
  </url>
${urls}
</urlset>`;
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
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchDealsNeedingSeo(offset = 0) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, currency, discount, store_name, category, image_url, updated_at')
    .eq('status', 'active')
    .is('seo_title', null)
    .order('score', { ascending: false })
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) throw new Error(`fetchDeals: ${error.message}`);
  return data || [];
}

async function fetchAllSlugsForSitemap() {
  const { data, error } = await supabase
    .from('deals')
    .select('seo_slug, updated_at')
    .eq('status', 'active')
    .not('seo_slug', 'is', null)
    .order('score', { ascending: false })
    .limit(50000);

  if (error) { log.warn(`fetchAllSlugs: ${error.message}`); return []; }
  return data || [];
}

async function updateDealSeo(dealId, payload) {
  const { error } = await supabase
    .from('deals')
    .update(payload)
    .eq('id', dealId);
  if (error) throw new Error(`updateDealSeo ${dealId}: ${error.message}`);
}

async function uploadSitemap(xml) {
  const { error } = await supabase
    .storage
    .from(SITEMAP_BUCKET)
    .upload(SITEMAP_PATH, Buffer.from(xml, 'utf-8'), {
      contentType: 'application/xml',
      upsert: true,
    });

  if (error) {
    log.warn(`sitemap upload failed: ${error.message}`);
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — SEO Bot`);

  let logId;
  const stats = { updated: 0, errors: [] };

  try { logId = await logStart(); } catch (err) {
    log.warn(`bots_log: ${err.message}`);
  }

  // ── שלב 1: עדכון SEO לדילים חסרים ────────────────────────
  let offset = 0;
  while (true) {
    const batch = await fetchDealsNeedingSeo(offset).catch(err => {
      stats.errors.push(err.message);
      return [];
    });

    if (batch.length === 0) break;

    for (const deal of batch) {
      try {
        const payload = buildDealSeoPayload(deal);
        if (payload) {
          await updateDealSeo(deal.id, payload);
          stats.updated++;
        }
      } catch (err) {
        stats.errors.push(err.message);
        log.warn(`deal ${deal.id}: ${err.message}`);
      }
    }

    log.log(`📝 batch +${offset}: ${batch.length} עיבדנו`);
    offset += BATCH_SIZE;
    await sleep(DELAY_MS);

    if (batch.length < BATCH_SIZE) break;
  }

  // ── שלב 2: sitemap.xml ────────────────────────────────────
  try {
    const slugDeals = await fetchAllSlugsForSitemap();
    log.log(`🗺️  מייצר sitemap עם ${slugDeals.length} URLs`);
    const xml = generateSitemapXml(slugDeals);
    const ok  = await uploadSitemap(xml);
    if (ok) log.log('✅ sitemap.xml עלה ל-Supabase Storage');
  } catch (err) {
    log.warn(`sitemap: ${err.message}`);
    stats.errors.push(`sitemap: ${err.message}`);
  }

  log.log(`✅ סיום: ${stats.updated} דילים עודכנו`);
  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot34.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-34 crashed:', err); process.exit(1); });
}
