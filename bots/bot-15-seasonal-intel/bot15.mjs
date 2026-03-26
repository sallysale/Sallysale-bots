// ════════════════════════════════════════════════════════════
// BOT-15 — Seasonal Intel
// תפקיד: מזהה אירועי עונה קרובים (Black Friday, Valentine's,
//         Back to School וכו') ומעדכן דילים עם seasonal tags.
//
// מקור: לוח שנה פנימי — אין API חיצוני
// לוגיקה: אירוע ב-X ימים → boost score + seasonal tags
// תדירות: פעם ביום (Railway cron: 0 6 * * *)
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-15';

// ── לוח שנה עונתי ──────────────────────────────────────────

/**
 * אירועי שוק שנתיים עם הגדרות.
 * month: 1-12, day: 1-31, windowDays: כמה ימים לפני האירוע להתחיל boost
 */
export const SEASONAL_EVENTS = [
  // ינואר
  { id: 'new_year_sale',      month: 1,  day: 1,  windowDays: 7,  tags: ['new_year', 'sale'],        boost: 15, categories: [] },
  { id: 'winter_clearance',   month: 1,  day: 15, windowDays: 14, tags: ['winter_clearance'],        boost: 10, categories: ['fashion'] },
  // פברואר
  { id: 'valentines_day',     month: 2,  day: 14, windowDays: 14, tags: ['valentines', 'gift'],      boost: 20, categories: ['beauty', 'fashion', 'jewelry'] },
  // מרץ
  { id: 'spring_sale',        month: 3,  day: 20, windowDays: 10, tags: ['spring_sale'],             boost: 10, categories: ['fashion', 'home'] },
  // אפריל
  { id: 'easter_sale',        month: 4,  day: 1,  windowDays: 7,  tags: ['easter', 'sale'],          boost: 12, categories: ['fashion', 'kids', 'home'] },
  // מאי
  { id: 'mothers_day',        month: 5,  day: 12, windowDays: 14, tags: ['mothers_day', 'gift'],     boost: 20, categories: ['beauty', 'fashion', 'jewelry'] },
  { id: 'memorial_day_sale',  month: 5,  day: 27, windowDays: 7,  tags: ['memorial_day', 'sale'],   boost: 15, categories: [] },
  // יוני
  { id: 'fathers_day',        month: 6,  day: 16, windowDays: 14, tags: ['fathers_day', 'gift'],     boost: 18, categories: ['electronics', 'sports', 'fashion'] },
  { id: 'summer_sale',        month: 6,  day: 21, windowDays: 7,  tags: ['summer_sale'],             boost: 12, categories: ['fashion', 'sports', 'home'] },
  // יולי
  { id: 'prime_day',          month: 7,  day: 15, windowDays: 5,  tags: ['prime_day', 'amazon'],     boost: 25, categories: ['electronics', 'home', 'fashion'] },
  { id: 'fourth_of_july',     month: 7,  day: 4,  windowDays: 5,  tags: ['4th_of_july', 'sale'],     boost: 15, categories: [] },
  // אוגוסט
  { id: 'back_to_school',     month: 8,  day: 15, windowDays: 21, tags: ['back_to_school', 'sale'],  boost: 20, categories: ['electronics', 'fashion', 'kids'] },
  // ספטמבר
  { id: 'fall_sale',          month: 9,  day: 22, windowDays: 7,  tags: ['fall_sale'],               boost: 10, categories: ['fashion', 'home'] },
  // אוקטובר
  { id: 'halloween_sale',     month: 10, day: 31, windowDays: 14, tags: ['halloween', 'costume'],    boost: 18, categories: ['fashion', 'kids'] },
  // נובמבר
  { id: 'black_friday',       month: 11, day: 29, windowDays: 14, tags: ['black_friday', 'sale'],    boost: 35, categories: [] },
  { id: 'cyber_monday',       month: 12, day: 2,  windowDays: 3,  tags: ['cyber_monday', 'sale'],    boost: 30, categories: ['electronics'] },
  // דצמבר
  { id: 'christmas_sale',     month: 12, day: 25, windowDays: 21, tags: ['christmas', 'gift'],       boost: 28, categories: [] },
  { id: 'boxing_day',         month: 12, day: 26, windowDays: 3,  tags: ['boxing_day', 'sale'],      boost: 20, categories: [] },
  { id: 'new_year_eve',       month: 12, day: 31, windowDays: 7,  tags: ['new_year_eve', 'sale'],    boost: 15, categories: [] },
];

// ── לוגיקה של אירועים ──────────────────────────────────────

/**
 * מחזיר אירועים שקרובים תוך X ימים מהיום.
 * @param {number} daysAhead — כמה ימים קדימה להסתכל
 * @param {Date}   now        — תאריך נוכחי (injectable לטסטים)
 * @returns {object[]}
 */
export function getUpcomingEvents(daysAhead = 14, now = new Date()) {
  const upcoming = [];

  for (const event of SEASONAL_EVENTS) {
    // בדוק אירוע בשנה הנוכחית ובשנה הבאה
    for (const yearOffset of [0, 1]) {
      const eventDate = new Date(now.getFullYear() + yearOffset, event.month - 1, event.day);
      const diffMs    = eventDate - now;
      const diffDays  = diffMs / (1000 * 3600 * 24);

      if (diffDays >= 0 && diffDays <= event.windowDays) {
        upcoming.push({
          ...event,
          eventDate,
          daysUntil: Math.round(diffDays),
        });
        break;
      }
    }
  }

  return upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * בודק אם אירוע ספציפי קרוב.
 * @param {object} event      — אירוע מ-SEASONAL_EVENTS
 * @param {number} daysAhead
 * @param {Date}   now
 * @returns {boolean}
 */
export function isEventUpcoming(event, daysAhead = 14, now = new Date()) {
  const eventDate = new Date(now.getFullYear(), event.month - 1, event.day);
  if (eventDate < now) {
    // אולי בשנה הבאה
    eventDate.setFullYear(now.getFullYear() + 1);
  }
  const diffDays = (eventDate - now) / (1000 * 3600 * 24);
  return diffDays >= 0 && diffDays <= daysAhead;
}

/**
 * מחזיר tags עונתיים לאירוע (כולל urgency).
 * @param {object} event — אירוע עם daysUntil
 * @returns {string[]}
 */
export function getSeasonalTags(event) {
  const tags = [...event.tags];
  if (event.daysUntil <= 3)  tags.push('urgent', 'last_chance');
  else if (event.daysUntil <= 7)  tags.push('coming_soon');
  return tags;
}

/**
 * מחשב boost score לפי קרבה לאירוע.
 * ב-0-3 ימים: boost × 1.5, 4-7 ימים: boost × 1.2, 8+: boost × 1.0
 * @param {object} event
 * @returns {number}
 */
export function calcEventBoost(event) {
  const base = event.boost || 10;
  if (event.daysUntil <= 3)  return Math.round(base * 1.5);
  if (event.daysUntil <= 7)  return Math.round(base * 1.2);
  return base;
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

// ── עדכון דילים לפי אירוע ──────────────────────────────────

async function boostDealsForEvent(event, logger) {
  let updated = 0;

  // בנה query לפי קטגוריות האירוע (או כל הדילים)
  let query = supabase.from('deals').select('id, score, tags, category_slug').eq('status', 'active');
  if (event.categories?.length) {
    query = query.in('category_slug', event.categories);
  }

  const { data: deals, error } = await query.limit(500);
  if (error) { logger.err(`query error: ${error.message}`); return 0; }
  if (!deals?.length) return 0;

  const seasonalTags = getSeasonalTags(event);
  const boost        = calcEventBoost(event);

  for (const deal of deals) {
    try {
      const newScore = Math.min(100, (deal.score || 50) + boost);
      const newTags  = Array.from(new Set([...(deal.tags || []), ...seasonalTags]));
      await supabase.from('deals')
        .update({ score: newScore, tags: newTags })
        .eq('id', deal.id);
      updated++;
    } catch (e) {
      logger.err(`עדכון דיל ${deal.id}: ${e.message}`);
    }
  }

  return updated;
}

// ── main ───────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-15 Seasonal Intel — מתחיל ===');

  let logId;
  try { logId = await logStart(); } catch (e) { logger.err(`bots_log: ${e.message}`); }
  const stats = { added: 0, updated: 0, errors: [] };

  try {
    const upcoming = getUpcomingEvents(21);  // 3 שבועות קדימה

    if (!upcoming.length) {
      logger.log('אין אירועים קרובים — אין מה לעדכן');
      if (logId) await logFinish(logId, stats, 'done');
      return;
    }

    logger.log(`נמצאו ${upcoming.length} אירועים קרובים:`);
    for (const event of upcoming) {
      logger.log(`  📅 ${event.id} — בעוד ${event.daysUntil} ימים (boost: +${calcEventBoost(event)})`);
    }

    for (const event of upcoming) {
      logger.log(`מעדכן דילים עבור: ${event.id}`);
      try {
        const updated = await boostDealsForEvent(event, logger);
        stats.updated += updated;
        logger.ok(`  עודכנו ${updated} דילים`);
      } catch (e) {
        logger.err(`שגיאה ב-${event.id}: ${e.message}`);
        stats.errors.push(e.message);
      }
    }

    logger.ok(`סיכום: ${stats.updated} דילים עודכנו, ${upcoming.length} אירועים טופלו`);
    logger.ok(`=== BOT-15 סיים — ${logger.elapsed()} ===`);
  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, stats.errors.length > 0 ? 'error' : 'done');
  }
}

const isMain = process.argv[1]?.endsWith('bot15.mjs') || process.argv[1]?.endsWith('bot15');
if (isMain) main();
