// bot30.test.mjs — בדיקות ל-BOT-30 Anti-Abuse
// הרץ: node bot30.test.mjs

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

// ── Unit: detectThirdPartyAffiliate ──────────────────────────
const PATTERNS = [
  { pattern: /amzn\.to|amazon\.[a-z]+\/.*tag=/i,               network: 'amazon' },
  { pattern: /click\.linksynergy\.com/i,                        network: 'rakuten' },
  { pattern: /go\.tradedoubler\.com/i,                          network: 'tradedoubler' },
  { pattern: /cj\.com\/click|dpbolvw\.net/i,                    network: 'cj' },
  { pattern: /impact\.com\/c\/|impactradius\.com/i,             network: 'impact' },
  { pattern: /awin1\.com|awinmid\.com/i,                        network: 'awin' },
  { pattern: /shareasale\.com\/r\./i,                           network: 'shareasale' },
  { pattern: /admitad\.com\/g\/|epn\.bz/i,                      network: 'admitad' },
  { pattern: /[?&]ref=[a-zA-Z0-9_-]{10,}|[?&]affiliate_id=/i,  network: 'unknown' },
];

function detectThirdPartyAffiliate(url) {
  if (!url) return null;
  for (const { pattern, network } of PATTERNS) {
    if (pattern.test(url)) return { network };
  }
  return null;
}

await test('זיהוי Amazon Associates', async () => {
  const r = detectThirdPartyAffiliate('https://www.amazon.com/dp/B08X5J4V4G?tag=my-associate-20');
  if (!r || r.network !== 'amazon') throw new Error('Amazon Associates לא זוהה');
});

await test('זיהוי CJ Affiliate', async () => {
  const r = detectThirdPartyAffiliate('https://www.dpbolvw.net/click-12345-13791050');
  if (!r || r.network !== 'cj') throw new Error('CJ לא זוהה');
});

await test('זיהוי AWIN', async () => {
  const r = detectThirdPartyAffiliate('https://www.awin1.com/cread.php?awinmid=12345&awinaffid=67890');
  if (!r || r.network !== 'awin') throw new Error('AWIN לא זוהה');
});

await test('זיהוי Tradedoubler', async () => {
  const r = detectThirdPartyAffiliate('https://go.tradedoubler.com/click?a=123456&p=789');
  if (!r || r.network !== 'tradedoubler') throw new Error('Tradedoubler לא זוהה');
});

await test('קישור נקי — לא מזוהה', async () => {
  const r = detectThirdPartyAffiliate('https://www.zara.com/il/he/trousers-p12345678.html');
  if (r !== null) throw new Error('קישור נקי לא צריך להיות מזוהה');
});

await test('URL ריק → null', async () => {
  const r = detectThirdPartyAffiliate(null);
  if (r !== null) throw new Error('null צריך להחזיר null');
});

// ── DB: טבלאות ───────────────────────────────────────────────
await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('טבלת affiliate_replacements קיימת', async () => {
  const { error } = await supabase.from('affiliate_replacements').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('affiliate_replacements — INSERT ו-DELETE', async () => {
  const { data, error: ie } = await supabase
    .from('affiliate_replacements')
    .insert({
      deal_id:          'TEST-DEAL-30',
      original_url:     'https://go.tradedoubler.com/click?a=1',
      replacement_url:  'https://sallysale.com/go/TEST-DEAL-30',
      detected_network: 'tradedoubler',
      detection_label:  'Tradedoubler',
      replaced_at:      new Date().toISOString(),
    })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);
  await supabase.from('affiliate_replacements').delete().eq('id', data.id);
});

// ── תוצאות ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הרץ migration-bot30.sql ב-Supabase SQL Editor');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-30 מוכן להרצה!');
  process.exit(0);
}
