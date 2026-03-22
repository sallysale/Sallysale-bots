// ════════════════════════════════════════════════════════════
// BOT-39 — Backup Bot
// תפקיד: גיבוי שבועי של טבלת deals ל-JSON.
//         שומר metadata בטבלת backups.
//         מנקה גיבויים ישנים (שומר 4 אחרונים).
//
// תדירות: כל ראשון ב-01:00 UTC (Railway cron: 0 1 * * 0)
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (מ-shared)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-39';
const log     = createLogger(BOT_ID);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BACKUP_DIR          = path.join(__dirname, '../../backups');
export const KEEP_BACKUPS        = 4;
export const BACKUP_INTERVAL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
const PAGE_SIZE                  = 1000;

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * buildBackupFilename — שם קובץ גיבוי.
 * @param {Date} date
 * @returns {string} e.g. "deals-2026-03-17.json"
 */
export function buildBackupFilename(date = new Date()) {
  const y  = date.getUTCFullYear();
  const m  = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(date.getUTCDate()).padStart(2, '0');
  return `deals-${y}-${m}-${d}.json`;
}

/**
 * serializeDeals — ממיר מערך דילים ל-JSON string.
 * @param {Array<object>} deals
 * @returns {string}
 */
export function serializeDeals(deals) {
  return JSON.stringify(deals || [], null, 2);
}

/**
 * calcFileSizeBytes — גודל string ב-bytes.
 * @param {string} jsonStr
 * @returns {number}
 */
export function calcFileSizeBytes(jsonStr) {
  return Buffer.byteLength(jsonStr, 'utf8');
}

/**
 * shouldRunBackup — האם לרוץ עכשיו.
 * @param {Date|null} lastBackupAt
 * @param {number} intervalMs
 * @returns {boolean}
 */
export function shouldRunBackup(lastBackupAt, intervalMs = BACKUP_INTERVAL_MS) {
  if (!lastBackupAt) return true;
  return Date.now() - new Date(lastBackupAt).getTime() >= intervalMs;
}

/**
 * parseBackupFilename — פיענוח שם קובץ.
 * @param {string} filename
 * @returns {{ date: Date } | null}
 */
export function parseBackupFilename(filename) {
  const match = filename.match(/^deals-(\d{4}-\d{2}-\d{2})\.json$/);
  if (!match) return null;
  const date = new Date(match[1] + 'T00:00:00.000Z');
  return isNaN(date.getTime()) ? null : { date };
}

/**
 * selectOldBackups — בוחר גיבויים למחיקה (ישאר רק KEEP_BACKUPS).
 * @param {Array<{ filename: string, created_at: string }>} backups
 * @param {number} keepCount
 * @returns {Array<object>} גיבויים למחיקה
 */
export function selectOldBackups(backups, keepCount = KEEP_BACKUPS) {
  if (!Array.isArray(backups) || backups.length <= keepCount) return [];
  const sorted = [...backups].sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
  return sorted.slice(keepCount);
}

// ════════════════════════════════════════════════════════════
// DB functions
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
    finished_at:   new Date().toISOString(),
    status,
    deals_updated: stats.recordCount,
    errors:        stats.errors,
  }).eq('id', logId);
}

async function fetchLastBackup() {
  const { data } = await supabase
    .from('backups')
    .select('created_at, filename')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function fetchAllDeals() {
  const deals = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .order('id');

    if (error) throw new Error(`fetchDeals page ${page}: ${error.message}`);
    if (!data || data.length === 0) break;
    deals.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  return deals;
}

async function saveBackupRecord(filename, recordCount, sizeBytes, status, errorMsg = null) {
  const { data, error } = await supabase
    .from('backups')
    .insert({
      filename,
      table_name:    'deals',
      record_count:  recordCount,
      size_bytes:    sizeBytes,
      status,
      error_msg:     errorMsg,
      completed_at:  status === 'completed' ? new Date().toISOString() : null,
    })
    .select('id').single();

  if (error) throw new Error(`saveBackupRecord: ${error.message}`);
  return data.id;
}

async function fetchOldBackupRecords() {
  const { data, error } = await supabase
    .from('backups')
    .select('id, filename, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`fetchBackups: ${error.message}`);
  return data || [];
}

async function deleteBackupRecord(id) {
  await supabase.from('backups').delete().eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Weekly Backup Bot`);

  let logId;
  const stats = { recordCount: 0, sizeBytes: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    // בדוק אם צריך לרוץ
    const lastBackup = await fetchLastBackup();
    if (lastBackup && !shouldRunBackup(lastBackup.created_at)) {
      log.log(`⏭️ גיבוי אחרון: ${lastBackup.filename} — עדיין לא הגיע הזמן`);
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    // ודא שתיקיית backups קיימת
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // שלוף את כל הדילים
    log.log('📥 שולף דילים...');
    const deals = await fetchAllDeals();
    log.log(`📦 נשלפו ${deals.length} דילים`);
    stats.recordCount = deals.length;

    // סדרה + כתיבה לקובץ
    const filename  = buildBackupFilename();
    const jsonStr   = serializeDeals(deals);
    const sizeBytes = calcFileSizeBytes(jsonStr);
    const filepath  = path.join(BACKUP_DIR, filename);

    writeFileSync(filepath, jsonStr, 'utf8');
    stats.sizeBytes = sizeBytes;
    log.ok(`💾 נכתב: ${filename} (${(sizeBytes / 1024).toFixed(1)} KB)`);

    // שמור metadata ב-DB
    await saveBackupRecord(filename, deals.length, sizeBytes, 'completed');

    // נקה גיבויים ישנים
    const allBackups = await fetchOldBackupRecords();
    const toDelete   = selectOldBackups(allBackups);

    for (const old of toDelete) {
      const oldPath = path.join(BACKUP_DIR, old.filename);
      if (existsSync(oldPath)) {
        unlinkSync(oldPath);
        log.log(`🗑️ נמחק גיבוי ישן: ${old.filename}`);
      }
      await deleteBackupRecord(old.id);
    }

    log.ok(`✅ גיבוי הושלם: ${deals.length} רשומות, ${toDelete.length} ישנים נמחקו`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
    try {
      await saveBackupRecord(buildBackupFilename(), 0, 0, 'failed', err.message);
    } catch (e2) { /* ignore */ }
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot39.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-39 crashed:', err); process.exit(1); });
}
