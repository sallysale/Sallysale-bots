// bot22.test.mjs — בדיקות ל-BOT-22 Dedup Engine
// הרץ: node bot22.test.mjs

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { extractAsin, tokenize, jaccardSimilarity, dealSimilarity } from './bot22.mjs';

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

// ── חיבור DB ─────────────────────────────────────────────────

await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

// ── עמודות חדשות ─────────────────────────────────────────────

await test('עמודת asin קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('asin').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת dedup_status קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('dedup_status').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת dedup_group_id קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('dedup_group_id').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת is_canonical קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('is_canonical').limit(1);
  if (error) throw new Error(error.message);
});

await test('טבלת dedup_queue קיימת', async () => {
  const { error } = await supabase.from('dedup_queue').select('id').limit(1);
  if (error && !error.message.includes('0 rows')) throw new Error(error.message);
});

// ── RPC ──────────────────────────────────────────────────────

await test('RPC get_dedup_pending_count קיים', async () => {
  const { error } = await supabase.rpc('get_dedup_pending_count');
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC get_dedup_summary קיים', async () => {
  const { error } = await supabase.rpc('get_dedup_summary');
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

// ── extractAsin (unit) ───────────────────────────────────────

await test('extractAsin: URL תקין עם /dp/', () => {
  const url = 'https://www.amazon.com/dp/B09G9FPHY6?ref=foo';
  const asin = extractAsin(url);
  if (asin !== 'B09G9FPHY6') throw new Error(`קיבלנו: ${asin}`);
});

await test('extractAsin: URL שאינו אמזון → null', () => {
  const asin = extractAsin('https://www.ebay.com/itm/123456789');
  if (asin !== null) throw new Error(`היה צריך null, קיבלנו: ${asin}`);
});

await test('extractAsin: null → null', () => {
  if (extractAsin(null) !== null) throw new Error('לא החזיר null');
});

// ── tokenize (unit) ──────────────────────────────────────────

await test('tokenize: מנרמל ומוריד stop words', () => {
  const tokens = tokenize('Buy the new Samsung Galaxy S24 Ultra');
  if (!tokens.has('samsung')) throw new Error('חסר samsung');
  if (!tokens.has('galaxy'))  throw new Error('חסר galaxy');
  if (tokens.has('the'))      throw new Error('stop word "the" לא הוסר');
  if (tokens.has('buy'))      throw new Error('stop word "buy" לא הוסר');
});

// ── jaccardSimilarity (unit) ─────────────────────────────────

await test('jaccardSimilarity: כותרות זהות → 100', () => {
  const s = new Set(['samsung', 'galaxy', 's24']);
  const score = jaccardSimilarity(s, new Set(['samsung', 'galaxy', 's24']));
  if (score !== 100) throw new Error(`קיבלנו: ${score}`);
});

await test('jaccardSimilarity: כותרות שונות לחלוטין → 0', () => {
  const score = jaccardSimilarity(new Set(['iphone', '15', 'pro']), new Set(['dyson', 'vacuum', 'v15']));
  if (score !== 0) throw new Error(`קיבלנו: ${score}`);
});

await test('jaccardSimilarity: כותרות דומות → גבוה', () => {
  const a = tokenize('Samsung Galaxy S24 Ultra 256GB Black');
  const b = tokenize('Samsung Galaxy S24 Ultra 256GB - Black Color');
  const score = jaccardSimilarity(a, b);
  if (score < 70) throw new Error(`ציון נמוך מדי: ${score}`);
});

await test('dealSimilarity: אותה brand מוסיף bonus', () => {
  const dealA = { title_en: 'Nike Air Max 90 White Size 42', brand: 'Nike' };
  const dealB = { title_en: 'Nike Air Max 90 White Mens 42', brand: 'Nike' };
  const dealC = { title_en: 'Nike Air Max 90 White Mens 42', brand: 'Adidas' };
  const scoreWithBrand    = dealSimilarity(dealA, dealB);
  const scoreWithoutBrand = dealSimilarity(dealA, dealC);
  if (scoreWithBrand <= scoreWithoutBrand) {
    throw new Error(`עם brand (${scoreWithBrand}) היה צריך להיות גבוה יותר מבלי (${scoreWithoutBrand})`);
  }
});

// ── bots_log ─────────────────────────────────────────────────

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-22-TEST', status: 'running' })
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
  console.error('❌ הבדיקות הבאות נכשלו — הרץ migration-bot22.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-22 מוכן להרצה!');
  process.exit(0);
}
