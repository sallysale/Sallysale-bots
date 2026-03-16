// bot10.test.mjs — בדיקות יחידה ל-BOT-10 Scraping Tier 2
// הרץ: node bot10.test.mjs
//
// חשוב: הבדיקות בודקות רק פונקציות טהורות — אין קריאות HTTP או Supabase.
// ════════════════════════════════════════════════════════════

import { cleanPrice, extractDiscount, isValidDeal, buildDealPayload } from './bot10.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try {
    fn();
    PASSED.push(name);
    console.log(`✅ ${name}`);
  } catch (e) {
    FAILED.push(name);
    console.error(`❌ ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertClose(a, b, tolerance = 0.01, msg) {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(msg || `expected ${b}, got ${a}`);
  }
}

// ════════════════════════════════════════════════════════════
// 1. cleanPrice — מחיר ILS עם סימן ₪
// ════════════════════════════════════════════════════════════

test("cleanPrice('₪299') → 299", () => {
  const result = cleanPrice('₪299');
  assertClose(result, 299, 0.001, `קיבלנו ${result}, צפינו 299`);
});

// ════════════════════════════════════════════════════════════
// 2. cleanPrice — מחיר עברי '299 ש"ח'
// ════════════════════════════════════════════════════════════

test("cleanPrice('299 ש\"ח') → 299", () => {
  const result = cleanPrice('299 ש"ח');
  assertClose(result, 299, 0.001, `קיבלנו ${result}, צפינו 299`);
});

// ════════════════════════════════════════════════════════════
// 3. cleanPrice — מחיר EUR
// ════════════════════════════════════════════════════════════

test("cleanPrice('€49.99') → 49.99", () => {
  const result = cleanPrice('€49.99');
  assertClose(result, 49.99, 0.001, `קיבלנו ${result}, צפינו 49.99`);
});

// ════════════════════════════════════════════════════════════
// 4. extractDiscount — חנות ישראלית (199 מתוך 299)
// ════════════════════════════════════════════════════════════

test('extractDiscount(199, 299) → 33% (חנות ישראלית)', () => {
  const result = extractDiscount(199, 299);
  assert(result === 33, `קיבלנו ${result}, צפינו 33`);
});

// ════════════════════════════════════════════════════════════
// 5. isValidDeal — דיל ILS תקין
// ════════════════════════════════════════════════════════════

test('isValidDeal: דיל ILS תקין (33% off) → true', () => {
  const result = isValidDeal(199, 299);
  assert(result === true, `קיבלנו ${result}, צפינו true`);
});

// ════════════════════════════════════════════════════════════
// 6. isValidDeal — 0% הנחה → false
// ════════════════════════════════════════════════════════════

test('isValidDeal: 0% הנחה → false', () => {
  const result = isValidDeal(299, 299);
  assert(result === false, `קיבלנו ${result}, צפינו false`);
});

// ════════════════════════════════════════════════════════════
// 7. buildDealPayload — חנות ישראלית → country='IL', currency='ILS'
// ════════════════════════════════════════════════════════════

test("buildDealPayload: חנות ישראלית → country='IL', currency='ILS'", () => {
  const product = {
    title: 'חולצה כחולה',
    price: 99,
    originalPrice: 199,
    productUrl: 'https://www.fox.co.il/product/123',
    imageUrl: 'https://www.fox.co.il/media/catalog/product/1/2/123.jpg',
    description: '',
  };
  const payload = buildDealPayload(product, 'Fox', 'fashion', 'ILS', 'IL');
  assert(payload.country  === 'IL',  `country: ${payload.country}`);
  assert(payload.currency === 'ILS', `currency: ${payload.currency}`);
});

// ════════════════════════════════════════════════════════════
// 8. buildDealPayload — חנות EU → currency='EUR'
// ════════════════════════════════════════════════════════════

test("buildDealPayload: חנות EU → currency='EUR'", () => {
  const product = {
    title: 'Summer Dress',
    price: 29.99,
    originalPrice: 59.99,
    productUrl: 'https://www.aboutyou.com/p/summer-dress/12345',
    imageUrl: 'https://img.aboutyou.de/p/12345/200.jpg',
    description: '',
  };
  const payload = buildDealPayload(product, 'About You', 'fashion', 'EUR', 'DE');
  assert(payload.currency === 'EUR', `currency: ${payload.currency}`);
  assert(payload.country  === 'DE',  `country: ${payload.country}`);
});

// ════════════════════════════════════════════════════════════
// 9. buildDealPayload — source='scraper_t2'
// ════════════════════════════════════════════════════════════

test("buildDealPayload: source='scraper_t2'", () => {
  const product = {
    title: 'מכנסי קסטרו',
    price: 149,
    originalPrice: 299,
    productUrl: 'https://www.castro.com/item/456',
    imageUrl: '',
    description: '',
  };
  const payload = buildDealPayload(product, 'Castro', 'fashion', 'ILS', 'IL');
  assert(payload.source === 'scraper_t2', `source: ${payload.source}`);
});

// ════════════════════════════════════════════════════════════
// 10. buildDealPayload — status='pending'
// ════════════════════════════════════════════════════════════

test("buildDealPayload: status='pending'", () => {
  const product = {
    title: 'ASOS Blue Jeans',
    price: 20,
    originalPrice: 40,
    productUrl: 'https://www.asos.com/product/blue-jeans/789',
    imageUrl: '',
    description: '',
  };
  const payload = buildDealPayload(product, 'ASOS', 'fashion', 'GBP', 'GB');
  assert(payload.status === 'pending', `status: ${payload.status}`);
});

// ════════════════════════════════════════════════════════════
// תוצאות
// ════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${PASSED.length} עברו, ${FAILED.length} נכשלו`);

if (FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ כל הבדיקות עברו — BOT-10 מוכן!');
  process.exit(0);
}
