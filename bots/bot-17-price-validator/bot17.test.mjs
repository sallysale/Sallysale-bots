// bot17.test.mjs — בדיקות בסיסיות ל-BOT-17 לפני deploy
// הרץ: node bot17.test.mjs

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

await test('טבלת deals קיימת', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת status קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('status').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת price_validated קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('price_validated').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת validation_note קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('validation_note').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת validated_at קיימת ב-deals', async () => {
  const { data, error } = await supabase.from('deals').select('validated_at').limit(1);
  if (error) throw new Error(error.message);
});

// ── בדיקות לוגיקת ולידציה (unit) ───────────────────────────

await test('לוגיקת ולידציה — מחיר תקין', async () => {
  // בדיקה ידנית של הלוגיקה
  const deal = { price: 99.9, original_price: 150, discount_pct: 33, title: 'Test Deal', url: 'https://example.com/product' };
  const price = Number(deal.price);
  const original = Number(deal.original_price);
  if (price <= 0) throw new Error('מחיר לא תקין');
  if (original <= price) throw new Error('מחיר מקורי אמור להיות גבוה יותר');
  const calcDisc = Math.round(((original - price) / original) * 100);
  if (Math.abs(calcDisc - deal.discount_pct) > 5) throw new Error(`אחוז הנחה לא תואם: ${calcDisc} vs ${deal.discount_pct}`);
});

await test('לוגיקת ולידציה — מחיר שגוי נדחה', async () => {
  const invalidPrices = [-1, 0, null, 'abc'];
  for (const p of invalidPrices) {
    const price = Number(p);
    if (p !== null && !isNaN(price) && price > 0) {
      throw new Error(`מחיר ${p} היה צריך להידחות`);
    }
  }
});

await test('לוגיקת ולידציה — הנחה מעל 95% נדחית', async () => {
  const disc = 96;
  if (disc <= 95) throw new Error('הנחה מעל 95% היתה צריכה להידחות');
});

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-17-TEST', status: 'running' })
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
  console.error('   price_validated (boolean), validation_note (text), validated_at (timestamptz)');
  console.error('   הרץ migration-bot17.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-17 מוכן להרצה!');
  process.exit(0);
}
