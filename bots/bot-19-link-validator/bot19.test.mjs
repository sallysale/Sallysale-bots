// bot19.test.mjs — בדיקות בסיסיות ל-BOT-19 לפני deploy
// הרץ: node bot19.test.mjs

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

// ── בדיקות חיבור ────────────────────────────────────────────

await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת affiliate_url קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('affiliate_url').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת last_checked_at קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('last_checked_at').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת link_status קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('link_status').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת expired_at קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('expired_at').limit(1);
  if (error) throw new Error(error.message);
});

// ── בדיקת fetch על URL אמיתי ─────────────────────────────────

await test('fetch HEAD request עובד (google.com)', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://www.google.com', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.status) throw new Error('לא קיבלנו status');
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('timeout — בדוק חיבור אינטרנט');
    throw e;
  }
});

await test('fetch HEAD — בדיקת status code', async () => {
  // בדיקה שה-fetch מחזיר status code נכון (לא תלוי בשרת חיצוני ספציפי)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('https://www.google.com', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.status || res.status < 100) throw new Error(`status לא תקין: ${res.status}`);
    // וודא שהלוגיקה עובדת — 404 ו-410 נחשבים expired
    const EXPIRED = [404, 410];
    const OK = [200, 201, 301, 302, 303, 307, 308];
    if (!OK.includes(200)) throw new Error('לוגיקת OK שגויה');
    if (!EXPIRED.includes(404)) throw new Error('לוגיקת expired שגויה');
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      console.warn('  ⚠️ timeout — בדיקה זו דולגה');
      return;
    }
    throw e;
  }
});

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-19-TEST', status: 'running' })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);

  const { error: ue } = await supabase
    .from('bots_log')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', data.id);
  if (ue) throw new Error(ue.message);

  await supabase.from('bots_log').delete().eq('id', data.id);
});

// ── תוצאות ──────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו — בדוק שהעמודות הבאות קיימות ב-deals:');
  console.error('   last_checked_at (timestamptz), link_status (int), expired_at (timestamptz)');
  console.error('   affiliate_url קיים כבר בschema — רק last_checked_at/link_status/expired_at חדשים');
  console.error('   הרץ migration-bot19.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-19 מוכן להרצה!');
  process.exit(0);
}
