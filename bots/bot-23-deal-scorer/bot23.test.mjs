// bot23.test.mjs — בדיקות ל-BOT-23 Deal Scorer
// הרץ: node bot23.test.mjs

import 'dotenv/config';
import supabase from '../shared/supabaseClient.mjs';
import { computeScore } from './bot23.mjs';

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

// ── עמודות ────────────────────────────────────────────────────

await test('עמודת score קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('score').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת score_breakdown קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('score_breakdown').limit(1);
  if (error) throw new Error(error.message);
});

await test('עמודת last_scored_at קיימת ב-deals', async () => {
  const { error } = await supabase.from('deals').select('last_scored_at').limit(1);
  if (error) throw new Error(error.message);
});

// ── RPC ──────────────────────────────────────────────────────

await test('RPC batch_score_deals קיים', async () => {
  const { error } = await supabase.rpc('batch_score_deals', { p_limit: 1 });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC get_top_deals קיים', async () => {
  const { error } = await supabase.rpc('get_top_deals', { p_limit: 1 });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

await test('RPC compute_deal_score קיים', async () => {
  const { error } = await supabase.rpc('compute_deal_score', {
    p_discount: 30, p_clicks: 100, p_saves: 10,
    p_created_at: new Date().toISOString(),
  });
  if (error && error.message.includes('does not exist')) throw new Error(error.message);
});

// ── computeScore (unit) ───────────────────────────────────────

await test('computeScore: הנחה גבוהה → ציון הנחה גבוה', () => {
  const r = computeScore({ discount: 50, clicks: 0, saves: 0, rarityDays: 0 });
  if (r.discount < 39) throw new Error(`discount_score נמוך: ${r.discount}`);
});

await test('computeScore: הנחה=0 → discount_score=0', () => {
  const r = computeScore({ discount: 0, clicks: 0, saves: 0 });
  if (r.discount !== 0) throw new Error(`קיבלנו: ${r.discount}`);
});

await test('computeScore: is_real_sale=true → +5 בונוס', () => {
  const without = computeScore({ discount: 30, clicks: 0, saves: 0, rarityDays: 7 });
  const with_   = computeScore({ discount: 30, clicks: 0, saves: 0, rarityDays: 7, isRealSale: true });
  const diff = with_.total - without.total;
  if (Math.abs(diff - 5) > 0.1) throw new Error(`בונוס was ${diff}, expected ~5`);
});

await test('computeScore: דיל ישן (168h) → freshness נמוך (מתחת ל-3.5)', () => {
  const oldDate = new Date(Date.now() - 168 * 3600 * 1000).toISOString();
  const r = computeScore({ discount: 0, clicks: 0, saves: 0, createdAt: oldDate });
  // 168h = 7 ימים: freshness = 15 * 0.5^(168/72) ≈ 2.98
  if (r.freshness > 3.5) throw new Error(`freshness היה צריך להיות נמוך, קיבלנו: ${r.freshness}`);
});

await test('computeScore: דיל חדש → freshness קרוב ל-15', () => {
  const r = computeScore({ discount: 0, clicks: 0, saves: 0, createdAt: new Date().toISOString() });
  if (r.freshness < 14) throw new Error(`freshness היה צריך להיות קרוב ל-15, קיבלנו: ${r.freshness}`);
});

await test('computeScore: total לא עולה על 100', () => {
  const r = computeScore({ discount: 50, clicks: 500, saves: 200, rarityDays: 14, isRealSale: true, createdAt: new Date().toISOString() });
  if (r.total > 100) throw new Error(`total עלה על 100: ${r.total}`);
});

await test('computeScore: נדירות 14 ימים → rarity=25', () => {
  const r = computeScore({ discount: 0, clicks: 0, saves: 0, rarityDays: 14 });
  if (Math.abs(r.rarity - 25) > 0.5) throw new Error(`rarity was ${r.rarity}, expected ~25`);
});

// ── bots_log ─────────────────────────────────────────────────

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-23-TEST', status: 'running' })
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
  console.error('❌ הבדיקות הבאות נכשלו — הרץ migration-bot23.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-23 מוכן להרצה!');
  process.exit(0);
}
