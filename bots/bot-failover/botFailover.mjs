// ════════════════════════════════════════════════════════════
// BOT-Failover — Automatic API Failover
// תפקיד: אם API חיצוני (Zara/H&M וכו') לא מגיב → עובר ל-ScraperAPI.
//         אם ScraperAPI נחסם → עובר למקור גיבוי שני.
//         שולח התראת Telegram על כל failover.
//         מתעד בטבלת failover_log.
//         שולח דוח בוקר יומי ב-08:00 UTC.
//
// תדירות: כל שעה (Railway cron: 0 * * * *)
//
// שימוש כ-module: import { fetchWithFailover } from './botFailover.mjs'
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import https   from 'https';
import http    from 'http';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID         = 'BOT-FAILOVER';
const CHECK_TIMEOUT  = 10000; // 10 שניות לבדיקת זמינות
const FETCH_TIMEOUT  = 20000; // 20 שניות לfetch

// ── מקורות גיבוי לפי store ───────────────────────────────────
// primary → scraperapi → backup
const FAILOVER_CHAINS = {
  'zara':          { scraperTag: 'js_off',  backup: 'https://www.zara.com' },
  'hm':            { scraperTag: 'js_off',  backup: null },
  'mango':         { scraperTag: 'js_off',  backup: null },
  'ikea':          { scraperTag: 'js_off',  backup: null },
  'net-a-porter':  { scraperTag: 'render',  backup: null },
  'amazon':        { scraperTag: 'autoparse', backup: null },
  'default':       { scraperTag: 'js_off',  backup: null },
};

// ── Telegram ─────────────────────────────────────────────────
function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return Promise.resolve();

  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

// ── bots_log ─────────────────────────────────────────────────
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
      deals_updated: stats.failovers || 0,
      errors:        stats.errors || [],
    })
    .eq('id', logId);
}

// ── רשום failover ─────────────────────────────────────────────
async function recordFailover(store, fromSource, toSource, reason) {
  await supabase
    .from('failover_log')
    .insert({
      store_name:    store,
      from_source:   fromSource,
      to_source:     toSource,
      reason,
      failed_at:     new Date().toISOString(),
    });
}

// ── בדיקת זמינות URL ──────────────────────────────────────────
function checkAvailability(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith('http')) {
      resolve({ available: false, reason: 'invalid_url' });
      return;
    }

    const mod = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve({ available: false, reason: 'timeout' }), CHECK_TIMEOUT);

    try {
      const req = mod.request(url, { method: 'HEAD' }, (res) => {
        clearTimeout(timeout);
        const ok = res.statusCode >= 200 && res.statusCode < 500;
        resolve({ available: ok, status: res.statusCode, reason: ok ? 'ok' : `http_${res.statusCode}` });
      });
      req.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ available: false, reason: err.code || 'network_error' });
      });
      req.end();
    } catch {
      clearTimeout(timeout);
      resolve({ available: false, reason: 'exception' });
    }
  });
}

// ── בנה URL דרך ScraperAPI ────────────────────────────────────
function buildScraperApiUrl(originalUrl, tag = 'js_off') {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    api_key: key,
    url:     originalUrl,
  });

  if (tag === 'render')     params.set('render', 'true');
  if (tag === 'autoparse')  params.set('autoparse', 'true');

  return `https://api.scraperapi.com/?${params.toString()}`;
}

// ── fetch עם failover אוטומטי ─────────────────────────────────
export async function fetchWithFailover(targetUrl, storeName) {
  const logger = createLogger(BOT_ID);
  const chain  = FAILOVER_CHAINS[storeName?.toLowerCase()] || FAILOVER_CHAINS.default;

  // 1. נסה primary
  const primaryCheck = await checkAvailability(targetUrl);
  if (primaryCheck.available) {
    return { url: targetUrl, source: 'primary', ok: true };
  }

  logger.warn(`${storeName}: primary כשל (${primaryCheck.reason}) — מנסה ScraperAPI`);
  await recordFailover(storeName, 'primary', 'scraperapi', primaryCheck.reason);
  await sendTelegram(`⚠️ <b>Failover</b>: ${storeName}\nprimary → ScraperAPI\nסיבה: ${primaryCheck.reason}`);

  // 2. נסה ScraperAPI
  const scraperUrl = buildScraperApiUrl(targetUrl, chain.scraperTag);
  if (scraperUrl) {
    const scraperCheck = await checkAvailability(scraperUrl);
    if (scraperCheck.available) {
      return { url: scraperUrl, source: 'scraperapi', ok: true };
    }

    logger.warn(`${storeName}: ScraperAPI גם כשל (${scraperCheck.reason}) — מנסה גיבוי שני`);
    await recordFailover(storeName, 'scraperapi', chain.backup || 'none', scraperCheck.reason);
    await sendTelegram(`🔴 <b>Failover Level 2</b>: ${storeName}\nScraperAPI → backup\nסיבה: ${scraperCheck.reason}`);
  }

  // 3. נסה backup
  if (chain.backup) {
    const backupCheck = await checkAvailability(chain.backup);
    if (backupCheck.available) {
      return { url: chain.backup, source: 'backup', ok: true };
    }
  }

  // 4. הכל נכשל
  logger.err(`${storeName}: כל המקורות כשלו`);
  await sendTelegram(`🚨 <b>Total Failover</b>: ${storeName}\n❌ כל המקורות לא זמינים!`);
  return { url: targetUrl, source: 'failed', ok: false };
}

// ── בדיקת זמינות כל המקורות ──────────────────────────────────
async function checkAllSources(logger) {
  const SOURCES_TO_CHECK = [
    { name: 'zara',          url: 'https://www.zara.com' },
    { name: 'hm',            url: 'https://www2.hm.com' },
    { name: 'mango',         url: 'https://shop.mango.com' },
    { name: 'ikea',          url: 'https://www.ikea.com' },
    { name: 'scraperapi',    url: 'https://api.scraperapi.com/account' },
  ];

  const results = [];

  for (const source of SOURCES_TO_CHECK) {
    const { available, reason } = await checkAvailability(source.url);
    results.push({ ...source, available, reason });
    logger.log(`${source.name}: ${available ? '✅ זמין' : `❌ לא זמין (${reason})`}`);
  }

  return results;
}

// ── דוח בוקר (08:00 UTC) ─────────────────────────────────────
async function sendMorningReport(results, logger) {
  const now = new Date();
  if (now.getUTCHours() !== 8) return;

  logger.log('📋 שולח דוח בוקר...');

  const down = results.filter(r => !r.available);
  let msg = `📊 <b>BOT-Failover — דוח בוקר ${now.toISOString().slice(0, 10)}</b>\n\n`;

  if (down.length === 0) {
    msg += `✅ כל המקורות זמינים`;
  } else {
    msg += `🔴 ${down.length} מקורות לא זמינים:\n`;
    for (const r of down) {
      msg += `  • ${r.name}: ${r.reason}\n`;
    }
  }

  // failovers ב-24 שעות האחרונות
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count } = await supabase
    .from('failover_log')
    .select('*', { count: 'exact', head: true })
    .gte('failed_at', since.toISOString());

  msg += `\n🔄 Failovers ב-24h: ${count || 0}`;

  await sendTelegram(msg);
  logger.ok('📨 דוח בוקר נשלח');
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-Failover — בדיקת מקורות ===');

  const stats = { checked: 0, failovers: 0, errors: [] };
  let logId;

  try { logId = await logStart(); } catch (e) { logger.err(e.message); }

  try {
    const results = await checkAllSources(logger);
    stats.checked = results.length;

    const downCount = results.filter(r => !r.available).length;
    if (downCount > 0) {
      stats.failovers = downCount;
      logger.warn(`⚠️  ${downCount} מקורות לא זמינים`);
    } else {
      logger.ok('✅ כל המקורות זמינים');
    }

    await sendMorningReport(results, logger);

    logger.ok(`📊 סיכום BOT-Failover:`);
    logger.ok(`  🔍 נבדקו: ${stats.checked}`);
    logger.ok(`  ❌ לא זמינים: ${stats.failovers}`);
    logger.ok(`=== BOT-Failover סיים — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
  }
}

main();
