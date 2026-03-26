// bot27.test.mjs — בדיקות ל-BOT-27 Geo-Pricing
// הרץ: node bot27.test.mjs

import supabase from './shared/supabaseClient.mjs';
import { convertPrice, loadRates } from './bot27.mjs';

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

// ── טבלת country_currency_map ─────────────────────────────────

await test('טבלת country_currency_map קיימת', async () => {
  const { error } = await supabase.from('country_currency_map').select('country_code').limit(1);
  if (error) throw new Error(error.message);
});

await test('country_currency_map: IL→ILS, US→USD, GB→GBP', async () => {
  const { data, error } = await supabase
    .from('country_currency_map')
    .select('country_code, currency')
    .in('country_code', ['IL', 'US', 'GB']);
  if (error) throw new Error(error.message);
  const map = Object.fromEntries(data.map(r => [r.country_code, r.currency]));
  if (map['IL'] !== 'ILS') throw new Error(`IL → ${map['IL']}, expected ILS`);
  if (map['US'] !== 'USD') throw new Error(`US → ${map['US']}, expected USD`);
  if (map['GB'] !== 'GBP') throw new Error(`GB → ${map['GB']}, expected GBP`);
});

// ── עמודות geo_prices על deals ───────────────────────────────

await test('עמודת geo_prices קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('geo_prices').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת geo_prices_at קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('geo_prices_at').limit(1);
  if (error) throw new Error(error.message);
});

// ── RPC ──────────────────────────────────────────────────────

await test('RPC get_local_price קיים', async () => {
  // test עם deal_id מזויף — מצפים ל-error:deal not found, לא ל-function does not exist
  const { data, error } = await supabase.rpc('get_local_price', {
    p_deal_id: 'non-existent-deal-id-test',
    p_country: 'US',
  });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
  // אם מחזיר error: deal not found → בסדר
});

await test('RPC get_deal_prices_all_currencies קיים', async () => {
  const { error } = await supabase.rpc('get_deal_prices_all_currencies', {
    p_deal_id: 'non-existent-deal-id-test',
  });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

// ── convertPrice (unit) ───────────────────────────────────────

await test('convertPrice: אותו מטבע → אותו מחיר', () => {
  const rates = new Map([['EUR', 0.92]]);
  const result = convertPrice(100, 'USD', 'USD', rates);
  if (result !== 100) throw new Error(`קיבלנו: ${result}`);
});

await test('convertPrice: USD → EUR', () => {
  const rates = new Map([['EUR', 0.92]]);
  const result = convertPrice(100, 'USD', 'EUR', rates);
  if (Math.abs(result - 92) > 0.01) throw new Error(`קיבלנו: ${result}, expected ~92`);
});

await test('convertPrice: EUR → ILS (דרך USD)', () => {
  const rates = new Map([['EUR', 0.92], ['ILS', 3.7]]);
  // 100 EUR / 0.92 = 108.7 USD × 3.7 = 402.17 ILS
  const result = convertPrice(100, 'EUR', 'ILS', rates);
  if (!result || result < 390 || result > 420) throw new Error(`קיבלנו: ${result}`);
});

await test('convertPrice: מטבע לא ידוע → null', () => {
  const rates = new Map([['EUR', 0.92]]);
  const result = convertPrice(100, 'USD', 'XYZ', rates);
  if (result !== null) throw new Error(`היה צריך null, קיבלנו: ${result}`);
});

await test('convertPrice: price=0 → null', () => {
  const rates = new Map([['EUR', 0.92]]);
  const result = convertPrice(0, 'USD', 'EUR', rates);
  if (result !== null) throw new Error(`price=0 היה צריך null`);
});

// ── loadRates (אינטגרציה) ─────────────────────────────────────

await test('loadRates — מחזיר Map עם שערים מה-DB (דורש BOT-26)', async () => {
  const logger = { ok: () => {}, warn: () => {}, err: () => {} };
  try {
    const rates = await loadRates(logger);
    if (!(rates instanceof Map)) throw new Error('לא קיבלנו Map');
    if (rates.size === 0) throw new Error('אין שערים — הרץ BOT-26 קודם');
    if (!rates.has('EUR')) throw new Error('חסר EUR בשערים');
  } catch (e) {
    if (e.message.includes('BOT-26')) {
      console.warn('  ⚠️  BOT-26 טרם הורץ — בדיקה זו תעבור אחרי הרצת BOT-26');
      return; // לא כישלון — תלוי בסדר הרצה
    }
    throw e;
  }
});

// ── bots_log ─────────────────────────────────────────────────

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-27-TEST', status: 'running' })
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
  console.error('❌ הבדיקות הבאות נכשלו — הרץ migration-bot27.sql + migration-bot27-deals-geo.sql');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-27 מוכן להרצה!');
  process.exit(0);
}
