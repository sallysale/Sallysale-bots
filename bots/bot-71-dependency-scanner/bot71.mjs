// ════════════════════════════════════════════════════════════
// BOT-71 — Dependency Scanner
// תפקיד: מריץ npm audit על תיקיות הבוטים, שולח התראת Telegram
//         אם נמצאה חבילה פגיעה ברמת critical/high.
//         מתעד תוצאות ב-bots_log.
//
// תדירות: פעם בשבוע (Railway cron: 0 8 * * 1)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import { execSync }  from 'child_process';
import path          from 'path';
import { fileURLToPath } from 'url';
import https         from 'https';
import fs            from 'fs';
import supabase      from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-71';
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const BOTS_ROOT  = path.resolve(__dirname, '..');

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
    }, (res) => {
      res.resume();
      resolve();
    });
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
      deals_updated: 0,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── מצא תיקיות בוטים שיש בהן package.json ────────────────────
function findBotDirs() {
  const dirs = [];
  try {
    const entries = fs.readdirSync(BOTS_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'shared') continue;
      const pkgPath = path.join(BOTS_ROOT, entry.name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        dirs.push(path.join(BOTS_ROOT, entry.name));
      }
    }
  } catch (e) {
    // fallback — רק תיקייה נוכחית
    dirs.push(__dirname);
  }
  return dirs;
}

// ── הרץ npm audit בתיקייה ──────────────────────────────────────
function runAudit(dir) {
  try {
    // --json מחזיר JSON מובנה; exitCode != 0 כשיש vulnerabilities
    const output = execSync('npm audit --json --omit=dev', {
      cwd:      dir,
      timeout:  60000,
      encoding: 'utf8',
      stdio:    ['pipe', 'pipe', 'pipe'],
    });
    return { dir, raw: output, error: null };
  } catch (err) {
    // npm audit מחזיר exit code 1 כשיש פגיעויות — זה תקין
    const output = err.stdout || '';
    return { dir, raw: output, error: err.stderr || null };
  }
}

// ── נתח תוצאות audit ──────────────────────────────────────────
function parseAuditResult(raw, dir) {
  if (!raw) return { dir, total: 0, critical: 0, high: 0, moderate: 0, low: 0, packages: [] };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { dir, total: 0, critical: 0, high: 0, moderate: 0, low: 0, packages: [], parseError: true };
  }

  const meta = parsed.metadata?.vulnerabilities || {};
  const result = {
    dir,
    total:    meta.total    || 0,
    critical: meta.critical || 0,
    high:     meta.high     || 0,
    moderate: meta.moderate || 0,
    low:      meta.low      || 0,
    packages: [],
  };

  // אסוף שמות חבילות עם critical/high
  if (parsed.vulnerabilities) {
    for (const [pkg, info] of Object.entries(parsed.vulnerabilities)) {
      const sev = info.severity || '';
      if (sev === 'critical' || sev === 'high') {
        result.packages.push({ pkg, severity: sev, via: info.via?.[0]?.title || '' });
      }
    }
  }

  return result;
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-71 Dependency Scanner — מתחיל ===');

  const stats = { scanned: 0, withVulns: 0, totalCritical: 0, totalHigh: 0, errors: [] };
  let logId;

  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  try {
    const botDirs = findBotDirs();
    logger.log(`נמצאו ${botDirs.length} תיקיות בוטים לסריקה`);

    const results = [];

    for (const dir of botDirs) {
      const name = path.basename(dir);
      logger.log(`סורק: ${name}...`);
      stats.scanned++;

      const { raw, error: auditErr } = runAudit(dir);

      if (auditErr && !raw) {
        logger.warn(`${name}: לא ניתן להריץ npm audit — ${auditErr.slice(0, 100)}`);
        stats.errors.push(`${name}: ${auditErr.slice(0, 100)}`);
        continue;
      }

      const result = parseAuditResult(raw, name);
      results.push(result);

      if (result.critical > 0 || result.high > 0) {
        stats.withVulns++;
        stats.totalCritical += result.critical;
        stats.totalHigh     += result.high;
        logger.warn(`⚠️  ${name}: ${result.critical} critical, ${result.high} high, ${result.moderate} moderate`);
      } else if (result.total > 0) {
        logger.log(`${name}: ${result.total} vulnerabilities (moderate/low בלבד)`);
      } else {
        logger.log(`${name}: נקי ✅`);
      }
    }

    // ── שלח התראת Telegram אם יש critical/high ─────────────────
    if (stats.totalCritical > 0 || stats.totalHigh > 0) {
      let msg = `🔴 <b>BOT-71 Dependency Scanner</b>\n`;
      msg += `נמצאו פגיעויות ב-${stats.withVulns} תיקיות!\n\n`;

      for (const r of results) {
        if (r.critical === 0 && r.high === 0) continue;
        msg += `<b>${r.dir}</b>: ${r.critical} critical, ${r.high} high\n`;
        for (const p of r.packages.slice(0, 5)) {
          msg += `  • ${p.pkg} (${p.severity})${p.via ? ': ' + p.via.slice(0, 50) : ''}\n`;
        }
      }

      msg += `\nהרץ: <code>npm audit fix</code> בתיקיות המסומנות`;

      await sendTelegram(msg);
      logger.warn('📨 התראת Telegram נשלחה');
    } else {
      logger.ok('✅ אין פגיעויות critical/high — הכל תקין');
    }

    // ── סיכום ──────────────────────────────────────────────────
    logger.ok(`📊 סיכום BOT-71:`);
    logger.ok(`  📁 נסרקו:           ${stats.scanned} תיקיות`);
    logger.ok(`  ⚠️  עם פגיעויות:    ${stats.withVulns}`);
    logger.ok(`  🔴 critical:        ${stats.totalCritical}`);
    logger.ok(`  🟠 high:            ${stats.totalHigh}`);
    logger.ok(`  💥 שגיאות סריקה:   ${stats.errors.length}`);

    logger.ok(`=== BOT-71 סיים בהצלחה — ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
    await sendTelegram(`❌ BOT-71 Dependency Scanner — שגיאה קריטית:\n${err.message}`);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) {
      await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
    }
  }
}

main();
