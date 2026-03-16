// bot07.test.mjs — בדיקות ל-BOT-07 eBay EPN
// הרץ: node bot07.test.mjs
// 12 בדיקות unit — ללא קריאות HTTP אמיתיות ולא קריאות DB

import {
  mapEbayCategory,
  calculateDiscount,
  buildEbayPayload,
  isValidEbayDeal,
} from './bot07.mjs';

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

// ── 1. mapEbayCategory ────────────────────────────────────

await test('mapEbayCategory: Clothing, Shoes & Accessories → fashion', () => {
  const result = mapEbayCategory('Clothing, Shoes & Accessories');
  assert(result === 'fashion', `קיבלנו: ${result}`);
});

await test('mapEbayCategory: Electronics → electronics', () => {
  const result = mapEbayCategory('Electronics');
  assert(result === 'electronics', `קיבלנו: ${result}`);
});

await test('mapEbayCategory: Home & Garden → home', () => {
  const result = mapEbayCategory('Home & Garden');
  assert(result === 'home', `קיבלנו: ${result}`);
});

await test('mapEbayCategory: Unknown Category → fashion (default)', () => {
  const result = mapEbayCategory('Unknown Category');
  assert(result === 'fashion', `קיבלנו: ${result}`);
});

// ── 2. calculateDiscount ──────────────────────────────────

await test('calculateDiscount: 50 מתוך 100 → 50%', () => {
  const result = calculateDiscount(50, 100);
  assert(result === 50, `קיבלנו: ${result}`);
});

await test('calculateDiscount: 90 מתוך 100 → 10%', () => {
  const result = calculateDiscount(90, 100);
  assert(result === 10, `קיבלנו: ${result}`);
});

await test('calculateDiscount: currentPrice=null → null', () => {
  const result = calculateDiscount(null, 100);
  assert(result === null, `קיבלנו: ${result}`);
});

await test('calculateDiscount: originalPrice=null → null', () => {
  const result = calculateDiscount(100, null);
  assert(result === null, `קיבלנו: ${result}`);
});

// ── 3. buildEbayPayload ───────────────────────────────────

// פריט eBay לדוגמה עם discountPriceInfo
const mockItem = {
  title:          ['Nike Air Max Sale - 40% Off'],
  sellingStatus:  [{
    currentPrice: [{ '__value__': '59.99', '@currencyId': 'USD' }],
  }],
  discountPriceInfo: [{
    originalRetailPrice: [{ '__value__': '100.00' }],
  }],
  viewItemURL:    ['https://www.ebay.com/itm/123456789'],
  galleryURL:     ['https://i.ebayimg.com/images/g/test/s-l500.jpg'],
  primaryCategory: [{ categoryName: ['Shoes'] }],
  condition:      [{ conditionDisplayName: ['New with tags'] }],
};

await test('buildEbayPayload: source === "ebay_epn"', () => {
  const payload = buildEbayPayload(mockItem, 'CAMP123');
  assert(payload.source === 'ebay_epn', `source היה: ${payload.source}`);
});

await test('buildEbayPayload: storeName_en === "eBay"', () => {
  const payload = buildEbayPayload(mockItem, 'CAMP123');
  assert(payload.storeName_en === 'eBay', `storeName_en היה: ${payload.storeName_en}`);
});

await test('buildEbayPayload: affiliateUrl מכיל rover.ebay.com עם campaignId', () => {
  const payload = buildEbayPayload(mockItem, 'CAMP123');
  assert(
    payload.affiliateUrl.includes('rover.ebay.com') && payload.affiliateUrl.includes('CAMP123'),
    `affiliateUrl לא תקין: ${payload.affiliateUrl}`
  );
});

// ── 4. isValidEbayDeal ─────────────────────────────────────

await test('isValidEbayDeal: פריט עם הנחה 40% → true', () => {
  // 60 מתוך 100 = הנחה 40%
  const validItem = {
    sellingStatus: [{ currentPrice: [{ '__value__': '60', '@currencyId': 'USD' }] }],
    discountPriceInfo: [{ originalRetailPrice: [{ '__value__': '100' }] }],
  };
  const result = isValidEbayDeal(validItem);
  assert(result === true, `ציפינו ל-true, קיבלנו: ${result}`);
});

await test('isValidEbayDeal: פריט עם הנחה 5% → false (מתחת ל-15%)', () => {
  // 95 מתוך 100 = הנחה 5%
  const lowDiscountItem = {
    sellingStatus: [{ currentPrice: [{ '__value__': '95', '@currencyId': 'USD' }] }],
    discountPriceInfo: [{ originalRetailPrice: [{ '__value__': '100' }] }],
  };
  const result = isValidEbayDeal(lowDiscountItem);
  assert(result === false, `ציפינו ל-false, קיבלנו: ${result}`);
});

// ── תוצאות ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות BOT-07: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ כל הבדיקות עברו — BOT-07 מוכן!');
  process.exit(0);
}
