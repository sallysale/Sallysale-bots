// ════════════════════════════════════════════════════════════
// BOT-33 — Instagram Bot
// תפקיד: מייצר טקסט פוסט לאינסטגרם עבור דילים עם ציון > 85,
//         שומר לטבלת instagram_queue עם status='pending'.
//
// ⚠️  לא מפרסם ישירות — Instagram API דורש אישור אפליקציה.
//     אדמין מאשר ומפרסם ידנית מהadmin panel.
//
// פורמט פוסט:
//   🔥 [X% OFF] — Title
//   💰 Only $X (was $Y)
//   🏪 Available at: Store
//   🌐 Find the deal at: [short URL]
//   .
//   [hashtags]
//
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID       = 'BOT-33';
const MIN_SCORE    = 85;     // ציון מינימלי לאינסטגרם
const MAX_PER_RUN  = 5;      // מקסימום לתור בהרצה אחת
const SITE_URL     = process.env.SITE_URL || 'https://sallysale.com';

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// Hashtag banks
// ════════════════════════════════════════════════════════════

export const HASHTAG_BANKS = {
  electronics: ['#TechDeals', '#Electronics', '#GadgetSale', '#TechSale', '#GadgetDeals', '#SmartHome'],
  fashion:     ['#FashionDeals', '#StyleSale', '#OOTD', '#FashionSale', '#ClothingDeals', '#ShopNow'],
  home:        ['#HomeDecor', '#HomeSale', '#InteriorDesign', '#FurnitureDeals', '#HomeDeals'],
  toys:        ['#ToyDeals', '#KidsDeals', '#ToysOnSale', '#GiftIdeas', '#FamilyDeals'],
  beauty:      ['#BeautyDeals', '#SkincareSale', '#MakeupDeals', '#BeautySale', '#GlowUp'],
  sports:      ['#FitnessDeals', '#SportsSale', '#ActiveWear', '#FitLife', '#GymDeals'],
  books:       ['#BookDeals', '#BookSale', '#Reading', '#BookLovers', '#KindleDeals'],
  general:     ['#Deals', '#Sale', '#Shopping', '#Savings', '#BestDeals'],
};

export const GLOBAL_HASHTAGS = [
  '#SallySale', '#DealAlert', '#Sale', '#Deals', '#ShopSmart', '#SaveMoney',
];

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * pickHashtags — בוחר hashtags לפי קטגוריה + global.
 * @param {string} category
 * @param {number} maxTotal — מקסימום hashtags (ברירת מחדל: 15)
 * @returns {string[]}
 */
export function pickHashtags(category = 'general', maxTotal = 15) {
  const cat = (category || 'general').toLowerCase().replace('-', '_');
  const categoryTags = HASHTAG_BANKS[cat] || HASHTAG_BANKS.general;

  // 6 global + עד 9 category-specific
  const combined = [
    ...GLOBAL_HASHTAGS,
    ...categoryTags.slice(0, maxTotal - GLOBAL_HASHTAGS.length),
  ];

  return combined.slice(0, maxTotal);
}

/**
 * formatPostText — מייצר גוף הפוסט (ללא hashtags).
 * @param {object} deal
 * @returns {string}
 */
export function formatPostText(deal) {
  const { title = '', price, original_price, currency = 'USD', discount, store_name = '', seo_slug } = deal;
  const symbols = { USD: '$', EUR: '€', GBP: '£', ILS: '₪' };
  const sym = symbols[currency] || '$';

  const discLabel = discount && discount >= 10 ? `🔥 ${Math.round(discount)}% OFF — ` : '🔥 Deal — ';
  const shortTitle = title.substring(0, 80);

  let text = `${discLabel}${shortTitle}\n`;

  if (price) {
    text += `💰 Only ${sym}${price}`;
    if (original_price && original_price > price) {
      text += ` (was ${sym}${original_price})`;
    }
    text += '\n';
  }

  if (store_name) text += `🏪 Available at: ${store_name}\n`;

  const dealUrl = seo_slug
    ? `${SITE_URL}/deals/${seo_slug}`
    : SITE_URL;
  text += `🌐 ${dealUrl}\n`;

  return text;
}

/**
 * buildCaption — גוף + hashtags.
 * @param {string} postText
 * @param {string[]} hashtags
 * @returns {string}
 */
export function buildCaption(postText, hashtags) {
  const hashtagStr = hashtags.join(' ');
  return `${postText}\n.\n${hashtagStr}`;
}

/**
 * buildInstagramQueueItem — בונה רשומה ל-instagram_queue.
 * @param {object} deal
 * @returns {object|null}
 */
export function buildInstagramQueueItem(deal) {
  if (!deal || !deal.id) return null;
  if (!deal.title) return null;

  const hashtags = pickHashtags(deal.category);
  const postText = formatPostText(deal);
  const caption  = buildCaption(postText, hashtags);

  return {
    deal_id:    deal.id,
    post_text:  postText,
    hashtags:   hashtags,
    image_url:  deal.image_url || null,
    caption:    caption,
    status:     'pending',
    score:      deal.score || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * isCaptionValid — בדיקות ולידציה בסיסיות על caption.
 * Instagram מגביל: 2200 תווים, מקסימום 30 hashtags.
 *
 * @param {string} caption
 * @returns {{ valid: boolean, reason?: string }}
 */
export function isCaptionValid(caption) {
  if (!caption) return { valid: false, reason: 'caption ריק' };
  if (caption.length > 2200) return { valid: false, reason: `caption ארוך מדי: ${caption.length}` };

  const hashtagCount = (caption.match(/#\w+/g) || []).length;
  if (hashtagCount > 30) return { valid: false, reason: `יותר מ-30 hashtags: ${hashtagCount}` };

  return { valid: true };
}

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

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
    finished_at:  new Date().toISOString(),
    status,
    deals_added:  stats.added,
    errors:       stats.errors,
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB
// ════════════════════════════════════════════════════════════

async function fetchDealsForInstagram() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, original_price, currency, discount, score, category, store_name, image_url, seo_slug, status')
    .eq('status', 'active')
    .gte('score', MIN_SCORE)
    .order('score', { ascending: false })
    .limit(50);

  if (error) throw new Error(`fetchDeals: ${error.message}`);
  return data || [];
}

async function fetchAlreadyQueued() {
  const { data, error } = await supabase
    .from('instagram_queue')
    .select('deal_id')
    .in('status', ['pending', 'approved', 'posted']);

  if (error) return new Set();
  return new Set((data || []).map(r => r.deal_id));
}

async function insertQueueItems(items) {
  if (items.length === 0) return 0;
  const { data, error } = await supabase
    .from('instagram_queue')
    .insert(items)
    .select('id');

  if (error) { log.warn(`insertQueue: ${error.message}`); return 0; }
  return data?.length || 0;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Instagram Queue Builder`);

  let logId;
  const stats = { added: 0, errors: [] };

  try { logId = await logStart(); } catch (err) { log.warn(`bots_log: ${err.message}`); }

  try {
    const deals    = await fetchDealsForInstagram();
    const queued   = await fetchAlreadyQueued();

    log.log(`📋 ${deals.length} candidates, ${queued.size} כבר בתור`);

    const items = [];
    for (const deal of deals) {
      if (queued.has(deal.id)) continue;
      const item = buildInstagramQueueItem(deal);
      if (!item) continue;

      const { valid, reason } = isCaptionValid(item.caption);
      if (!valid) { log.warn(`דיל ${deal.id}: ${reason}`); continue; }

      items.push(item);
      if (items.length >= MAX_PER_RUN) break;
    }

    stats.added = await insertQueueItems(items);
    log.log(`✅ ${stats.added} פוסטים נוספו לתור`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot33.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-33 crashed:', err); process.exit(1); });
}
