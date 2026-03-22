// bot16.test.mjs — בדיקות ל-BOT-16 Competitor Monitor
// הרץ: node bot16.test.mjs
// 12 בדיקות unit

import {
  mapCompetitorCategory,
  parseCompetitorPrice,
  parseDiscountPercent,
  buildCompetitorPayload,
  isValidCompetitorDeal,
  parseDealabsHtml,
  parseSlickdealsHtml,
  COMPETITOR_TARGETS,
} from './bot16.mjs';

const PASS = [], FAIL = [];
function assert(c, m) { if (!c) throw new Error(m); }
async function test(name, fn) {
  try { await fn(); PASS.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAIL.push(name); console.error(`❌ ${name}: ${e.message}`); }
}

// ── COMPETITOR_TARGETS ────────────────────────────────────

await test('COMPETITOR_TARGETS: מכיל dealabs ו-slickdeals', () => {
  const sources = COMPETITOR_TARGETS.map(t => t.source);
  assert(sources.includes('dealabs'), 'חסר dealabs');
  assert(sources.includes('slickdeals'), 'חסר slickdeals');
});

// ── mapCompetitorCategory ─────────────────────────────────

await test('mapCompetitorCategory: "Tech & Electronics" → electronics', () => {
  assert(mapCompetitorCategory('Tech & Electronics') === 'electronics', `קיבלנו: ${mapCompetitorCategory('Tech & Electronics')}`);
});
await test('mapCompetitorCategory: "Home Appliances" → home', () => {
  assert(mapCompetitorCategory('Home Appliances') === 'home', `קיבלנו: ${mapCompetitorCategory('Home Appliances')}`);
});
await test('mapCompetitorCategory: null → fashion', () => {
  assert(mapCompetitorCategory(null) === 'fashion', 'ציפינו fashion');
});

// ── parseCompetitorPrice ──────────────────────────────────

await test('parseCompetitorPrice: "$29.99" → 29.99', () => {
  assert(parseCompetitorPrice('$29.99') === 29.99, `קיבלנו: ${parseCompetitorPrice('$29.99')}`);
});
await test('parseCompetitorPrice: "Only $149 today" → 149', () => {
  assert(parseCompetitorPrice('Only $149 today') === 149, `קיבלנו: ${parseCompetitorPrice('Only $149 today')}`);
});
await test('parseCompetitorPrice: null → null', () => {
  assert(parseCompetitorPrice(null) === null, 'ציפינו null');
});

// ── parseDiscountPercent ──────────────────────────────────

await test('parseDiscountPercent: "50% off" → 50', () => {
  assert(parseDiscountPercent('50% off') === 50, `קיבלנו: ${parseDiscountPercent('50% off')}`);
});
await test('parseDiscountPercent: ריק → null', () => {
  assert(parseDiscountPercent('') === null, 'ציפינו null');
});

// ── buildCompetitorPayload ────────────────────────────────

await test('buildCompetitorPayload: source מוגדר נכון', () => {
  const item    = { title: 'Test Deal', url: 'https://example.com', temperature: 200 };
  const payload = buildCompetitorPayload(item, 'slickdeals');
  assert(payload.source === 'slickdeals', `source: ${payload.source}`);
});

// ── isValidCompetitorDeal ─────────────────────────────────

await test('isValidCompetitorDeal: דיל עם URL, title, temp גבוה → true', () => {
  assert(isValidCompetitorDeal({ title: 'Great Deal', url: 'https://example.com', temperature: 200 }) === true, 'ציפינו true');
});
await test('isValidCompetitorDeal: אין URL → false', () => {
  assert(isValidCompetitorDeal({ title: 'Great Deal', temperature: 200 }) === false, 'ציפינו false');
});

// ── תוצאות ────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 BOT-16: ${PASS.length} עברו, ${FAIL.length} נכשלו`);
if (FAIL.length) { FAIL.forEach(t => console.error(`   • ${t}`)); process.exit(1); }
else { console.log('✅ כל הבדיקות עברו — BOT-16 מוכן!'); process.exit(0); }
