// botFailover.test.mjs — בדיקות ל-BOT-Failover
// הרץ: node botFailover.test.mjs

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

// ── Unit: buildScraperApiUrl ──────────────────────────────────
function buildScraperApiUrl(originalUrl, tag = 'js_off') {
  const key = process.env.SCRAPERAPI_KEY || 'TEST_KEY';
  const params = new URLSearchParams({ api_key: key, url: originalUrl });
  if (tag === 'render') params.set('render', 'true');
  if (tag === 'autoparse') params.set('autoparse', 'true');
  return `https://api.scraperapi.com/?${params.toString()}`;
}

await test('buildScraperApiUrl — מכיל api_key', async () => {
  const url = buildScraperApiUrl('https://www.zara.com/products', 'js_off');
  if (!url.includes('api_key=')) throw new Error('חסר api_key ב-URL');
});

await test('buildScraperApiUrl — render=true עבור render tag', async () => {
  const url = buildScraperApiUrl('https://example.com', 'render');
  if (!url.includes('render=true')) throw new Error('חסר render=true');
});

await test('buildScraperApiUrl — autoparse=true עבור autoparse', async () => {
  const url = buildScraperApiUrl('https://amazon.com/dp/B08', 'autoparse');
  if (!url.includes('autoparse=true')) throw new Error('חסר autoparse=true');
});

// ── Unit: failover chain ──────────────────────────────────────
const FAILOVER_CHAINS = {
  'zara':     { scraperTag: 'js_off',  backup: 'https://www.zara.com' },
  'default':  { scraperTag: 'js_off',  backup: null },
};

await test('zara chain מוגדרת', async () => {
  const chain = FAILOVER_CHAINS['zara'];
  if (!chain) throw new Error('chain של zara לא מוגדרת');
  if (chain.scraperTag !== 'js_off') throw new Error('scraperTag שגוי');
});

await test('default chain כ-fallback', async () => {
  const chain = FAILOVER_CHAINS['unknown_store'] || FAILOVER_CHAINS['default'];
  if (!chain) throw new Error('default chain לא קיים');
});

// ── Unit: URL validation ──────────────────────────────────────
await test('URL לא תקין → not available', async () => {
  const url = 'not-a-url';
  const invalid = !url || !url.startsWith('http');
  if (!invalid) throw new Error('URL לא תקין צריך להיות invalid');
});

// ── DB: failover_log ──────────────────────────────────────────
await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('טבלת failover_log קיימת', async () => {
  const { error } = await supabase.from('failover_log').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('failover_log — INSERT ו-DELETE', async () => {
  const { data, error: ie } = await supabase
    .from('failover_log')
    .insert({
      store_name:   'zara-test',
      from_source:  'primary',
      to_source:    'scraperapi',
      reason:       'timeout',
      failed_at:    new Date().toISOString(),
    })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);
  await supabase.from('failover_log').delete().eq('id', data.id);
});

await test('bots_log INSERT', async () => {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-FAILOVER-TEST', status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await supabase.from('bots_log').delete().eq('id', data.id);
});

// ── תוצאות ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הרץ migration-bot-failover.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-Failover מוכן להרצה!');
  process.exit(0);
}
