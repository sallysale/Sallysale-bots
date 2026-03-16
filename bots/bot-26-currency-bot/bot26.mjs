// ════════════════════════════════════════════════════════════
// BOT-26 — Currency Bot
// תפקיד: מושך שערי חליפין כל שעה מ-exchangerate-api.com
//         ומעדכן את טבלת exchange_rates ב-Supabase.
//
// מטבעות נתמכים: USD, EUR, GBP, ILS, JPY, AUD, CAD, CHF, SEK, NOK, DKK
// בסיס: USD (הכל יחסי לדולר)
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
// API: https://v6.exchangerate-api.com/v6/{KEY}/latest/USD (חינם — 1500 req/חודש)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { createLogger } from '../shared/logger.mjs';

const BOT_ID = 'BOT-26';

// מטבעות שSallySale תומך בהם
export const SUPPORTED_CURRENCIES = [
  'EUR', 'GBP', 'ILS', 'JPY', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK',
  'PLN', 'HUF', 'CZK', 'TRY', 'KRW', 'SGD', 'HKD', 'MXN', 'BRL', 'ZAR',
];

const BASE_CURRENCY = 'USD';
const API_KEY = process.env.EXCHANGERATE_API_KEY;

// ── bots_log ───────────────────────────────────────────────────

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
      finished_at:  new Date().toISOString(),
      status,
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── שליפת שערים מ-API ─────────────────────────────────────────

/**
 * מושך שערי חליפין מ-exchangerate-api.com.
 * אם אין API key — משתמש ב-open.er-api.com (חינם ללא key).
 * מחזיר { USD: 1, EUR: 0.92, ... }
 */
export async function fetchRates(logger) {
  let url;
  if (API_KEY) {
    url = `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/${BASE_CURRENCY}`;
  } else {
    // fallback ציבורי — ללא API key (100 req/חודש)
    url = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`;
    logger.warn('EXCHANGERATE_API_KEY לא מוגדר — משתמש ב-open.er-api.com (מגבלות גבוהות יותר)');
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`API שגיאה: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  // exchangerate-api.com: { conversion_rates: { EUR: 0.92, ... } }
  // open.er-api.com:      { rates: { EUR: 0.92, ... } }
  const rates = json.conversion_rates || json.rates;
  if (!rates) throw new Error('תגובת API לא תקינה — חסר rates');

  return rates;
}

// ── שמירה ב-Supabase ───────────────────────────────────────────

async function saveRates(rates, logger) {
  const now = new Date().toISOString();
  const rows = [];

  for (const currency of SUPPORTED_CURRENCIES) {
    const rate = rates[currency];
    if (!rate || rate <= 0) {
      logger.warn(`מטבע ${currency} לא נמצא ב-API`);
      continue;
    }
    rows.push({
      base:        BASE_CURRENCY,
      target:      currency,
      rate,
      recorded_at: now,
      source:      API_KEY ? 'exchangerate-api' : 'open-er-api',
    });
  }

  // Upsert — מחליף שער קיים לאותה pair
  const { error } = await supabase
    .from('exchange_rates')
    .upsert(rows, { onConflict: 'base,target' });

  if (error) throw new Error(`שמירת שערים נכשלה: ${error.message}`);

  return rows.length;
}

// ── log rates לקונסול ──────────────────────────────────────────

function printRates(rates, logger) {
  const highlights = ['EUR', 'GBP', 'ILS', 'JPY'];
  for (const c of highlights) {
    if (rates[c]) logger.ok(`  1 USD = ${rates[c].toFixed(4)} ${c}`);
  }
}

// ── main ──────────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-26 Currency Bot — מתחיל ===');

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { updated: 0, errors: [] };

  try {
    const rates = await fetchRates(logger);
    logger.ok(`✅ שערים נשלפו מה-API (${Object.keys(rates).length} מטבעות)`);

    printRates(rates, logger);

    const saved = await saveRates(rates, logger);
    stats.updated = saved;

    logger.ok(`✅ ${saved} שערים נשמרו ב-Supabase`);
    logger.ok(`=== BOT-26 סיים בהצלחה — ${logger.elapsed()} ===`);

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
