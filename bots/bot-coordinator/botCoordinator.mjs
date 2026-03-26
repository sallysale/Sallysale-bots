// ════════════════════════════════════════════════════════════
// BOT-Coordinator — Queue Manager
// תפקיד: מנהל תור הרצת בוטים — מקסימום 3 בוטים רצים במקביל.
//         בוט חדש ממתין בתור עד שיש מקום פנוי.
//         מתעד תור ב-bot_queue.
//         מופעל on-demand כ-utility module.
//
// שימוש: import { enqueue, processQueue } from './botCoordinator.mjs'
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-COORDINATOR';
const MAX_CONCURRENT = 3;
const POLL_INTERVAL  = 5000;  // 5 שניות
const MAX_WAIT_MS    = 300000; // 5 דקות timeout לתור

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
      deals_updated: stats.processed || 0,
      errors:        stats.errors || [],
    })
    .eq('id', logId);
}

// ── ספור בוטים פעילים כרגע ───────────────────────────────────
async function countRunning() {
  const { count, error } = await supabase
    .from('bot_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'running');
  if (error) return 0;
  return count || 0;
}

// ── הוסף בוט לתור ────────────────────────────────────────────
export async function enqueue(botId, priority = 5) {
  const { data, error } = await supabase
    .from('bot_queue')
    .insert({
      bot_id:     botId,
      status:     'queued',
      priority,
      queued_at:  new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`enqueue failed for ${botId}: ${error.message}`);
  return data.id;
}

// ── סמן בוט כ-running ────────────────────────────────────────
export async function markRunning(queueId) {
  const { error } = await supabase
    .from('bot_queue')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', queueId);
  if (error) throw new Error(`markRunning failed: ${error.message}`);
}

// ── סמן בוט כ-done ───────────────────────────────────────────
export async function markDone(queueId, status = 'done') {
  const { error } = await supabase
    .from('bot_queue')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', queueId);
  if (error) throw new Error(`markDone failed: ${error.message}`);
}

// ── המתן לתור עד שיש מקום ─────────────────────────────────────
export async function waitForSlot(botId, logger) {
  const start = Date.now();

  while (true) {
    const running = await countRunning();

    if (running < MAX_CONCURRENT) {
      if (logger) logger.log(`${botId}: slot פנוי (${running}/${MAX_CONCURRENT} רצים)`);
      return true;
    }

    const elapsed = Date.now() - start;
    if (elapsed >= MAX_WAIT_MS) {
      if (logger) logger.warn(`${botId}: timeout אחרי ${MAX_WAIT_MS / 1000}s בתור`);
      return false;
    }

    if (logger) logger.log(`${botId}: ממתין בתור (${running}/${MAX_CONCURRENT} רצים, ${Math.round(elapsed / 1000)}s)...`);
    await sleep(POLL_INTERVAL);
  }
}

// ── עיבוד תור — הפעל הבא בתור ────────────────────────────────
export async function processQueue(logger) {
  const running = await countRunning();
  if (running >= MAX_CONCURRENT) {
    if (logger) logger.log(`תור מלא (${running}/${MAX_CONCURRENT}) — אין פעולה`);
    return null;
  }

  // שלוף הבא בתור לפי עדיפות + זמן
  const { data: nextItems, error } = await supabase
    .from('bot_queue')
    .select('*')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('queued_at', { ascending: true })
    .limit(1);

  if (error || !nextItems || nextItems.length === 0) return null;

  const item = nextItems[0];
  await markRunning(item.id);
  if (logger) logger.ok(`▶️  הפעלתי: ${item.bot_id} (priority=${item.priority})`);
  return item;
}

// ── קבל סטטוס תור ────────────────────────────────────────────
export async function getQueueStatus() {
  const { data, error } = await supabase
    .from('bot_queue')
    .select('bot_id, status, priority, queued_at, started_at, finished_at')
    .in('status', ['queued', 'running'])
    .order('priority', { ascending: false })
    .order('queued_at', { ascending: true });

  if (error) return { queued: [], running: [] };

  return {
    queued:  data.filter(r => r.status === 'queued'),
    running: data.filter(r => r.status === 'running'),
  };
}

// ── ניקוי רשומות ישנות ────────────────────────────────────────
export async function cleanOldEntries(daysOld = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const { error } = await supabase
    .from('bot_queue')
    .delete()
    .in('status', ['done', 'timeout', 'error'])
    .lt('finished_at', cutoff.toISOString());

  return !error;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main (standalone — דוח תור) ───────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-Coordinator — דוח תור ===');

  let logId;
  try { logId = await logStart(); } catch (e) { logger.err(e.message); }

  const stats = { processed: 0, errors: [] };

  try {
    const status = await getQueueStatus();
    logger.ok(`📊 תור נוכחי:`);
    logger.ok(`  ▶️  רצים:   ${status.running.length}/${MAX_CONCURRENT}`);
    logger.ok(`  ⏳ ממתינים: ${status.queued.length}`);

    for (const item of status.running) {
      logger.log(`  ▶️  ${item.bot_id} (since ${item.started_at})`);
    }
    for (const item of status.queued) {
      logger.log(`  ⏳ ${item.bot_id} (priority=${item.priority})`);
    }

    // ניקוי
    const cleaned = await cleanOldEntries(7);
    if (cleaned) logger.log('🗑️  רשומות ישנות נוקו');

    stats.processed = status.running.length + status.queued.length;
    logger.ok(`=== BOT-Coordinator סיים — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
  }
}

if (process.argv[1] && process.argv[1].endsWith('botCoordinator.mjs')) {
  main();
}
