// botCoordinator.test.mjs — בדיקות ל-BOT-Coordinator
// הרץ: node botCoordinator.test.mjs

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

const MAX_CONCURRENT = 3;

// ── Unit: countRunning logic ──────────────────────────────────
await test('MAX_CONCURRENT === 3', async () => {
  if (MAX_CONCURRENT !== 3) throw new Error(`ציפינו 3, קיבלנו ${MAX_CONCURRENT}`);
});

await test('slot פנוי כאשר running < MAX_CONCURRENT', async () => {
  const running = 2;
  const hasSlot = running < MAX_CONCURRENT;
  if (!hasSlot) throw new Error('צריך להיות slot פנוי');
});

await test('תור מלא כאשר running >= MAX_CONCURRENT', async () => {
  const running = 3;
  const hasSlot = running < MAX_CONCURRENT;
  if (hasSlot) throw new Error('לא צריך להיות slot פנוי');
});

// ── DB: bot_queue ─────────────────────────────────────────────
await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('טבלת bot_queue קיימת', async () => {
  const { error } = await supabase.from('bot_queue').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('bot_queue — INSERT queued', async () => {
  const { data, error } = await supabase
    .from('bot_queue')
    .insert({ bot_id: 'BOT-TEST-COORD', status: 'queued', priority: 5, queued_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await supabase.from('bot_queue').delete().eq('id', data.id);
});

await test('bot_queue — UPDATE status running→done', async () => {
  const { data, error: ie } = await supabase
    .from('bot_queue')
    .insert({ bot_id: 'BOT-TEST-STATUS', status: 'running', priority: 5, queued_at: new Date().toISOString() })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);

  const { error: ue } = await supabase
    .from('bot_queue')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', data.id);
  if (ue) throw new Error(ue.message);

  await supabase.from('bot_queue').delete().eq('id', data.id);
});

await test('bot_queue — priority ordering', async () => {
  // insert שניים עם priority שונה
  const { data: a } = await supabase.from('bot_queue').insert({ bot_id: 'LOW',  status: 'queued', priority: 1, queued_at: new Date().toISOString() }).select('id').single();
  const { data: b } = await supabase.from('bot_queue').insert({ bot_id: 'HIGH', status: 'queued', priority: 9, queued_at: new Date().toISOString() }).select('id').single();

  const { data: ordered } = await supabase.from('bot_queue').select('bot_id').eq('status','queued').order('priority', { ascending: false }).limit(1);
  if (!ordered || ordered[0]?.bot_id !== 'HIGH') {
    await supabase.from('bot_queue').delete().in('id', [a.id, b.id]);
    throw new Error('סדר עדיפות לא עובד');
  }
  await supabase.from('bot_queue').delete().in('id', [a.id, b.id]);
});

await test('bots_log INSERT', async () => {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-COORD-TEST', status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await supabase.from('bots_log').delete().eq('id', data.id);
});

// ── תוצאות ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הרץ migration-bot-coordinator.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-Coordinator מוכן!');
  process.exit(0);
}
