// ════════════════════════════════════════════════════════════
// BOT-24 — Auto Categorizer
// תפקיד: מוצא דילים ללא category_slug ומסווג אותם
//        לקטגוריה הנכונה בעזרת GPT-4o-mini.
//
// לוגיקה:
//   1. שולף עד 50 דילים עם category_slug = NULL/ריק
//   2. שולח כל אחד ל-GPT-4o-mini עם רשימת הקטגוריות
//   3. אם GPT מחזיר קטגוריה לא תקינה → keyword fallback
//   4. מעדכן deals.category_slug
//   5. כותב סיכום ל-bots_log
//
// קטגוריות תקינות:
//   fashion, electronics, home, beauty, sports,
//   kids, pets, food, books, other
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID       = 'BOT-24';
const BATCH_SIZE   = 50;
const DELAY_MS     = 500;   // השהייה בין קריאות OpenAI — מונע rate-limit

// ── קטגוריות תקינות ──────────────────────────────────────

export const VALID_CATEGORIES = [
  'fashion', 'electronics', 'home', 'beauty', 'sports',
  'kids', 'pets', 'food', 'books', 'other',
];

// ── isValidCategory ────────────────────────────────────────
// בודק אם הקטגוריה שייכת לרשימה התקינה

export function isValidCategory(slug) {
  if (!slug || typeof slug !== 'string') return false;
  return VALID_CATEGORIES.includes(slug.trim().toLowerCase());
}

// ── sanitizeGptResponse ────────────────────────────────────
// מנקה תשובת GPT: lowercase, trim, הסרת פיסוק מיותר

export function sanitizeGptResponse(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, ''); // רק אותיות — מסיר נקודות, רווחים וכדומה
}

// ── keywordFallback ────────────────────────────────────────
// כאשר GPT מחזיר תשובה לא חוקית — סיווג לפי מילות מפתח.
// מקבל title + storeName, מחזיר slug תקין.

export function keywordFallback(title = '', storeName = '') {
  const t = (title + ' ' + storeName).toLowerCase();

  // beauty קודם — למנוע match של "Boots" (רשת קוסמטיקה) כ-fashion
  if (/makeup|skincare|perfume|beauty|cosmetic|haircare|moisturizer|serum|foundation|lipstick|mascara|face cream|body cream|cream|lotion|sunscreen|shampoo|conditioner|body wash|toner|la roche|cerave|neutrogena|vichy|nourish|boots pharmacy|boots\.com/.test(t))
    return 'beauty';
  if (/shoe|sneaker|\bboot\b|boots\b|sandal|clothing|dress|shirt|pants|jacket|bag|fashion|apparel|zara|h&m|asos|nike|adidas/.test(t))
    return 'fashion';
  if (/phone|laptop|tablet|tv|television|computer|camera|electronics|samsung|apple|iphone|pixel|headphone|earphone/.test(t))
    return 'electronics';
  if (/furniture|sofa|lamp|ikea|kitchen|bedding|curtain|home|mattress|pillow|rug|decor/.test(t))
    return 'home';
  if (/sport|gym|fitness|yoga|running|bicycle|outdoor|trekking|hiking|swimming|tennis|football/.test(t))
    return 'sports';
  if (/toy|kids|children|baby|game|puzzle|lego|doll|stroller|diaper/.test(t))
    return 'kids';
  if (/pet|dog|cat|bird|fish|aquarium|kibble|leash|collar/.test(t))
    return 'pets';
  if (/food|snack|coffee|tea|supplement|vitamin|grocery|organic|protein/.test(t))
    return 'food';
  if (/book|novel|magazine|textbook|ebook|kindle|audiobook/.test(t))
    return 'books';

  return 'other';
}

// ── callGpt ───────────────────────────────────────────────
// שולח בקשה ל-OpenAI GPT-4o-mini ומחזיר slug מנוקה.
// מחזיר null אם אין OPENAI_API_KEY או אם הקריאה נכשלה.

async function callGpt(title, storeName, logger) {
  if (!process.env.OPENAI_API_KEY) {
    logger.log('אין OPENAI_API_KEY — עובר ל-keywordFallback');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        max_tokens:  20,
        temperature: 0,
        messages: [
          {
            role:    'system',
            content: 'You are a product categorization assistant. Reply with exactly one category slug from the list, nothing else.',
          },
          {
            role:    'user',
            content: `Categorize this product: "${title}"\nStore: ${storeName}\nCategories: fashion, electronics, home, beauty, sports, kids, pets, food, books, other`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.err(`OpenAI שגיאת HTTP ${response.status}: ${errText.slice(0, 120)}`);
      return null;
    }

    const data    = await response.json();
    const rawSlug = data?.choices?.[0]?.message?.content ?? '';
    return sanitizeGptResponse(rawSlug);

  } catch (err) {
    logger.err(`callGpt חריגה: ${err.message}`);
    return null;
  }
}

// ── categorize ────────────────────────────────────────────
// לוגיקה מרכזית לדיל אחד:
//   1. נסה GPT
//   2. אם תוצאה לא תקינה → keywordFallback
// מחזיר slug תקין תמיד

async function categorize(title, storeName, logger) {
  const gptSlug = await callGpt(title, storeName, logger);

  if (gptSlug && isValidCategory(gptSlug)) {
    return { slug: gptSlug, method: 'gpt' };
  }

  // GPT נכשל / החזיר קטגוריה לא חוקית → fallback
  if (gptSlug) {
    logger.log(`GPT החזיר קטגוריה לא תקינה: "${gptSlug}" — עובר ל-keyword fallback`);
  }
  const fbSlug = keywordFallback(title, storeName);
  return { slug: fbSlug, method: 'keyword' };
}

// ── bots_log ───────────────────────────────────────────────

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
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── fetchUncategorized ─────────────────────────────────────
// מחזיר batch של דילים ללא קטגוריה

async function fetchUncategorized(logger) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, title_en, storeName_en')
    .or('category_slug.is.null,category_slug.eq.')
    .eq('status', 'published')
    .limit(BATCH_SIZE);

  if (error) {
    logger.err(`fetchUncategorized נכשל: ${error.message}`);
    return [];
  }

  logger.log(`נמצאו ${data.length} דילים ללא קטגוריה`);
  return data;
}

// ── processBatch ──────────────────────────────────────────
// מעבד רשימת דילים: מסווג ומעדכן DB

async function processBatch(deals, stats, logger) {
  for (const deal of deals) {
    const title     = deal.title_en     || '';
    const storeName = deal.storeName_en || '';

    if (!title.trim()) {
      logger.log(`דיל ${deal.id} ללא כותרת — דולג`);
      continue;
    }

    try {
      const { slug, method } = await categorize(title, storeName, logger);

      const { error: updateErr } = await supabase
        .from('deals')
        .update({ category_slug: slug })
        .eq('id', deal.id);

      if (updateErr) {
        const msg = `עדכון נכשל לדיל ${deal.id}: ${updateErr.message}`;
        logger.err(msg);
        stats.errors.push(msg);
      } else {
        stats.updated++;
        logger.ok(`[${method}] ${deal.id} → ${slug} | "${title.slice(0, 60)}"`);
      }

    } catch (err) {
      const msg = `שגיאה לדיל ${deal.id}: ${err.message}`;
      logger.err(msg);
      stats.errors.push(msg);
    }

    // השהייה בין קריאות OpenAI — כיבוד rate-limit
    await sleep(DELAY_MS);
  }
}

// ── printStats ─────────────────────────────────────────────
// הדפסת סיכום קטגוריות לאחר הרצה

async function printStats(logger) {
  const { data, error } = await supabase
    .from('deals')
    .select('category_slug')
    .not('category_slug', 'is', null)
    .neq('category_slug', '');

  if (error || !data) return;

  // ספירה לפי קטגוריה
  const counts = {};
  for (const row of data) {
    const slug = row.category_slug || 'other';
    counts[slug] = (counts[slug] || 0) + 1;
  }

  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => `${slug}:${count}`)
    .join(' | ');

  logger.ok(`📊 קטגוריות: ${summary}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-24 Auto Categorizer — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { updated: 0, errors: [] };

  try {
    // לולאה: ממשיך לעבד batches עד שאין יותר דילים ללא קטגוריה
    let totalFetched = 0;
    while (true) {
      const deals = await fetchUncategorized(logger);
      if (deals.length === 0) break;

      totalFetched += deals.length;
      await processBatch(deals, stats, logger);

      // אם חזרו פחות מ-BATCH_SIZE — סיימנו
      if (deals.length < BATCH_SIZE) break;

      logger.log(`המשך ל-batch הבא... (סה"כ עד כה: ${totalFetched})`);
    }

    await printStats(logger);
    logger.ok(`=== BOT-24 סיים — עודכנו ${stats.updated} דילים | ${logger.elapsed()} ===`);

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
