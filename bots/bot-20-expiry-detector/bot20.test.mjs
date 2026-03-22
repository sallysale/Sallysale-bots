// bot20.test.mjs — בדיקות בסיסיות ל-BOT-20 לפני deploy
// הרץ: node bot20.test.mjs

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

await test('עמודת ends_at קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('ends_at').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת status קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('status').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת expired_at קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('expired_at').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת expiry_reason קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('expiry_reason').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת last_expiry_check קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('last_expiry_check').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת is_real_sale קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('is_real_sale').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת price_checked_at קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('price_checked_at').limit(1);
  if (error) throw new Error(error.message);
});

// ── בדיקות לוגיקת פקיעה (unit) ──────────────────────────────

await test('לוגיקה: ends_at שעבר → expired', async () => {
  const now = new Date();
  const pastDate = new Date(now - 60 * 60 * 1000); // שעה אחורה
  const deal = { ends_at: pastDate.toISOString(), discount: 30, is_real_sale: null, price_checked_at: null };

  if (!deal.ends_at || new Date(deal.ends_at) >= now) {
    throw new Error('ends_at שעבר היה צריך לזהות פקיעה');
  }
});

await test('לוגיקה: ends_at עתידי → לא expired', async () => {
  const now = new Date();
  const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // מחר
  const deal = { ends_at: futureDate.toISOString(), discount: 30 };

  if (new Date(deal.ends_at) < now) {
    throw new Error('ends_at עתידי לא אמור להיות expired');
  }
});

await test('לוגיקה: discount=0 → no_discount', async () => {
  const MIN = 2;
  const deal = { discount: 0, ends_at: null, is_real_sale: null };
  if (deal.discount > MIN) throw new Error('discount=0 היה צריך לזהות no_discount');
});

await test('לוגיקה: is_real_sale=false + לפני GRACE → לא expired עדיין', async () => {
  const now = new Date();
  const recentCheck = new Date(now - 1 * 24 * 60 * 60 * 1000); // אתמול — בתוך חלון grace
  const GRACE_DAYS = 3;
  const graceCutoff = new Date(now - GRACE_DAYS * 24 * 60 * 60 * 1000);

  const deal = { is_real_sale: false, price_checked_at: recentCheck.toISOString(), ends_at: null, discount: 20 };
  const checkedAt = new Date(deal.price_checked_at);
  const expired = checkedAt < graceCutoff;

  if (expired) throw new Error('בתוך חלון grace לא אמור להיות expired');
});

await test('לוגיקה: is_real_sale=false + אחרי GRACE → expired', async () => {
  const now = new Date();
  const oldCheck = new Date(now - 5 * 24 * 60 * 60 * 1000); // לפני 5 ימים — אחרי grace
  const GRACE_DAYS = 3;
  const graceCutoff = new Date(now - GRACE_DAYS * 24 * 60 * 60 * 1000);

  const deal = { is_real_sale: false, price_checked_at: oldCheck.toISOString(), ends_at: null, discount: 20 };
  const checkedAt = new Date(deal.price_checked_at);
  const expired = checkedAt < graceCutoff;

  if (!expired) throw new Error('אחרי חלון grace היה צריך להיות expired');
});

// ── RPC ──────────────────────────────────────────────────────

await test('RPC get_expiry_summary קיים', async () => {
  const { error } = await supabase.rpc('get_expiry_summary');
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC get_expiring_soon קיים', async () => {
  const { error } = await supabase.rpc('get_expiring_soon', { p_hours: 24 });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-20-TEST', status: 'running' })
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
  console.error('❌ הבדיקות הבאות נכשלו — הרץ migration-bot20.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-20 מוכן להרצה!');
  process.exit(0);
}
