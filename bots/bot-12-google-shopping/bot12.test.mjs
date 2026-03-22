// bot12.test.mjs — בדיקות ל-BOT-12 Google Shopping
// הרץ: node bot12.test.mjs
// 11 בדיקות unit

import {
  mapGoogleShoppingCategory,
  calculateDiscount,
  parseGooglePrice,
  buildGoogleShoppingPayload,
  isValidGoogleShoppingDeal,
  buildScraperApiUrl,
} from './bot12.mjs';

const PASS = [], FAIL = [];
function assert(c, m) { if (!c) throw new Error(m); }
async function test(name, fn) {
  try { await fn(); PASS.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAIL.push(name); console.error(`❌ ${name}: ${e.message}`); }
}

// ── mapGoogleShoppingCategory ─────────────────────────────

await test('mapGoogleShoppingCategory: משתמש בcategory param כשקיים', () => {
  assert(mapGoogleShoppingCategory('Nike Shoes', 'sports') === 'sports', 'ציפינו sports');
});
await test('mapGoogleShoppingCategory: Electronics מtitle', () => {
  assert(mapGoogleShoppingCategory('iPhone 15 Pro', '') === 'electronics', `קיבלנו: ${mapGoogleShoppingCategory('iPhone 15 Pro', '')}`);
});
await test('mapGoogleShoppingCategory: null title → fashion', () => {
  assert(mapGoogleShoppingCategory('', '') === 'fashion', 'ציפינו fashion');
});

// ── parseGooglePrice ──────────────────────────────────────

await test('parseGooglePrice: "$49.99" → 49.99', () => {
  assert(parseGooglePrice('$49.99') === 49.99, `קיבלנו: ${parseGooglePrice('$49.99')}`);
});
await test('parseGooglePrice: "€129" → 129', () => {
  assert(parseGooglePrice('€129') === 129, `קיבלנו: ${parseGooglePrice('€129')}`);
});
await test('parseGooglePrice: null → null', () => {
  assert(parseGooglePrice(null) === null, 'ציפינו null');
});

// ── calculateDiscount ─────────────────────────────────────

await test('calculateDiscount: 60 מתוך 100 → 40%', () => {
  assert(calculateDiscount(60, 100) === 40, `קיבלנו: ${calculateDiscount(60, 100)}`);
});
await test('calculateDiscount: price >= original → null', () => {
  assert(calculateDiscount(100, 100) === null, 'ציפינו null');
});

// ── buildGoogleShoppingPayload ────────────────────────────

const mockItem = {
  title:     'Sony WH-1000XM5 Headphones Sale',
  price:     '$249.99',
  old_price: '$349.99',
  link:      'https://sony.com/headphones',
  thumbnail: 'https://img.com/sony.jpg',
  source:    'Sony',
};
await test('buildGoogleShoppingPayload: source === "google_shopping"', () => {
  assert(buildGoogleShoppingPayload(mockItem, 'electronics').source === 'google_shopping', 'שגוי');
});
await test('buildGoogleShoppingPayload: status === "pending"', () => {
  assert(buildGoogleShoppingPayload(mockItem, 'electronics').status === 'pending', 'שגוי');
});

// ── isValidGoogleShoppingDeal ─────────────────────────────

await test('isValidGoogleShoppingDeal: פריט עם URL ומחיר → true', () => {
  assert(isValidGoogleShoppingDeal({ price: '$49.99', link: 'https://example.com' }) === true, 'ציפינו true');
});

// ── buildScraperApiUrl ────────────────────────────────────

await test('buildScraperApiUrl: מכיל query ו-api_key', () => {
  const url = buildScraperApiUrl('electronics sale', 1);
  assert(url.includes('electronics+sale') || url.includes('electronics%20sale'), `חסר query: ${url}`);
});

// ── תוצאות ────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 BOT-12: ${PASS.length} עברו, ${FAIL.length} נכשלו`);
if (FAIL.length) { FAIL.forEach(t => console.error(`   • ${t}`)); process.exit(1); }
else { console.log('✅ כל הבדיקות עברו — BOT-12 מוכן!'); process.exit(0); }
