// bot13.test.mjs — בדיקות ל-BOT-13 Google Trends
// הרץ: node bot13.test.mjs
// 11 בדיקות unit

import {
  isTrendingKeywordRelevant,
  extractShoppingKeywords,
  parseTrafficNumber,
  parseTrendsResponse,
  extractDailyTrends,
  buildDailyTrendsUrl,
} from './bot13.mjs';

const PASS = [], FAIL = [];
function assert(c, m) { if (!c) throw new Error(m); }
async function test(name, fn) {
  try { await fn(); PASS.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAIL.push(name); console.error(`❌ ${name}: ${e.message}`); }
}

// ── isTrendingKeywordRelevant ─────────────────────────────

await test('isTrendingKeywordRelevant: "black friday sale" → true', () => {
  assert(isTrendingKeywordRelevant('black friday sale') === true, 'ציפינו true');
});
await test('isTrendingKeywordRelevant: "politics news" → false', () => {
  assert(isTrendingKeywordRelevant('politics news') === false, 'ציפינו false');
});
await test('isTrendingKeywordRelevant: "" → false', () => {
  assert(isTrendingKeywordRelevant('') === false, 'ציפינו false');
});

// ── extractShoppingKeywords ───────────────────────────────

await test('extractShoppingKeywords: מחלץ מילות קנייה בלבד', () => {
  const trends = [
    { title: 'amazon sale today' },
    { title: 'political debate' },
    { title: 'fashion deals' },
    { title: 'weather forecast' },
  ];
  const result = extractShoppingKeywords(trends);
  assert(result.length === 2, `ציפינו 2, קיבלנו: ${result.length}`);
});
await test('extractShoppingKeywords: מערך ריק → []', () => {
  assert(extractShoppingKeywords([]).length === 0, 'ציפינו []');
});

// ── parseTrafficNumber ────────────────────────────────────

await test('parseTrafficNumber: "500K+" → 500000', () => {
  assert(parseTrafficNumber('500K+') === 500_000, `קיבלנו: ${parseTrafficNumber('500K+')}`);
});
await test('parseTrafficNumber: "2M+" → 2000000', () => {
  assert(parseTrafficNumber('2M+') === 2_000_000, `קיבלנו: ${parseTrafficNumber('2M+')}`);
});
await test('parseTrafficNumber: ריק → 0', () => {
  assert(parseTrafficNumber('') === 0, 'ציפינו 0');
});

// ── parseTrendsResponse ───────────────────────────────────

await test('parseTrendsResponse: מסיר prefix של Google', () => {
  const raw  = ")]}',\n{\"key\": \"value\"}";
  const result = parseTrendsResponse(raw);
  assert(result?.key === 'value', `לא פורס נכון: ${JSON.stringify(result)}`);
});
await test('parseTrendsResponse: JSON שבור → null', () => {
  assert(parseTrendsResponse('{invalid json') === null, 'ציפינו null');
});

// ── buildDailyTrendsUrl ───────────────────────────────────

await test('buildDailyTrendsUrl: מכיל geo=US', () => {
  const url = buildDailyTrendsUrl('US');
  assert(url.includes('geo=US'), `חסר geo: ${url}`);
});

// ── תוצאות ────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 BOT-13: ${PASS.length} עברו, ${FAIL.length} נכשלו`);
if (FAIL.length) { FAIL.forEach(t => console.error(`   • ${t}`)); process.exit(1); }
else { console.log('✅ כל הבדיקות עברו — BOT-13 מוכן!'); process.exit(0); }
