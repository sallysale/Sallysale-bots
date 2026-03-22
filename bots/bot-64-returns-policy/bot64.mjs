// ════════════════════════════════════════════════════════════
// BOT-64 — Returns Policy
// תפקיד: מחלץ ומאחסן מדיניות החזרות מדילים/חנויות.
//         סורק תיאורי דילים, מזהה patterns של מדיניות החזרה,
//         מעדכן store_policies + deals.return_policy_days/return_badge.
//
// לוגיקה:
//   1. שולף חנויות ללא return_policy או עם בדיקה ישנה (>30 יום)
//   2. לכל חנות — מאסף תיאורי דילים וסורק אותם
//   3. מזהה patterns: '30-day return', 'free returns', 'no returns' וכו'
//   4. מסווג: excellent/good/basic/none/unknown
//   5. עושה upsert ל-store_policies
//   6. מעדכן deals: return_policy_days, return_badge
//
// תדירות: כל ראשון 05:00 UTC (Railway cron: 0 5 * * 0)
//
// Env vars:
//   SUPABASE_URL          — מ-Supabase
//   SUPABASE_SERVICE_KEY  — service role key
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID             = 'BOT-64';
const STALE_DAYS         = 30;
const MAX_STORES_PER_RUN = 200;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — export לבדיקות
// ════════════════════════════════════════════════════════════

/**
 * detectReturnPolicy — מזהה האם הטקסט מכיל אזכור מדיניות החזרה.
 * מחזיר true אם נמצאו patterns (כולל "no returns", "final sale").
 * @param {string} text
 * @returns {boolean}
 */
export function detectReturnPolicy(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  const patterns = [
    /\d+[-\s]?day[s]?\s+(free\s+)?return/i,
    /free\s+returns?/i,
    /no\s+returns?/i,
    /final\s+sale/i,
    /all\s+sales?\s+final/i,
    /exchange\s+only/i,
    /restocking\s+fee/i,
    /return\s+policy/i,
    /returns?\s+accepted/i,
    /returns?\s+not\s+accepted/i,
    /\d+\s+days?\s+(to\s+)?return/i,
  ];
  return patterns.some(p => p.test(lower));
}

/**
 * parseReturnDays — חולץ מספר ימי החזרה מטקסט.
 * '30-day return policy' → 30, '60 days to return' → 60, null אם לא נמצא
 * @param {string} text
 * @returns {number|null}
 */
export function parseReturnDays(text) {
  if (!text || typeof text !== 'string') return null;

  // Patterns: '30-day', '60 days return', '90 day return policy'
  const patterns = [
    /(\d+)[-\s]?day[s]?\s+(free\s+)?return/i,
    /(\d+)\s+days?\s+(to\s+)?return/i,
    /return[s]?\s+within\s+(\d+)\s+days?/i,
    /(\d+)\s+days?\s+return\s+policy/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const days = parseInt(match[1] || match[3], 10);
      if (!isNaN(days) && days > 0) return days;
    }
  }
  return null;
}

/**
 * classifyReturnPolicy — מסווג מדיניות לפי ימים ומאפיינים.
 * @param {{ days: number|null, free: boolean, type: string }} policy
 * @returns {'excellent'|'good'|'basic'|'none'|'unknown'}
 */
export function classifyReturnPolicy(policy) {
  if (!policy) return 'unknown';

  const { days, free, type } = policy;

  // No returns cases
  if (type === 'no_returns' || type === 'final_sale') return 'none';
  if (days === 0) return 'none';

  // No data at all
  if (days === null && !free && type === 'unknown') return 'unknown';

  // Classify by days
  if (days !== null) {
    if (days >= 60) return free !== false ? 'excellent' : 'good';
    if (days >= 30) return 'good';
    if (days > 0)   return 'basic';
    return 'none';
  }

  // Has free returns signal but no days
  if (free) return 'good';

  return 'unknown';
}

/**
 * formatReturnBadge — מחרוזת badge להצגה.
 * @param {'excellent'|'good'|'basic'|'none'|'unknown'} rating
 * @param {number|null} days
 * @returns {string}
 */
export function formatReturnBadge(rating, days = null) {
  switch (rating) {
    case 'excellent':
      return days ? `\u2705 ${days}-Day Returns` : '\u2705 Free Returns';
    case 'good':
      return days ? `\u26a0\ufe0f ${days}-Day Returns` : '\u26a0\ufe0f 30-Day Returns';
    case 'basic':
      return days ? `\u26a0\ufe0f ${days}-Day Returns` : '\u26a0\ufe0f Short Return Window';
    case 'none':
      return '\u274c No Returns';
    case 'unknown':
    default:
      return '\ud83d\udd04 Exchange Only';
  }
}

/**
 * buildReturnSummary — מחזיר { best, worst, average_days } ממערך policies.
 * @param {Array<{ days: number|null, rating: string }>} storeReturns
 * @returns {{ best: string, worst: string, average_days: number|null }}
 */
export function buildReturnSummary(storeReturns) {
  if (!storeReturns || storeReturns.length === 0) {
    return { best: 'unknown', worst: 'unknown', average_days: null };
  }

  const ratingOrder = ['excellent', 'good', 'basic', 'none', 'unknown'];
  const sortedRatings = storeReturns
    .map(p => p.rating || 'unknown')
    .sort((a, b) => ratingOrder.indexOf(a) - ratingOrder.indexOf(b));

  const best  = sortedRatings[0];
  const worst = sortedRatings[sortedRatings.length - 1];

  const daysArr = storeReturns
    .map(p => p.days)
    .filter(d => typeof d === 'number' && d > 0);

  const average_days = daysArr.length > 0
    ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length)
    : null;

  return { best, worst, average_days };
}

/**
 * isGoodReturnPolicy — האם מדיניות ההחזרה טובה?
 * @param {'excellent'|'good'|'basic'|'none'|'unknown'} rating
 * @returns {boolean}
 */
export function isGoodReturnPolicy(rating) {
  return rating === 'excellent' || rating === 'good';
}

// ════════════════════════════════════════════════════════════
// עזר — פרסור טקסט לאובייקט policy
// ════════════════════════════════════════════════════════════

/**
 * extractPolicyFromText — מחלץ אובייקט policy מלא מטקסט.
 * @param {string} text
 * @returns {{ days: number|null, free: boolean, type: string, has_restocking: boolean, policy_text: string }}
 */
export function extractPolicyFromText(text) {
  if (!text) return { days: null, free: false, type: 'unknown', has_restocking: false, policy_text: '' };

  const lower = text.toLowerCase();

  // Determine type
  let type = 'unknown';
  if (/no\s+returns?|all\s+sales?\s+final|final\s+sale|returns?\s+not\s+accepted/.test(lower)) {
    type = 'no_returns';
  } else if (/final\s+sale/.test(lower)) {
    type = 'final_sale';
  } else if (/exchange\s+only/.test(lower)) {
    type = 'exchange_only';
  } else if (detectReturnPolicy(text)) {
    type = 'standard';
  }

  const days            = parseReturnDays(text);
  const free            = /free\s+returns?|free\s+return\s+shipping/.test(lower);
  const has_restocking  = /restocking\s+fee/.test(lower);

  // Trim policy text to first matching sentence
  const sentences = text.split(/[.!?\n]/);
  const relevantSentence = sentences.find(s => detectReturnPolicy(s)) || '';
  const policy_text = relevantSentence.trim().substring(0, 500);

  return { days, free, type, has_restocking, policy_text };
}

// ════════════════════════════════════════════════════════════
// bots_log
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
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchStoresNeedingCheck() {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - STALE_DAYS);

  const { data, error } = await supabase
    .from('stores')
    .select('id, name')
    .limit(MAX_STORES_PER_RUN);

  if (error) throw new Error(`fetchStores: ${error.message}`);

  // Filter: those not in store_policies or last_checked > 30 days
  const { data: policies } = await supabase
    .from('store_policies')
    .select('store_id, last_checked_at');

  const policyMap = {};
  for (const p of (policies || [])) {
    policyMap[p.store_id] = p.last_checked_at;
  }

  return (data || []).filter(store => {
    const checked = policyMap[store.id];
    if (!checked) return true;
    return new Date(checked) < staleDate;
  });
}

async function fetchDealDescriptionsForStore(storeId) {
  const { data, error } = await supabase
    .from('deals')
    .select('id, description, title')
    .eq('store_id', storeId)
    .eq('status', 'active')
    .not('description', 'is', null)
    .limit(50);

  if (error) return [];
  return data || [];
}

async function upsertStorePolicy(storeId, policyObj) {
  const { error } = await supabase
    .from('store_policies')
    .upsert({
      store_id:       storeId,
      return_days:    policyObj.days,
      return_type:    policyObj.type,
      return_free:    policyObj.free,
      has_restocking: policyObj.has_restocking,
      policy_text:    policyObj.policy_text,
      policy_rating:  policyObj.rating,
      last_checked_at: new Date().toISOString(),
    }, { onConflict: 'store_id' });

  if (error) throw new Error(`upsertStorePolicy: ${error.message}`);
}

async function updateDealsForStore(storeId, policyObj) {
  if (!policyObj.days && !policyObj.rating) return 0;

  const badge = formatReturnBadge(policyObj.rating, policyObj.days);

  const { data, error } = await supabase
    .from('deals')
    .update({
      return_policy_days: policyObj.days,
      return_badge:       badge,
    })
    .eq('store_id', storeId)
    .eq('status', 'active')
    .select('id');

  if (error) throw new Error(`updateDeals: ${error.message}`);
  return (data || []).length;
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`\ud83d\ude80 ${BOT_ID} — Returns Policy`);

  let logId;
  const stats = { updated: 0, stores: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    const stores = await fetchStoresNeedingCheck();
    log.log(`\ud83c\udfe6 ${stores.length} חנויות לבדיקה`);

    for (const store of stores) {
      try {
        const deals = await fetchDealDescriptionsForStore(store.id);
        if (deals.length === 0) {
          // Save unknown policy so we skip next time
          await upsertStorePolicy(store.id, {
            days: null, free: false, type: 'unknown',
            has_restocking: false, policy_text: '', rating: 'unknown',
          });
          stats.stores++;
          continue;
        }

        // Aggregate policy from all deal descriptions
        const allText = deals
          .map(d => `${d.title || ''} ${d.description || ''}`)
          .join(' ');

        const policyObj = extractPolicyFromText(allText);
        policyObj.rating = classifyReturnPolicy({
          days: policyObj.days,
          free: policyObj.free,
          type: policyObj.type,
        });

        await upsertStorePolicy(store.id, policyObj);
        const dealsUpdated = await updateDealsForStore(store.id, policyObj);
        stats.updated += dealsUpdated;
        stats.stores++;

        log.ok(`\u2705 ${store.name}: ${policyObj.rating} (${policyObj.days ?? '?'} days) — ${dealsUpdated} deals`);

      } catch (err) {
        log.warn(`\u26a0\ufe0f store ${store.name}: ${err.message}`);
        stats.errors.push(`store ${store.id}: ${err.message}`);
      }
    }

    log.log(`\u2705 סיום: ${stats.stores} חנויות, ${stats.updated} דילים עודכנו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot64.mjs');
if (isMain) {
  main().catch(err => { console.error('\u274c BOT-64 crashed:', err); process.exit(1); });
}
