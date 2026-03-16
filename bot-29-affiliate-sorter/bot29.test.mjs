// bot29.test.mjs — בדיקות ל-BOT-29 Affiliate Sorter
// הרץ: node bot29.test.mjs
// 10 בדיקות unit — ללא קריאות DB אמיתיות

import {
  getBestNetwork,
  buildSkimlinksUrl,
  buildTradeDoublerUrl,
  buildAwinUrl,
  shouldUpdateAffiliate,
  parseNetworkFromSource,
} from './bot29.mjs';

const TESTS_PASSED = [];
const TESTS_FAILED = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

// ── 1. getBestNetwork ────────────────────────────────────

await test('getBestNetwork: חנות hm ← tradedoubler עם rate=0.10', () => {
  const result = getBestNetwork('hm', 'tradedoubler');
  assert(result.network === 'tradedoubler', `network היה: ${result.network}`);
  assert(Math.abs(result.rate - 0.10) < 0.001, `rate היה: ${result.rate}`);
});

await test('getBestNetwork: zalando ← tradedoubler מנצח ebay_epn (0.12 > 0.04)', () => {
  const result = getBestNetwork('zalando', 'ebay_epn');
  assert(result.network === 'tradedoubler', `network היה: ${result.network}, ציפינו tradedoubler`);
  assert(result.rate > 0.04, `rate ${result.rate} צריך להיות גבוה מ-0.04`);
});

await test('getBestNetwork: חנות לא ידועה ← הרשת עם highest base rate', () => {
  // tradedoubler ו-impact שניהם base=0.08, tradedoubler ראשון
  const result = getBestNetwork('unknown_store', 'skimlinks');
  assert(result.rate >= 0.08, `rate ${result.rate} צריך להיות לפחות 0.08`);
  assert(['tradedoubler', 'impact'].includes(result.network), `network לא צפוי: ${result.network}`);
});

// ── 2. buildSkimlinksUrl ─────────────────────────────────

await test('buildSkimlinksUrl: מכיל skimresources.com', () => {
  const url = buildSkimlinksUrl('https://example.com/product');
  assert(url.includes('skimresources.com'), `URL לא מכיל skimresources.com: ${url}`);
});

// ── 3. buildTradeDoublerUrl ──────────────────────────────

await test('buildTradeDoublerUrl: מכיל tradedoubler.com', () => {
  const url = buildTradeDoublerUrl('https://hm.com/product');
  assert(url.includes('tradedoubler.com'), `URL לא מכיל tradedoubler.com: ${url}`);
});

// ── 4. buildAwinUrl ──────────────────────────────────────

await test('buildAwinUrl: מכיל awin1.com', () => {
  const url = buildAwinUrl('https://zara.com/product', '12345');
  assert(url.includes('awin1.com'), `URL לא מכיל awin1.com: ${url}`);
});

// ── 5. shouldUpdateAffiliate ──────────────────────────────

await test('shouldUpdateAffiliate: מחזיר true כאשר יש רשת טובה יותר', () => {
  // דיל עם source skimlinks (base=0.03), הרשת הטובה tradedoubler (0.08)
  const deal = { id: '1', source: 'skimlinks', affiliateUrl: 'https://go.skimresources.com/...' };
  const bestNetwork = { network: 'tradedoubler', rate: 0.08 };
  const result = shouldUpdateAffiliate(deal, bestNetwork);
  assert(result === true, `ציפינו true, קיבלנו: ${result}`);
});

await test('shouldUpdateAffiliate: מחזיר false כאשר כבר על הרשת הטובה', () => {
  // דיל עם source tradedoubler, הרשת הטובה tradedoubler
  const deal = { id: '2', source: 'tradedoubler_api', affiliateUrl: 'https://clk.tradedoubler.com/...' };
  const bestNetwork = { network: 'tradedoubler', rate: 0.08 };
  const result = shouldUpdateAffiliate(deal, bestNetwork);
  assert(result === false, `ציפינו false, קיבלנו: ${result}`);
});

// ── 6. parseNetworkFromSource ─────────────────────────────

await test('parseNetworkFromSource: "tradedoubler_api" → "tradedoubler"', () => {
  const result = parseNetworkFromSource('tradedoubler_api');
  assert(result === 'tradedoubler', `קיבלנו: ${result}`);
});

await test('parseNetworkFromSource: "scraper_t1" → null', () => {
  const result = parseNetworkFromSource('scraper_t1');
  assert(result === null, `קיבלנו: ${result}, ציפינו null`);
});

// ── תוצאות ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות BOT-29: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ כל הבדיקות עברו — BOT-29 מוכן!');
  process.exit(0);
}
