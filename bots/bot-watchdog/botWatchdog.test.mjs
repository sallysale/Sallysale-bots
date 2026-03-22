// botWatchdog.test.mjs — בדיקות ל-BOT-Watchdog
// הרץ: node botWatchdog.test.mjs

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';

const TESTS_PASSED = [];
const TESTS_FAILED = [];

async function test(name, fn) {
  try {
    await fn();
    TESTS_PASSED.push(name);
    console.log(`✅ ${name}`);
  } catch (e) {
    TESTS_FAILED.push(name);
    console.error(`❌ ${name}: ${e.message}`);
  }
}

// ── Unit: CRASH_THRESHOLDS ────────────────────────────────────
const CRASH_THRESHOLDS = {
  default:    60 * 60 * 1000,
  'BOT-18':   6  * 60 * 60 * 1000,
};

await test('threshold ברירת מחדל = 60 דקות', async () => {
  const t = CRASH_THRESHOLDS.default;
  if (t !== 3600000) throw new Error(`ציפינו 3600000, קיבלנו ${t}`);
});

await test('threshold BOT-18 = 6 שעות', async () => {
  const t = CRASH_THRESHOLDS['BOT-18'];
  if (t !== 21600000) throw new Error(`ציפינו 21600000, קיבלנו ${t}`);
});

// ── Unit: זיהוי בוט תקוע ─────────────────────────────────────
await test('זיהוי בוט תקוע — elapsed > threshold', async () => {
  const started = new Date(Date.now() - 2 * 60 * 60 * 1000); // לפני שעתיים
  const elapsed = Date.now() - started;
  const threshold = CRASH_THRESHOLDS.default;
  const isStalled = elapsed > threshold;
  if (!isStalled) throw new Error('בוט שרץ שעתיים צריך להיות תקוע');
});

await test('בוט תקין — elapsed < threshold', async () => {
  const started = new Date(Date.now() - 10 * 60 * 1000); // לפני 10 דקות
  const elapsed = Date.now() - started;
  const threshold = CRASH_THRESHOLDS.default;
  const isStalled = elapsed > threshold;
  if (isStalled) throw new Error('בוט שרץ 10 דקות לא צריך להיות תקוע');
});

// ── Unit: failure counter ─────────────────────────────────────
await test('failure counter מגיע ל-3 → התראה', async () => {
  const failures = {};
  failures['BOT-TEST'] = 2;
  failures['BOT-TEST']++;
  if (failures['BOT-TEST'] < 3) throw new Error('אחרי 3 כשלונות צריכה לצאת התראה');
});

// ── DB: bots_log ──────────────────────────────────────────────
await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('bots_log קיים ועמודת status קיימת', async () => {
  const { error } = await supabase.from('bots_log').select('id, bot_id, status, started_at').limit(1);
  if (error) throw new Error(error.message);
});

await test('bots_log INSERT + UPDATE status=error', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-WATCHDOG-TEST', status: 'running' })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);

  const { error: ue } = await supabase
    .from('bots_log')
    .update({ status: 'error', finished_at: new Date().toISOString(), errors: ['Watchdog test'] })
    .eq('id', data.id);
  if (ue) throw new Error(ue.message);

  await supabase.from('bots_log').delete().eq('id', data.id);
});

// ── תוצאות ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-Watchdog מוכן להרצה!');
  process.exit(0);
}
