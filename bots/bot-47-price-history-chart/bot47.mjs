// ════════════════════════════════════════════════════════════
// BOT-47 — Price History Chart
// תפקיד: קורא מ-price_history ומייצר נקודות נתונים מצטברות
//         לתצוגת גרף מחיר בפרונטאנד.
//
// לוגיקה:
//   1. שולף דילים שדורשים עדכון chart (chart_updated_at > 24h או NULL)
//   2. לכל דיל — קורא price_history ומחשב:
//      - daily aggregated data points (min price per day)
//      - 7-day moving average
//      - price extremes (min/max + dates)
//      - percentile rank (0=all time low, 100=all time high)
//   3. upsert ל-price_chart_cache
//   4. מעדכן deals.chart_updated_at
//   5. מתעד ב-bots_log
//
// תדירות: פעם ביום 06:00 UTC (Railway cron: 0 6 * * *)
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID         = 'BOT-47';
const BATCH_SIZE     = 50;
const CHART_DAYS_DEFAULT = 90;
const CACHE_TTL_HOURS    = 24;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות (מיוצאות לטסטים)
// ════════════════════════════════════════════════════════════

/**
 * filterByDeal — מסנן שורות price_history לדיל ספציפי.
 * @param {Array<{deal_id: string, price: number, recorded_at: string}>} rows
 * @param {string} dealId
 * @returns {Array}
 */
export function filterByDeal(rows, dealId) {
  if (!Array.isArray(rows) || !dealId) return [];
  return rows.filter(r => r.deal_id === dealId);
}

/**
 * aggregateChartData — מצבר שורות price_history לנקודות יומיות.
 * משתמש במחיר הנמוך ביותר לכל יום.
 * @param {Array<{price: number|string, recorded_at: string}>} priceRows
 * @param {number} windowDays — כמה ימים אחורה להביא (0 = הכל)
 * @returns {Array<{date: string, price: number}>}
 */
export function aggregateChartData(priceRows, windowDays = 0) {
  if (!Array.isArray(priceRows) || priceRows.length === 0) return [];

  const cutoffMs = windowDays > 0
    ? Date.now() - windowDays * 24 * 60 * 60 * 1000
    : 0;

  // Group by date string (YYYY-MM-DD), keep lowest price per day
  const byDay = new Map();

  for (const row of priceRows) {
    if (!row.recorded_at || row.price == null) continue;

    const ts = new Date(row.recorded_at);
    if (isNaN(ts.getTime())) continue;
    if (cutoffMs > 0 && ts.getTime() < cutoffMs) continue;

    const dateStr = ts.toISOString().substring(0, 10); // YYYY-MM-DD
    const price   = Number(row.price);
    if (isNaN(price)) continue;

    if (!byDay.has(dateStr) || price < byDay.get(dateStr)) {
      byDay.set(dateStr, price);
    }
  }

  // Sort by date ascending
  const sorted = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }));

  return sorted;
}

/**
 * computeMovingAverage — מחשב ממוצע נע.
 * מחזיר מערך באותו אורך כמו הקלט.
 * @param {Array<{date: string, price: number}>} dataPoints
 * @param {number} windowSize — גודל החלון (ברירת מחדל: 7)
 * @returns {Array<{date: string, avg: number}>}
 */
export function computeMovingAverage(dataPoints, windowSize = 7) {
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) return [];

  return dataPoints.map((point, i) => {
    const start  = Math.max(0, i - windowSize + 1);
    const window = dataPoints.slice(start, i + 1);
    const sum    = window.reduce((acc, p) => acc + p.price, 0);
    const avg    = Number((sum / window.length).toFixed(2));
    return { date: point.date, avg };
  });
}

/**
 * findPriceExtremes — מוצא מחיר מינימלי ומקסימלי + תאריכים.
 * @param {Array<{date: string, price: number}>} dataPoints
 * @returns {{ min: number, max: number, minDate: string, maxDate: string } | null}
 */
export function findPriceExtremes(dataPoints) {
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) return null;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let minDate  = null;
  let maxDate  = null;

  for (const { date, price } of dataPoints) {
    if (price < minPrice) { minPrice = price; minDate = date; }
    if (price > maxPrice) { maxPrice = price; maxDate = date; }
  }

  if (minDate === null) return null;

  return {
    min:     minPrice,
    max:     maxPrice,
    minDate,
    maxDate,
  };
}

/**
 * computePercentileRank — מחשב דירוג אחוזון של מחיר נוכחי.
 * 0 = all-time low, 100 = all-time high.
 * @param {number} currentPrice
 * @param {number[]} allPrices  — כל המחירים בהיסטוריה
 * @returns {number}  — 0..100 integer
 */
export function computePercentileRank(currentPrice, allPrices) {
  if (!Array.isArray(allPrices) || allPrices.length === 0) return 50;
  if (typeof currentPrice !== 'number' || isNaN(currentPrice)) return 50;

  const valid = allPrices.filter(p => typeof p === 'number' && !isNaN(p));
  if (valid.length === 0) return 50;

  const min = Math.min(...valid);
  const max = Math.max(...valid);

  if (min === max) return 50; // all prices identical

  const rank = ((currentPrice - min) / (max - min)) * 100;
  return Math.round(Math.max(0, Math.min(100, rank)));
}

/**
 * generateChartPoints — מייצר נקודות גרף לN ימים אחרונים.
 * מסמן is_sale=true כאשר המחיר מתחת ל-85% מהממוצע.
 * @param {Array<{price: number|string, recorded_at: string}>} priceRows
 * @param {number} days  — כמה ימים אחורה
 * @returns {Array<{date: string, price: number, is_sale: boolean}>}
 */
export function generateChartPoints(priceRows, days = CHART_DAYS_DEFAULT) {
  if (!Array.isArray(priceRows) || priceRows.length === 0) return [];

  // Aggregate first (respects windowDays)
  const aggregated = aggregateChartData(priceRows, days);
  if (aggregated.length === 0) return [];

  // Compute average across all points in the window
  const avgPrice = aggregated.reduce((sum, p) => sum + p.price, 0) / aggregated.length;
  const saleThreshold = avgPrice * 0.85;

  return aggregated.map(({ date, price }) => ({
    date,
    price,
    is_sale: price <= saleThreshold,
  }));
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

async function logFinish(logId, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    errors:        stats.errors  || [],
  }).eq('id', logId);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

/**
 * fetchDealsNeedingChartUpdate — דילים שמחכים לעדכון גרף.
 * כולל דילים שלא עודכנו ב-24 שעות האחרונות (או שמעולם לא עודכנו).
 */
async function fetchDealsNeedingChartUpdate() {
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('deals')
    .select('id, title, price, currency, discount')
    .eq('status', 'active')
    .or(`chart_updated_at.is.null,chart_updated_at.lt.${cutoff}`)
    .order('chart_updated_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) throw new Error(`fetchDealsNeedingChartUpdate: ${error.message}`);
  return data || [];
}

/**
 * fetchPriceHistory — שולף כל שורות price_history לדיל.
 */
async function fetchPriceHistory(dealId) {
  const { data, error } = await supabase
    .from('price_history')
    .select('deal_id, price, currency, recorded_at')
    .eq('deal_id', dealId)
    .order('recorded_at', { ascending: true });

  if (error) throw new Error(`fetchPriceHistory(${dealId}): ${error.message}`);
  return data || [];
}

/**
 * upsertChartCache — שמירת נתוני גרף ל-price_chart_cache.
 */
async function upsertChartCache(dealId, payload) {
  const { error } = await supabase
    .from('price_chart_cache')
    .upsert({
      deal_id:         dealId,
      chart_data:      payload.chartData,
      moving_avg_7d:   payload.movingAvg,
      price_min:       payload.priceMin,
      price_max:       payload.priceMax,
      price_current:   payload.priceCurrent,
      percentile_rank: payload.percentileRank,
      days_tracked:    payload.daysTracked,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'deal_id' });

  if (error) throw new Error(`upsertChartCache(${dealId}): ${error.message}`);
}

/**
 * markDealChartUpdated — aggiorna chart_updated_at sul deal.
 */
async function markDealChartUpdated(dealId) {
  await supabase
    .from('deals')
    .update({ chart_updated_at: new Date().toISOString() })
    .eq('id', dealId);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log('Starting BOT-47 — Price History Chart');

  let logId;
  const stats = { updated: 0, skipped: 0, errors: [] };

  try {
    logId = await logStart();
  } catch (e) {
    log.warn(`bots_log start: ${e.message}`);
  }

  try {
    const deals = await fetchDealsNeedingChartUpdate();
    log.log(`Processing ${deals.length} deals for chart data`);

    for (const deal of deals) {
      try {
        const rows = await fetchPriceHistory(deal.id);

        if (rows.length === 0) {
          log.log(`No price history for deal ${deal.id} — skipping`);
          stats.skipped++;
          await markDealChartUpdated(deal.id); // avoid re-processing empty deals
          continue;
        }

        // Generate chart points (90-day window)
        const chartPoints = generateChartPoints(rows, 90);
        const movingAvg   = computeMovingAverage(chartPoints, 7);
        const extremes    = findPriceExtremes(chartPoints);
        const allPrices   = chartPoints.map(p => p.price);
        const pctRank     = computePercentileRank(
          deal.price != null ? Number(deal.price) : (allPrices[allPrices.length - 1] ?? 0),
          allPrices
        );

        await upsertChartCache(deal.id, {
          chartData:      chartPoints,
          movingAvg:      movingAvg,
          priceMin:       extremes?.min   ?? null,
          priceMax:       extremes?.max   ?? null,
          priceCurrent:   deal.price      != null ? Number(deal.price) : null,
          percentileRank: pctRank,
          daysTracked:    chartPoints.length > 0
            ? Math.ceil((
                new Date(chartPoints[chartPoints.length - 1].date) -
                new Date(chartPoints[0].date)
              ) / (24 * 60 * 60 * 1000)) + 1
            : 0,
        });

        await markDealChartUpdated(deal.id);
        stats.updated++;

        log.ok(`Updated chart for "${deal.title?.substring(0, 40)}" (${rows.length} history rows, ${chartPoints.length} chart points)`);

      } catch (err) {
        log.err(`Deal ${deal.id}: ${err.message}`);
        stats.errors.push(`deal ${deal.id}: ${err.message}`);
      }
    }

    log.ok(`Done — updated: ${stats.updated}, skipped: ${stats.skipped}`);

  } catch (err) {
    log.err(err.message);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot47.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-47 crashed:', err); process.exit(1); });
}
