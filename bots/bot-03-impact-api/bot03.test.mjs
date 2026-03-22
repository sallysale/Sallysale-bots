// bot03.test.mjs — בדיקות ל-BOT-03 Impact.com
// הרץ: node bot03.test.mjs
// 10 בדיקות unit — ללא קריאות HTTP ולא קריאות DB

import {
  mapImpactCategory,
  calculateDiscount,
  buildImpactPayload,
  isValidImpactDeal,
  buildAuthHeader,
} from './bot03.mjs';

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

// ── 1. buildAuthHeader ────────────────────────────────────

await test('buildAuthHeader: מחזיר "Basic ..." עם base64', () => {
  const header = buildAuthHeader('user123', 'pass456');
  assert(header.startsWith('Basic '), `header: ${header}`);
  const decoded = Buffer.from(header.replace('Basic ', ''), 'base64').toString();
  assert(decoded === 'user123:pass456', `decoded: ${decoded}`);
});

// ── 2. mapImpactCategory ──────────────────────────────────

await test('mapImpactCategory: Electronics → electronics', () => {
  assert(mapImpactCategory('Electronics') === 'electronics', `קיבלנו: ${mapImpactCategory('Electronics')}`);
});

await test('mapImpactCategory: Beauty → beauty', () => {
  assert(mapImpactCategory('Beauty & Personal Care') === 'beauty', `קיבלנו: ${mapImpactCategory('Beauty & Personal Care')}`);
});

await test('mapImpactCategory: ריק → fashion', () => {
  assert(mapImpactCategory('') === 'fashion', `קיבלנו: ${mapImpactCategory('')}`);
});

// ── 3. calculateDiscount ──────────────────────────────────

await test('calculateDiscount: 75 מתוך 150 → 50%', () => {
  assert(calculateDiscount(75, 150) === 50, `קיבלנו: ${calculateDiscount(75, 150)}`);
});

await test('calculateDiscount: מחיר שווה → null', () => {
  assert(calculateDiscount(100, 100) === null, 'ציפינו null');
});

// ── 4. buildImpactPayload ─────────────────────────────────

const mockItem = {
  Name: 'Zara Summer Sale Dress',
  Price: '39.99',
  RetailPrice: '79.99',
  Currency: 'USD',
  TrackingLink: 'https://click.impact.com/c/?a=1&o=2',
  Url: 'https://zara.com/dress',
  ImageUrl: 'https://zara.com/img/dress.jpg',
  CampaignName: 'Zara',
  Category: 'Women\'s Clothing',
};

await test('buildImpactPayload: source === "impact"', () => {
  const p = buildImpactPayload(mockItem);
  assert(p.source === 'impact', `source: ${p.source}`);
});

await test('buildImpactPayload: storeName_en === "Zara"', () => {
  const p = buildImpactPayload(mockItem);
  assert(p.storeName_en === 'Zara', `storeName_en: ${p.storeName_en}`);
});

// ── 5. isValidImpactDeal ──────────────────────────────────

await test('isValidImpactDeal: דיל תקין עם Price < RetailPrice → true', () => {
  const item = {
    Price: '39.99',
    RetailPrice: '79.99',
    TrackingLink: 'https://example.com',
  };
  assert(isValidImpactDeal(item) === true, 'ציפינו true');
});

await test('isValidImpactDeal: Price >= RetailPrice → false', () => {
  const item = {
    Price: '80',
    RetailPrice: '79.99',
    TrackingLink: 'https://example.com',
  };
  assert(isValidImpactDeal(item) === false, 'ציפינו false');
});

await test('isValidImpactDeal: אין URL → false', () => {
  const item = { Price: '39.99', RetailPrice: '79.99' };
  assert(isValidImpactDeal(item) === false, 'ציפינו false');
});

// ── תוצאות ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות BOT-03: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ כל הבדיקות עברו — BOT-03 מוכן!');
  process.exit(0);
}
