// ════════════════════════════════════════════════════════════
// BOT-28 — Variant Matcher
// תפקיד: מקשר וריאנטים (צבע/מידה/נפח) לדיל אב.
//
// לוגיקה:
//   1. שולף דילים פעילים שטרם נותחו לוריאנטים
//   2. מנתח title + description לזיהוי וריאנטים
//   3. מקשר וריאנטים דומים לאותו product_id / deal group
//   4. מכניס ל-deal_variants table
//   5. כותב ל-bots_log
//
// תדירות: כל 12 שעות (Railway cron: 0 */12 * * *)
//
// Env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID             = 'BOT-28';
const MAX_DEALS_PER_RUN  = 500;
const log                = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/** רשימת צבעים נפוצים */
export const COLOR_KEYWORDS = [
  'black','white','red','blue','green','yellow','orange','purple','pink',
  'grey','gray','brown','beige','navy','teal','coral','gold','silver',
  'burgundy','olive','turquoise','maroon','ivory','cream','charcoal',
  'שחור','לבן','אדום','כחול','ירוק','צהוב','כתום','סגול','ורוד','אפור',
];

/** רשימת מידות נפוצות */
export const SIZE_KEYWORDS = [
  'xxs','xs','s','m','l','xl','xxl','xxxl','2xl','3xl',
  'xsmall','small','medium','large','xlarge',
  '32','34','36','38','40','42','44','46','48','50',
  'eu32','eu34','eu36','eu38','eu40','eu42',
  'us6','us8','us10','us12','us14',
  'uk6','uk8','uk10','uk12','uk14',
  'one size','onesize','free size',
];

/** ניחוש סוג וריאנט */
export function detectVariantType(value) {
  const v = value.toLowerCase().trim();
  if (COLOR_KEYWORDS.includes(v)) return 'color';
  if (SIZE_KEYWORDS.includes(v))  return 'size';
  // volume pattern: 100ml, 500g, 1L etc.
  if (/^\d+(\.\d+)?\s*(ml|l|cl|g|kg|oz|lb)$/i.test(v)) return 'volume';
  // numeric size
  if (/^\d{2}(\.\d)?$/.test(v)) return 'size';
  return 'other';
}

/**
 * extractVariants — מחלץ וריאנטים מטקסט.
 * @param {string} title
 * @param {string} [description]
 * @returns {Array<{type:string, value:string}>}
 */
export function extractVariants(title, description = '') {
  const text = `${title || ''} ${description || ''}`;
  const found = new Map(); // value.toLowerCase() → {type, value}

  // Color patterns: "in Black", "Black color", "- Black", "| Black"
  const colorPattern = new RegExp(
    `(?:in|color|colour|\\-|\\||:)?\\s*(${COLOR_KEYWORDS.join('|')})(?:\\s|,|\\.|$)`,
    'gi'
  );
  let m;
  while ((m = colorPattern.exec(text)) !== null) {
    const val = m[1].toLowerCase();
    if (!found.has(val)) found.set(val, { type: 'color', value: val });
  }

  // Size patterns: "Size M", "Size: XL", "(L)", "- XL -"
  const sizePattern = new RegExp(
    `(?:size[:\\s]?|\\(|\\-\\s*)(${SIZE_KEYWORDS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s|\\)|,|\\.|$)`,
    'gi'
  );
  while ((m = sizePattern.exec(text)) !== null) {
    const val = m[1].toLowerCase();
    if (!found.has(val)) found.set(val, { type: 'size', value: val });
  }

  // Volume pattern: 100ml, 500g, 1L etc.
  const volPattern = /\b(\d+(?:\.\d+)?\s*(?:ml|l|cl|g|kg|oz|lb))\b/gi;
  while ((m = volPattern.exec(text)) !== null) {
    const val = m[1].toLowerCase().replace(/\s+/g, '');
    if (!found.has(val)) found.set(val, { type: 'volume', value: val });
  }

  return Array.from(found.values());
}

/**
 * normalizeVariantValue — מנרמל ערך וריאנט.
 * @param {string} value
 * @param {string} type
 * @returns {string}
 */
export function normalizeVariantValue(value, type) {
  const v = value.toLowerCase().trim();
  if (type === 'size') {
    const sizeMap = {
      xsmall: 'XS', small: 'S', medium: 'M', large: 'L',
      xlarge: 'XL', 'free size': 'one size', onesize: 'one size',
    };
    return sizeMap[v] || v.toUpperCase();
  }
  if (type === 'color') {
    // Capitalize first letter
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
  return v;
}

/**
 * groupVariantsByBase — מקבץ וריאנטים לפי base title.
 * מסיר את ערך הוריאנט מהtitle כדי לקבל base.
 * @param {Array<{deal_id:string, title:string, variants:Array}>} items
 * @returns {Map<string, Array>} base → deals
 */
export function groupVariantsByBase(items) {
  const groups = new Map();

  for (const item of items) {
    // Remove variant values from title to get base
    let base = item.title || '';
    for (const v of (item.variants || [])) {
      const re = new RegExp(`\\b${v.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      base = base.replace(re, '').replace(/[\s\-|,]+$/, '').trim();
    }
    base = base.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!base) base = item.title?.toLowerCase().trim() || '';

    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(item);
  }
  return groups;
}

/**
 * scoreVariantSimilarity — ציון דמיון בין שני titles.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1
 */
export function scoreVariantSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersect = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersect++;
  }
  const union = wordsA.size + wordsB.size - intersect;
  return intersect / union; // Jaccard
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchUnanalyzedDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title, description, store_id, product_url')
    .eq('status', 'active')
    .is('variants_analyzed_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_DEALS_PER_RUN);

  if (error) throw new Error(`fetchUnanalyzedDeals: ${error.message}`);
  return data || [];
}

async function upsertVariants(dealId, variants) {
  if (variants.length === 0) return;
  const rows = variants.map(v => ({
    deal_id:    dealId,
    type:       v.type,
    value:      v.value,
    normalized: v.normalized,
  }));

  const { error } = await supabase
    .from('deal_variants')
    .upsert(rows, { onConflict: 'deal_id,type,value', ignoreDuplicates: true });

  if (error) log.warn(`upsertVariants(${dealId}): ${error.message}`);
}

async function markDealAnalyzed(dealId, variantCount) {
  const { error } = await supabase
    .from('deals')
    .update({
      variants_analyzed_at: new Date().toISOString(),
      variant_count: variantCount,
    })
    .eq('id', dealId);

  if (error) log.warn(`markDealAnalyzed(${dealId}): ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// bots_log helpers
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id').single();
  return data?.id;
}

async function logFinish(id, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    errors:        stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-28 — Variant Matcher starting`);

  let logId;
  const stats = { updated: 0, variants: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const deals = await fetchUnanalyzedDeals();
    log.log(`Fetched ${deals.length} unanalyzed deals`);

    for (const deal of deals) {
      try {
        const raw = extractVariants(deal.title, deal.description);
        const variants = raw.map(v => ({
          ...v,
          normalized: normalizeVariantValue(v.value, v.type),
        }));

        await upsertVariants(deal.id, variants);
        await markDealAnalyzed(deal.id, variants.length);

        stats.updated++;
        stats.variants += variants.length;

        if (variants.length > 0) {
          log.ok(`Deal ${deal.id}: found ${variants.length} variants [${variants.map(v => `${v.type}:${v.normalized}`).join(', ')}]`);
        }
      } catch (err) {
        log.warn(`Deal ${deal.id}: ${err.message}`);
        stats.errors.push(`${deal.id}: ${err.message}`);
      }
    }

    log.ok(`Done — analyzed ${stats.updated} deals, found ${stats.variants} total variants`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot28.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-28 crashed:', err); process.exit(1); });
}
