// ════════════════════════════════════════════════════════════
// sallysale-bots/index.js — Bot Coordinator (in-process)
//
// מריץ את כל הבוטים ישירות כ-ES modules באותו process.
// כך כל בוט יורש את process.env אוטומטית — ללא child processes.
//
// סדר הרצה:
//   שכבה 2 (אימות):  BOT-17, 18, 19, 20, 22, 23
//   שכבה 3 (ניהול):  BOT-26, 27, 24, 25, 29
//   שכבה 1 (איסוף):  BOT-07, 09, 10
//
// הרצה: node index.js              (כל הבוטים)
//        node index.js BOT-07 BOT-24 (בוטים ספציפיים)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── בדיקת סביבה ───────────────────────────────────────────
const supaUrl = process.env.SUPABASE_URL || '';
console.log('ENV CHECK — SUPA keys:', Object.keys(process.env).filter(k => k.includes('SUPA')));
console.log('ENV CHECK — SUPABASE_URL prefix:', supaUrl.slice(0, 4) || '(empty)');

const BOTS = [
  // שכבה 2 — אימות
  { id: 'BOT-17', entry: 'bots/bot-17-price-validator/bot17.mjs'  },
  { id: 'BOT-18', entry: 'bots/bot-18-price-history/bot18.mjs'    },
  { id: 'BOT-19', entry: 'bots/bot-19-link-validator/bot19.mjs'   },
  { id: 'BOT-20', entry: 'bots/bot-20-expiry-detector/bot20.mjs'  },
  { id: 'BOT-22', entry: 'bots/bot-22-dedup-engine/bot22.mjs'     },
  { id: 'BOT-23', entry: 'bots/bot-23-deal-scorer/bot23.mjs'      },
  // שכבה 3 — ניהול
  { id: 'BOT-26', entry: 'bots/bot-26-currency-bot/bot26.mjs'     },
  { id: 'BOT-27', entry: 'bots/bot-27-geo-pricing/bot27.mjs'      },
  { id: 'BOT-24', entry: 'bots/bot-24-auto-categorizer/bot24.mjs' },
  { id: 'BOT-25', entry: 'bots/bot-25-auto-translator/bot25.mjs'  },
  { id: 'BOT-29', entry: 'bots/bot-29-affiliate-sorter/bot29.mjs' },
  // שכבה 1 — איסוף
  { id: 'BOT-07', entry: 'bots/bot-07-ebay-epn/bot07.mjs'         },
  { id: 'BOT-09', entry: 'bots/bot-09-scraping-tier1/bot09.mjs'   },
  { id: 'BOT-10', entry: 'bots/bot-10-scraping-tier2/bot10.mjs'   },
];

try {
  const targets = process.argv.slice(2);
  const toRun   = targets.length > 0
    ? BOTS.filter(b => targets.includes(b.id))
    : BOTS;

  if (toRun.length === 0) {
    console.error(`❌ לא נמצאו בוטים: ${targets.join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🚀 SallySale Bots — מריץ ${toRun.length} בוטים (in-process)`);
  console.log('═'.repeat(50));

  let passed = 0;
  let failed = 0;

  for (const bot of toRun) {
    const fullPath = path.join(__dirname, bot.entry);

    if (!existsSync(fullPath)) {
      console.warn(`⚠️  ${bot.id}: קובץ לא נמצא — ${bot.entry}`);
      failed++;
      continue;
    }

    console.log(`\n▶  ${bot.id}...`);
    const start = Date.now();

    const originalArgv1 = process.argv[1];
    process.argv[1] = fullPath;

    try {
      await import(pathToFileURL(fullPath).href);
      console.log(`✅  ${bot.id} — ${((Date.now() - start) / 1000).toFixed(1)}s`);
      passed++;
    } catch (err) {
      console.error(`❌  ${bot.id} — שגיאה: ${err.message}`);
      console.error(`    stack: ${err.stack?.split('\n')[1]?.trim() || 'n/a'}`);
      failed++;
    } finally {
      process.argv[1] = originalArgv1;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 ${passed} הצליחו, ${failed} נכשלו`);
  if (failed > 0) process.exit(1);

} catch (err) {
  console.error('❌ FATAL — קריסה כללית ב-coordinator:');
  console.error('   message:', err.message);
  console.error('   stack:',   err.stack);
  process.exit(1);
}
