// bot09.test.mjs — בדיקות יחידה ל-BOT-09 Scraping Tier 1
// הרץ: node bot09.test.mjs
//
// חשוב: הבדיקות בודקות רק פונקציות טהורות — אין קריאות HTTP או Supabase.
// ════════════════════════════════════════════════════════════

import { cleanPrice, extractDiscount, isValidDeal, buildDealPayload } from './bot09.mjs';

const PASSED = [];
const FAILED = [];

/** runner — מריץ בדיקה אחת, מוסיף לרשימה המתאימה */
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

/** assert — זורק שגיאה אם התנאי לא מתקיים */
function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertClose(a, b, tolerance = 0.01, msg) {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(msg || `expected ${b}, got ${a}`);
  }
}

// ════════════════════════════════════════════════════════════
// 1. extractDiscount — חישוב אחוז הנחה בסיסי
// ════════════════════════════════════════════════════════════

test('extractDiscount: הנחה בסיסית (30% off)', () => {
  const result = extractDiscount(70, 100);
  assert(result === 30, `קיבלנו ${result}, צפינו 30`);
});

// ════════════════════════════════════════════════════════════
// 2. extractDiscount — מחירים שווים (0%)
// ════════════════════════════════════════════════════════════

test('extractDiscount: מחירים שווים → 0', () => {
  const result = extractDiscount(100, 100);
  assert(result === 0, `קיבלנו ${result}, צפינו 0`);
});

// ════════════════════════════════════════════════════════════
// 3. extractDiscount — originalPrice חסר → null
// ════════════════════════════════════════════════════════════

test('extractDiscount: originalPrice חסר → null', () => {
  const result = extractDiscount(50, null);
  assert(result === null, `קיבלנו ${result}, צפינו null`);
});

// ════════════════════════════════════════════════════════════
// 4. isValidDeal — דיל תקין (30% off)
// ════════════════════════════════════════════════════════════

test('isValidDeal: דיל תקין (30% off) → true', () => {
  const result = isValidDeal(70, 100);
  assert(result === true, `קיבלנו ${result}, צפינו true`);
});

// ════════════════════════════════════════════════════════════
// 5. isValidDeal — הנחה נמוכה מדי (5% off) → false
// ════════════════════════════════════════════════════════════

test('isValidDeal: 5% off → false (מתחת לסף 10%)', () => {
  const result = isValidDeal(95, 100);
  assert(result === false, `קיבלנו ${result}, צפינו false`);
});

// ════════════════════════════════════════════════════════════
// 6. isValidDeal — price=0 → false
// ════════════════════════════════════════════════════════════

test('isValidDeal: price=0 → false', () => {
  const result = isValidDeal(0, 100);
  assert(result === false, `קיבלנו ${result}, צפינו false`);
});

// ════════════════════════════════════════════════════════════
// 7. isValidDeal — originalPrice חסר → false
// ════════════════════════════════════════════════════════════

test('isValidDeal: originalPrice חסר → false', () => {
  const result = isValidDeal(50, null);
  assert(result === false, `קיבלנו ${result}, צפינו false`);
});

// ════════════════════════════════════════════════════════════
// 8. cleanPrice — מחיר בפאונד '£29.99'
// ════════════════════════════════════════════════════════════

test("cleanPrice('£29.99') → 29.99", () => {
  const result = cleanPrice('£29.99');
  assertClose(result, 29.99, 0.001, `קיבלנו ${result}, צפינו 29.99`);
});

// ════════════════════════════════════════════════════════════
// 9. cleanPrice — מחיר בדולר '$49'
// ════════════════════════════════════════════════════════════

test("cleanPrice('$49') → 49", () => {
  const result = cleanPrice('$49');
  assertClose(result, 49, 0.001, `קיבלנו ${result}, צפינו 49`);
});

// ════════════════════════════════════════════════════════════
// 10. cleanPrice — 'was £99.99' → 99.99
// ════════════════════════════════════════════════════════════

test("cleanPrice('was £99.99') → 99.99", () => {
  const result = cleanPrice('was £99.99');
  assertClose(result, 99.99, 0.001, `קיבלנו ${result}, צפינו 99.99`);
});

// ════════════════════════════════════════════════════════════
// 11. buildDealPayload — בונה payload נכון
// ════════════════════════════════════════════════════════════

test('buildDealPayload: שדות בסיסיים נכונים', () => {
  const product = {
    title:         'Test Dress',
    price:         49.99,
    originalPrice: 99.99,
    productUrl:    'https://www2.hm.com/en_gb/productpage.0123456001.html',
    imageUrl:      'https://lp2.hm.com/hmgoepprod?set=source[/0123456001.jpg]',
    description:   'A lovely dress',
  };
  const payload = buildDealPayload(product, 'H&M', 'fashion', 'GBP', 'GB');

  assert(payload.title_en      === 'Test Dress',                       `title_en: ${payload.title_en}`);
  assert(payload.storeName_en  === 'H&M',                              `storeName_en: ${payload.storeName_en}`);
  assert(payload.category_slug === 'fashion',                          `category_slug: ${payload.category_slug}`);
  assert(payload.currency      === 'GBP',                              `currency: ${payload.currency}`);
  assert(payload.country       === 'GB',                               `country: ${payload.country}`);
  assert(payload.price         === 49.99,                              `price: ${payload.price}`);
  assert(payload.originalPrice === 99.99,                              `originalPrice: ${payload.originalPrice}`);
  assert(payload.productUrl    === product.productUrl,                 `productUrl: ${payload.productUrl}`);
  assert(payload.source        === 'scraper_t1',                       `source: ${payload.source}`);
});

// ════════════════════════════════════════════════════════════
// 12. buildDealPayload — status='pending'
// ════════════════════════════════════════════════════════════

test("buildDealPayload: status='pending'", () => {
  const product = {
    title: 'Blue Sofa', price: 299, originalPrice: 499,
    productUrl: 'https://www.ikea.com/gb/en/p/ektorp-sofa/12345678/',
    imageUrl: '', description: '',
  };
  const payload = buildDealPayload(product, 'IKEA', 'home', 'GBP', 'GB');
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
  console.log('✅ כל הבדיקות עברו — BOT-09 מוכן!');
  process.exit(0);
}
