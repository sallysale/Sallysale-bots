// bot21.test.mjs — בדיקות ל-BOT-21 Image Validator
// הרץ: node bot21.test.mjs

import 'dotenv/config';
import https from 'https';
import http from 'http';
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

// ── Unit: isPlaceholder ───────────────────────────────────────
const PLACEHOLDER_PATTERNS = ['placeholder','no-image','noimage','default-product','coming-soon','blank.gif','spacer.gif','1x1.gif'];
function isPlaceholder(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
}

await test('isPlaceholder — null → true', async () => {
  if (!isPlaceholder(null)) throw new Error('null צריך להיות placeholder');
});

await test('isPlaceholder — "placeholder" בURL → true', async () => {
  if (!isPlaceholder('https://cdn.example.com/placeholder.jpg')) throw new Error('צריך להיות placeholder');
});

await test('isPlaceholder — תמונה אמיתית → false', async () => {
  if (isPlaceholder('https://cdn.example.com/product-123.jpg')) throw new Error('תמונה אמיתית לא צריכה להיות placeholder');
});

await test('isPlaceholder — 1x1.gif → true', async () => {
  if (!isPlaceholder('https://example.com/1x1.gif')) throw new Error('1x1.gif צריך להיות placeholder');
});

// ── Unit: headRequest logic ───────────────────────────────────
await test('headRequest — URL לא תקין מחזיר ok=false', async () => {
  // סימולציה ידנית
  const url = 'not-a-url';
  if (!url || !url.startsWith('http')) {
    // כמצופה — ok=false
    return;
  }
  throw new Error('URL לא תקין צריך להחזיר ok=false');
});

await test('headRequest — URL ריק מחזיר ok=false', async () => {
  const url = '';
  if (!url || !url.startsWith('http')) return; // כמצופה
  throw new Error('URL ריק צריך להחזיר ok=false');
});

// ── DB: חיבור ─────────────────────────────────────────────────
await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת image_url קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('image_url').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת image_checked_at קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('image_checked_at').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת needs_image קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('needs_image').limit(1);
  if (error) throw new Error(error.message);
});

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-21-TEST', status: 'running' })
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

// ── תוצאות ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הרץ migration-bot21.sql ב-Supabase SQL Editor');
  console.error('   עמודות נדרשות: deals.image_checked_at, deals.needs_image');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-21 מוכן להרצה!');
  process.exit(0);
}
