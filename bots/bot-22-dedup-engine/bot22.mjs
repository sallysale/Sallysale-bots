// ════════════════════════════════════════════════════════════
// BOT-22 — Dedup Engine
// תפקיד: מזהה כפילויות בין דילים ומאחד אותם לקבוצת מוצר אחת.
//
// שלבי זיהוי (לפי עוצמה):
//   A. ASIN — זיהוי Amazon ASIN מה-URL → match מוחלט
//   B. SKU/EAN — שדה ישיר בדיל → match מוחלט
//   C. Title similarity — Jaccard על word-tokens בתוך אותה brand+category
//      ≥ 85% → auto_merge | 60-84% → AI review | < 60% → unique
//   D. AI review (GPT-4o-mini) — זוגות שנשלחו מ-C → confirm/reject
//
// תדירות: כל 12 שעות (Railway cron: 0 */12 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID    = 'BOT-22';
const BATCH_SIZE = 50;
const DELAY_MS   = 200;

// סף דמיון title לפני auto-merge ואיפה לשלוח ל-AI
const SIMILARITY_AUTO_MERGE = 85;   // ≥ זה → auto_merge מיד
const SIMILARITY_AI_REVIEW  = 60;   // ≥ זה (וגם < auto_merge) → AI review

// מקסימום קריאות OpenAI per run (כדי לשלוט בעלות)
const AI_MAX_PER_RUN = 50;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ══════════════════════════════════════════════════════════════
// ── כלי עזר: ASIN extraction ──────────────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * מחלץ Amazon ASIN (10 תווים) מ-URL.
 * דוגמה: https://www.amazon.com/dp/B09G9FPHY6?ref=...  → "B09G9FPHY6"
 */
export function extractAsin(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

// ══════════════════════════════════════════════════════════════
// ── כלי עזר: Title similarity (Jaccard on word tokens) ────────
// ══════════════════════════════════════════════════════════════

// מילות עצירה — לא משמעותיות להשוואה
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'in', 'on', 'at', 'to',
  'of', 'by', 'from', 'new', 'sale', 'deal', 'off', 'free', 'buy', 'get',
  '-', '|', '/', '&', '%',
]);

/**
 * ממיר title לסט tokens מנורמלים (lowercase, ללא סימנים, ללא stop words).
 */
export function tokenize(title) {
  if (!title || typeof title !== 'string') return new Set();
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff\s]/g, ' ')   // שמור אותיות, ספרות, עברית
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/**
 * Jaccard similarity בין שני סטים — מחזיר 0-100.
 */
export function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 100;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const t of setA) {
    if (setB.has(t)) intersectionSize++;
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return Math.round((intersectionSize / unionSize) * 100);
}

/**
 * מחשב דמיון כולל בין שני דילים: title + brand bonus.
 */
export function dealSimilarity(dealA, dealB) {
  const tokensA = tokenize(dealA.title_en);
  const tokensB = tokenize(dealB.title_en);
  let score = jaccardSimilarity(tokensA, tokensB);

  // bonus: אותה brand → + 5
  if (
    dealA.brand && dealB.brand &&
    dealA.brand.toLowerCase() === dealB.brand.toLowerCase()
  ) {
    score = Math.min(100, score + 5);
  }

  return score;
}

// ══════════════════════════════════════════════════════════════
// ── bots_log ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

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
      deals_scanned: stats.scanned,
      deals_updated: stats.merged,
      deals_added:   stats.queued,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ══════════════════════════════════════════════════════════════
// ── שלב A+B: עיבוד ASIN / SKU / EAN (exact matches) ──────────
// ══════════════════════════════════════════════════════════════

/**
 * שולף את כל הדילים הפעילים ועדכן את שדה asin מה-URL.
 * לאחר מכן מאחד כל קבוצת ASIN זהה.
 */
async function processExactMatches(logger, stats) {
  logger.log('שלב A: מחפש exact matches (ASIN / SKU / EAN)...');

  let from = 0;
  const asinMap = new Map(); // asin → [dealId, ...]
  const skuMap  = new Map(); // `store:sku` → [dealId, ...]
  const eanMap  = new Map(); // ean → [dealId, ...]

  // ── שלב 1: אסוף את כל הדילים ──
  while (true) {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('id, title_en, affiliate_url, product_url, store, brand, category, price, clicks, asin, sku, ean, dedup_status')
      .in('status', ['published', 'validated'])
      .range(from, from + BATCH_SIZE - 1)
      .order('id');

    if (error) {
      logger.err(`שגיאה בשליפת דילים (from=${from}): ${error.message}`);
      stats.errors.push(error.message);
      break;
    }
    if (!deals || deals.length === 0) break;

    stats.scanned += deals.length;

    for (const deal of deals) {
      // חלץ ASIN מ-URL אם לא קיים
      let asin = deal.asin;
      if (!asin) {
        asin = extractAsin(deal.affiliate_url) || extractAsin(deal.product_url);
        if (asin) {
          // שמור ASIN ב-DB
          await supabase.from('deals').update({ asin }).eq('id', deal.id);
        }
      }

      if (asin) {
        if (!asinMap.has(asin)) asinMap.set(asin, []);
        asinMap.get(asin).push(deal);
      } else if (deal.sku && deal.store) {
        const key = `${deal.store}:${deal.sku}`;
        if (!skuMap.has(key)) skuMap.set(key, []);
        skuMap.get(key).push(deal);
      } else if (deal.ean) {
        if (!eanMap.has(deal.ean)) eanMap.set(deal.ean, []);
        eanMap.get(deal.ean).push(deal);
      }
    }

    if (deals.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
    await sleep(DELAY_MS);
  }

  // ── שלב 2: merge קבוצות ──
  let exactMerged = 0;
  for (const [key, deals] of [...asinMap, ...skuMap, ...eanMap]) {
    if (deals.length < 2) continue;
    const reason = asinMap.has(key) ? 'asin_match' : skuMap.has ? 'sku_match' : 'ean_match';
    await mergeGroup(deals, reason, 100, logger);
    exactMerged += deals.length;
  }

  stats.merged += exactMerged;
  logger.ok(`שלב A סיים — ${exactMerged} דילים אוחדו (exact matches)`);
}

// ══════════════════════════════════════════════════════════════
// ── שלב C: Title similarity ────────────────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * מאחד דילים לפי דמיון title בתוך אותה brand+category.
 * זוגות בינוניים → נשלחים ל-dedup_queue לבדיקת AI.
 */
async function processTitleSimilarity(logger, stats) {
  logger.log('שלב C: title similarity בתוך brand+category...');

  // שלוף קבוצות brand+category עם ≥ 2 דילים
  const { data: groups, error: ge } = await supabase
    .from('deals')
    .select('brand, category')
    .in('status', ['published', 'validated'])
    .not('brand', 'is', null)
    .not('category', 'is', null);

  if (ge) {
    logger.err(`שגיאה בשליפת קבוצות: ${ge.message}`);
    stats.errors.push(ge.message);
    return;
  }

  // בנה סט קבוצות ייחודיות
  const uniqueGroups = new Map();
  for (const row of groups || []) {
    const key = `${row.brand?.toLowerCase()}|${row.category?.toLowerCase()}`;
    uniqueGroups.set(key, { brand: row.brand, category: row.category });
  }

  let pairsAutoMerged = 0;
  let pairsQueued = 0;

  for (const { brand, category } of uniqueGroups.values()) {
    const { data: deals, error: de } = await supabase
      .from('deals')
      .select('id, title_en, brand, category, price, clicks, dedup_status, dedup_group_id')
      .in('status', ['published', 'validated'])
      .eq('brand', brand)
      .eq('category', category)
      .in('dedup_status', ['unchecked', 'unique']);

    if (de || !deals || deals.length < 2) continue;

    // השוואת כל הזוגות בקבוצה (O(n²) — קבוצות קטנות בד"כ)
    const merged = new Set(); // deal ids שכבר אוחדו

    for (let i = 0; i < deals.length; i++) {
      for (let j = i + 1; j < deals.length; j++) {
        const a = deals[i];
        const b = deals[j];

        if (merged.has(a.id) || merged.has(b.id)) continue;

        const score = dealSimilarity(a, b);

        if (score >= SIMILARITY_AUTO_MERGE) {
          await mergeGroup([a, b], 'title_similar', score, logger);
          merged.add(a.id);
          merged.add(b.id);
          pairsAutoMerged++;
          stats.merged += 2;
        } else if (score >= SIMILARITY_AI_REVIEW) {
          await addToQueue(a.id, b.id, score, 'title_similar', null, logger);
          pairsQueued++;
          stats.queued++;
        } else {
          // סמן כ-unique (אם עדיין unchecked)
          await markUnique([a.id, b.id]);
        }
      }
    }
  }

  logger.ok(`שלב C סיים — auto_merged: ${pairsAutoMerged} זוגות, queued: ${pairsQueued}`);
}

// ══════════════════════════════════════════════════════════════
// ── שלב D: AI review (GPT-4o-mini) ────────────────────────────
// ══════════════════════════════════════════════════════════════

async function processAiReview(logger, stats) {
  if (!OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY לא מוגדר — מדלג על AI review');
    return;
  }

  logger.log(`שלב D: AI review (מקס ${AI_MAX_PER_RUN} זוגות)...`);

  // שלוף זוגות ממתינים
  const { data: queue, error } = await supabase
    .rpc('get_dedup_queue', { p_limit: AI_MAX_PER_RUN });

  if (error) {
    logger.err(`שגיאה בשליפת dedup_queue: ${error.message}`);
    stats.errors.push(error.message);
    return;
  }
  if (!queue || queue.length === 0) {
    logger.log('אין זוגות ממתינים ל-AI review');
    return;
  }

  logger.log(`שולח ${queue.length} זוגות ל-GPT-4o-mini...`);

  let aiMerged = 0;
  let aiRejected = 0;

  for (const item of queue) {
    try {
      const result = await askAiIsDuplicate(item);

      if (result.is_duplicate && result.confidence >= 80) {
        // אשר כפילות — שלוף deal ids מה-queue ואחד
        const { data: qRow } = await supabase
          .from('dedup_queue')
          .select('deal_id_a, deal_id_b')
          .eq('id', item.id)
          .single();

        if (qRow) {
          const { data: dealA } = await supabase.from('deals').select('id, title_en, price, clicks').eq('id', qRow.deal_id_a).single();
          const { data: dealB } = await supabase.from('deals').select('id, title_en, price, clicks').eq('id', qRow.deal_id_b).single();

          if (dealA && dealB) {
            await mergeGroup([dealA, dealB], 'ai_match', result.confidence, logger);
          }
        }

        await supabase
          .from('dedup_queue')
          .update({
            status:        'confirmed_duplicate',
            ai_reasoning:  result.reason,
            reviewed_at:   new Date().toISOString(),
          })
          .eq('id', item.id);

        aiMerged++;
        stats.merged += 2;
      } else {
        // AI: לא כפילות
        await supabase
          .from('dedup_queue')
          .update({
            status:        'confirmed_unique',
            ai_reasoning:  result.reason,
            reviewed_at:   new Date().toISOString(),
          })
          .eq('id', item.id);

        aiRejected++;
      }

      await sleep(300); // throttle — 3 req/sec max
    } catch (e) {
      logger.warn(`AI review נכשל לזוג ${item.id}: ${e.message}`);
      stats.errors.push(`ai:${item.id}: ${e.message}`);
    }
  }

  logger.ok(`שלב D סיים — AI אישר: ${aiMerged}, דחה: ${aiRejected}`);
}

/**
 * שולח זוג דילים ל-GPT-4o-mini ושואל אם הם אותו מוצר.
 * מחזיר { is_duplicate, confidence, reason }
 */
async function askAiIsDuplicate(queueItem) {
  const prompt = `You are a product deduplication assistant for SallySale, a deals aggregator.

Deal A:
  Title: "${queueItem.deal_a_title}"
  Store: "${queueItem.deal_a_store}"
  Price: ${queueItem.deal_a_price}

Deal B:
  Title: "${queueItem.deal_b_title}"
  Store: "${queueItem.deal_b_store}"
  Price: ${queueItem.deal_b_price}

Are these the SAME physical product being sold by different stores, or variants (same model)?
Answer ONLY with valid JSON: {"is_duplicate": true/false, "confidence": 0-100, "reason": "short explanation"}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

// ══════════════════════════════════════════════════════════════
// ── פעולות DB: merge / queue / unique ─────────────────────────
// ══════════════════════════════════════════════════════════════

/**
 * מאחד קבוצת דילים:
 * - יוצר dedup_group_id משותף (UUID של ה-canonical)
 * - הדיל עם ה-score הגבוה ביותר (discount * 0.6 + clicks * 0.4) → is_canonical=true
 * - שאר הדילים → is_canonical=false
 */
async function mergeGroup(deals, reason, score, logger) {
  if (!deals || deals.length < 2) return;

  // בחר canonical — הדיל עם הדיסקאונט הכי גדול (או הכי הרבה clicks)
  const canonical = deals.reduce((best, d) => {
    const scoreA = (d.clicks || 0);
    const scoreB = (best.clicks || 0);
    return scoreA > scoreB ? d : best;
  }, deals[0]);

  const groupId = canonical.id;

  for (const deal of deals) {
    const isCanon = deal.id === canonical.id;
    const { error } = await supabase
      .from('deals')
      .update({
        dedup_group_id:   groupId,
        dedup_status:     'auto_merged',
        dedup_score:      score,
        is_canonical:     isCanon,
        last_dedup_check: new Date().toISOString(),
      })
      .eq('id', deal.id);

    if (error) {
      logger.err(`merge נכשל לדיל ${deal.id}: ${error.message}`);
    } else {
      logger.ok(`🔗 deal ${deal.id} → group ${groupId} [${reason} ${score}%] canonical=${isCanon}`);
    }
  }
}

/**
 * מוסיף זוג ל-dedup_queue לאישור אדמין / AI.
 * משתמש ב-ON CONFLICT DO NOTHING למניעת כפילויות.
 */
async function addToQueue(dealIdA, dealIdB, confidence, reason, aiReasoning, logger) {
  const { error } = await supabase
    .from('dedup_queue')
    .upsert(
      {
        deal_id_a:   dealIdA,
        deal_id_b:   dealIdB,
        confidence,
        match_reason: reason,
        ai_reasoning: aiReasoning || null,
        status:      'pending',
      },
      { onConflict: 'deal_id_a,deal_id_b', ignoreDuplicates: true }
    );

  if (error) {
    logger.warn(`addToQueue נכשל (${dealIdA}, ${dealIdB}): ${error.message}`);
  }

  // סמן שניהם כ-admin_review
  await supabase
    .from('deals')
    .update({ dedup_status: 'admin_review', last_dedup_check: new Date().toISOString() })
    .in('id', [dealIdA, dealIdB]);
}

/**
 * סמן דילים כ-unique (אם עדיין unchecked).
 */
async function markUnique(dealIds) {
  await supabase
    .from('deals')
    .update({ dedup_status: 'unique', last_dedup_check: new Date().toISOString() })
    .in('id', dealIds)
    .eq('dedup_status', 'unchecked');
}

// ══════════════════════════════════════════════════════════════
// ── דוח סיום ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function printReport(logger) {
  const { data } = await supabase.rpc('get_dedup_summary');
  if (!data) return;

  logger.ok('📊 סיכום Dedup:');
  logger.ok(`  ⬜ unchecked:    ${data.unchecked}`);
  logger.ok(`  ✅ unique:       ${data.unique}`);
  logger.ok(`  🔗 auto_merged:  ${data.auto_merged}`);
  logger.ok(`  ⚠️  admin_review: ${data.admin_review}`);
  logger.ok(`  🗂  pending queue: ${data.pending_queue}`);
  logger.ok(`  👑 canonical deals: ${data.canonical_count}`);
}

// ══════════════════════════════════════════════════════════════
// ── utils ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ══════════════════════════════════════════════════════════════
// ── main ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-22 Dedup Engine — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { scanned: 0, merged: 0, queued: 0, errors: [] };

  try {
    // שלב A+B: exact matches (ASIN / SKU / EAN)
    await processExactMatches(logger, stats);

    // שלב C: title similarity
    await processTitleSimilarity(logger, stats);

    // שלב D: AI review לזוגות בתור
    await processAiReview(logger, stats);

    // דוח
    await printReport(logger);

    logger.ok(`=== BOT-22 סיים בהצלחה — ${logger.elapsed()} ===`);
    logger.ok(`סיכום: נסרקו ${stats.scanned}, אוחדו ${stats.merged}, תור ${stats.queued}`);

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
