// bot26.test.mjs — בדיקות ל-BOT-26 Currency Bot
// הרץ: node bot26.test.mjs

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { fetchRates, SUPPORTED_CURRENCIES } from './bot26.mjs';

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

// ── טבלת exchange_rates ───────────────────────────────────────

await test('טבלת exchange_rates קיימת', async () => {
  const { error } = await supabase.from('exchange_rates').select('id').limit(1);
  if (error && !error.message.includes('0 rows')) throw new Error(error.message);
});

await test('עמודות exchange_rates תקינות (base, target, rate)', async () => {
  const { error } = await supabase
    .from('exchange_rates')
    .select('base, target, rate, recorded_at')
    .limit(1);
  if (error) throw new Error(error.message);
});

// ── RPC ──────────────────────────────────────────────────────

await test('RPC get_exchange_rate קיים', async () => {
  const { error } = await supabase.rpc('get_exchange_rate', { p_from: 'USD', p_to: 'EUR' });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC convert_price קיים', async () => {
  const { error } = await supabase.rpc('convert_price', {
    p_amount: 100, p_from: 'USD', p_to: 'EUR',
  });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC get_all_rates קיים', async () => {
  const { error } = await supabase.rpc('get_all_rates', { p_base: 'USD' });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

// ── SUPPORTED_CURRENCIES (unit) ───────────────────────────────

await test('SUPPORTED_CURRENCIES כולל ILS, EUR, GBP, JPY', () => {
  const required = ['ILS', 'EUR', 'GBP', 'JPY'];
  for (const c of required) {
    if (!SUPPORTED_CURRENCIES.includes(c)) throw new Error(`חסר ${c}`);
  }
});

await test('SUPPORTED_CURRENCIES לא כולל USD (הוא הבסיס)', () => {
  if (SUPPORTED_CURRENCIES.includes('USD')) throw new Error('USD לא אמור להיות ב-SUPPORTED_CURRENCIES');
});

// ── fetchRates (אינטגרציה עם API) ────────────────────────────

await test('fetchRates — מחזיר שערים תקינים מה-API', async () => {
  const rates = await fetchRates({ warn: () => {}, ok: () => {}, log: () => {} });
  if (!rates || typeof rates !== 'object') throw new Error('לא קיבלנו object');
  if (!rates['EUR'] || rates['EUR'] <= 0) throw new Error('שער EUR לא תקין');
  if (!rates['ILS'] || rates['ILS'] <= 0) throw new Error('שער ILS לא תקין');
});

await test('fetchRates — שערים בטווח הגיוני (USD→ILS בין 2 ל-10)', async () => {
  const rates = await fetchRates({ warn: () => {}, ok: () => {}, log: () => {} });
  const ils = rates['ILS'];
  if (ils < 2 || ils > 10) throw new Error(`שער ILS לא הגיוני: ${ils}`);
});

// ── DB round-trip ─────────────────────────────────────────────

await test('שמירה ושליפה של שער מה-DB', async () => {
  const testRate = {
    base:       'USD',
    target:     'TST',  // מטבע בדיקה מזויף
    rate:       3.7412,
    source:     'test',
    recorded_at: new Date().toISOString(),
  };

  const { error: ie } = await supabase
    .from('exchange_rates')
    .upsert([testRate], { onConflict: 'base,target' });
  if (ie) throw new Error(`INSERT נכשל: ${ie.message}`);

  const { data, error: se } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('base', 'USD')
    .eq('target', 'TST')
    .single();
  if (se) throw new Error(`SELECT נכשל: ${se.message}`);
  if (Math.abs(data.rate - 3.7412) > 0.0001) throw new Error(`שער שגוי: ${data.rate}`);

  // נקה
  await supabase.from('exchange_rates').delete().eq('target', 'TST');
});

// ── bots_log ─────────────────────────────────────────────────

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-26-TEST', status: 'running' })
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
  console.error('❌ הבדיקות הבאות נכשלו — הרץ migration-bot26.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-26 מוכן להרצה!');
  process.exit(0);
}
