// bot18.test.mjs
// בדיקות בסיסיות ל-BOT-18 לפני deploy
// הרץ: node bot18.test.mjs

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

// ── בדיקות ──────────────────────────────────────────────────

await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('טבלת price_history קיימת', async () => {
  const { error } = await supabase.from('price_history').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('טבלת bots_log קיימת', async () => {
  const { error } = await supabase.from('bots_log').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת is_real_sale קיימת בdeals', async () => {
  const { data, error } = await supabase.from('deals').select('is_real_sale').limit(1);
  if (error) throw new Error(error.message);
});

await test('RPC record_price_snapshot קיים', async () => {
  // חפש כל דיל (לא רק published) — בדיקת קיום ה-RPC בלבד
  const { data: deal } = await supabase
    .from('deals')
    .select('id, price')
    .not('price', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!deal) {
    // אין דילים בכלל — בדוק רק שה-RPC קיים ע"י קריאה עם id פיקטיבי
    const { error } = await supabase.rpc('record_price_snapshot', {
      p_deal_id:  '00000000-0000-0000-0000-000000000000',
      p_price:    99,
      p_currency: 'ILS',
      p_source:   'test',
    });
    // שגיאת FK מקובלת — מוכיחה שה-RPC קיים
    if (error && error.message.includes('function') && error.message.includes('does not exist')) {
      throw new Error(error.message);
    }
    return;
  }

  const { error } = await supabase.rpc('record_price_snapshot', {
    p_deal_id:  deal.id,
    p_price:    deal.price,
    p_currency: 'ILS',
    p_source:   'test',
  });
  if (error) throw new Error(error.message);
});

await test('RPC analyze_price_history קיים', async () => {
  const { data: deal } = await supabase
    .from('deals')
    .select('id')
    .limit(1)
    .maybeSingle();

  // קרא ל-RPC — גם עם id פיקטיבי יחזיר null ולא שגיאה אם קיים
  const targetId = deal ? deal.id : '00000000-0000-0000-0000-000000000000';
  const { error } = await supabase.rpc('analyze_price_history', { p_deal_id: targetId });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC get_price_chart קיים', async () => {
  const { data: deal } = await supabase
    .from('deals')
    .select('id')
    .limit(1)
    .maybeSingle();

  const targetId = deal ? deal.id : '00000000-0000-0000-0000-000000000000';
  const { error } = await supabase.rpc('get_price_chart', { p_deal_id: targetId, p_days: 30 });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'TEST', status: 'running' })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);

  const { error: ue } = await supabase
    .from('bots_log')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', data.id);
  if (ue) throw new Error(ue.message);

  // נקה test row
  await supabase.from('bots_log').delete().eq('id', data.id);
});

// ── תוצאות ──────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);
if (TESTS_FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו — הרץ את migration-bot18.sql לפני שתמשיך:');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-18 מוכן להרצה!');
  process.exit(0);
}
