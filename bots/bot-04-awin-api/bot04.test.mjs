// bot04.test.mjs — בדיקות ל-BOT-04 AWIN
// הרץ: node bot04.test.mjs
// 10 בדיקות unit — ללא קריאות HTTP ולא קריאות DB

import {
  mapAwinCategory,
  calculateDiscount,
  parseDiscountFromText,
  buildAwinPayload,
  isValidAwinDeal,
} from './bot04.mjs';

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

// ── 1. mapAwinCategory ────────────────────────────────────

await test('mapAwinCategory: Technology → electronics', () => {
  assert(mapAwinCategory('Technology') === 'electronics', `קיבלנו: ${mapAwinCategory('Technology')}`);
});

await test('mapAwinCategory: Sports → sports', () => {
  assert(mapAwinCategory('Sports & Fitness') === 'sports', `קיבלנו: ${mapAwinCategory('Sports & Fitness')}`);
});

await test('mapAwinCategory: Kids → kids', () => {
  assert(mapAwinCategory('Toys & Kids') === 'kids', `קיבלנו: ${mapAwinCategory('Toys & Kids')}`);
});

await test('mapAwinCategory: null → fashion', () => {
  assert(mapAwinCategory(null) === 'fashion', `קיבלנו: ${mapAwinCategory(null)}`);
});

// ── 2. parseDiscountFromText ──────────────────────────────

await test('parseDiscountFromText: "Save 30% today" → 30', () => {
  assert(parseDiscountFromText('Save 30% today') === 30, `קיבלנו: ${parseDiscountFromText('Save 30% today')}`);
});

await test('parseDiscountFromText: "Up to 50% off" → 50', () => {
  assert(parseDiscountFromText('Up to 50% off') === 50, `קיבלנו: ${parseDiscountFromText('Up to 50% off')}`);
});

await test('parseDiscountFromText: ריק → null', () => {
  assert(parseDiscountFromText('') === null, 'ציפינו null');
});

// ── 3. calculateDiscount ──────────────────────────────────

await test('calculateDiscount: 70 מתוך 100 → 30%', () => {
  assert(calculateDiscount(70, 100) === 30, `קיבלנו: ${calculateDiscount(70, 100)}`);
});

// ── 4. buildAwinPayload ───────────────────────────────────

const mockPromo = {
  title: 'H&M Summer Sale - 40% Off',
  advertiserName: 'H&M',
  promotionUrl: 'https://www.awin.com/cread.php?awinmid=1234&ued=...',
  logoUrl: 'https://example.com/hm.png',
  category: 'Fashion',
  promotionType: 'deal',
  discount: { percent: 40, currency: 'GBP' },
  description: 'Get 40% off all summer clothing',
};

await test('buildAwinPayload: source === "awin"', () => {
  const p = buildAwinPayload(mockPromo);
  assert(p.source === 'awin', `source: ${p.source}`);
});

await test('buildAwinPayload: storeName_en === "H&M"', () => {
  const p = buildAwinPayload(mockPromo);
  assert(p.storeName_en === 'H&M', `storeName_en: ${p.storeName_en}`);
});

// ── 5. isValidAwinDeal ────────────────────────────────────

await test('isValidAwinDeal: פרומוציה תקינה עם URL ו-title → true', () => {
  const promo = {
    title: 'Summer Sale',
    promotionUrl: 'https://example.com',
    discount: { percent: 25 },
  };
  assert(isValidAwinDeal(promo) === true, 'ציפינו true');
});

await test('isValidAwinDeal: אין URL → false', () => {
  const promo = { title: 'Sale', discount: { percent: 25 } };
  assert(isValidAwinDeal(promo) === false, 'ציפינו false');
});

await test('isValidAwinDeal: פג תוקף → false', () => {
  const promo = {
    title: 'Old Sale',
    promotionUrl: 'https://example.com',
    endDate: '2020-01-01',
  };
  assert(isValidAwinDeal(promo) === false, 'ציפינו false');
});

// ── תוצאות ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות BOT-04: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ כל הבדיקות עברו — BOT-04 מוכן!');
  process.exit(0);
}
