// bot61.test.mjs — בדיקות יחידה ל-BOT-61 Legal Validator
// הרץ: node bot61.test.mjs
// ════════════════════════════════════════════════════════════

import {
  hasAffiliateDisclosure,
  isPriceAccurate,
  validateDealCompliance,
  isCountryRestricted,
  buildComplianceReport,
  sanitizeDealTitle,
} from './bot61.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ════════════════════════════════════════════════════════════
// 1. hasAffiliateDisclosure
// ════════════════════════════════════════════════════════════

test('hasAffiliateDisclosure: affiliate_network set → true', () => {
  const deal = { affiliate_network: 'CJ', title: 'Nike Shoes', description: '' };
  assert(hasAffiliateDisclosure(deal) === true, 'expected true');
});

test('hasAffiliateDisclosure: no network, no disclosure terms → false', () => {
  const deal = { affiliate_network: null, title: 'Nike Shoes 50% off', description: 'Buy now' };
  assert(hasAffiliateDisclosure(deal) === false, 'expected false');
});

test('hasAffiliateDisclosure: title contains "sponsored" → true', () => {
  const deal = { affiliate_network: null, title: 'Sponsored: Nike Air Max Deal', description: '' };
  assert(hasAffiliateDisclosure(deal) === true, 'expected true for sponsored title');
});

test('hasAffiliateDisclosure: description contains "affiliate" → true', () => {
  const deal = { affiliate_network: '', title: 'Great deal', description: 'This post contains affiliate links' };
  assert(hasAffiliateDisclosure(deal) === true, 'expected true for affiliate in description');
});

// ════════════════════════════════════════════════════════════
// 2. isPriceAccurate
// ════════════════════════════════════════════════════════════

test('isPriceAccurate: 100 original, 70 discounted, 30% → true', () => {
  assert(isPriceAccurate(100, 70, 30) === true, 'expected true');
});

test('isPriceAccurate: 100 original, 50 discounted, 30% → false (too low)', () => {
  assert(isPriceAccurate(100, 50, 30) === false, 'expected false — price too low');
});

test('isPriceAccurate: 100 original, 71.5 discounted, 30% (within 2% tolerance) → true', () => {
  // expected = 70, diff = 1.5 < 2 (2% of 100) → should be true
  assert(isPriceAccurate(100, 71.5, 30) === true, 'expected true within tolerance');
});

test('isPriceAccurate: invalid inputs → false', () => {
  assert(isPriceAccurate(0,   50, 30) === false, 'zero original');
  assert(isPriceAccurate(-1,  50, 30) === false, 'negative original');
  assert(isPriceAccurate(100, -1, 30) === false, 'negative discounted');
  assert(isPriceAccurate('x', 50, 30) === false, 'string input');
});

// ════════════════════════════════════════════════════════════
// 3. validateDealCompliance
// ════════════════════════════════════════════════════════════

test('validateDealCompliance: valid deal → { valid: true, issues: [] }', () => {
  const deal = {
    id:               'deal-1',
    title:            'Sony WH-1000XM5 Headphones',
    description:      '',
    affiliate_network: 'Amazon',
    original_price:   100,
    price:            70,
    discount:         30,
    geo_restrictions: [],
  };
  const result = validateDealCompliance(deal);
  assert(result.valid === true, `expected valid=true, got ${JSON.stringify(result)}`);
  assert(result.issues.length === 0, `expected empty issues, got: ${result.issues}`);
});

test('validateDealCompliance: no affiliate_network → issues contains disclosure warning', () => {
  const deal = {
    id:               'deal-2',
    title:            'Nike Air Max',
    description:      'Great shoes on sale',
    affiliate_network: null,
    original_price:   100,
    price:            70,
    discount:         30,
    geo_restrictions: [],
  };
  const result = validateDealCompliance(deal);
  assert(result.valid === false, 'expected valid=false');
  assert(
    result.issues.includes('missing_affiliate_disclosure'),
    `expected disclosure issue, got: ${result.issues}`
  );
});

// ════════════════════════════════════════════════════════════
// 4. isCountryRestricted
// ════════════════════════════════════════════════════════════

test('isCountryRestricted: deal with US restriction, country=US → true', () => {
  const deal = { geo_restrictions: ['US', 'CA'] };
  assert(isCountryRestricted(deal, 'US') === true, 'expected true');
});

test('isCountryRestricted: deal with no restrictions → false', () => {
  const deal = { geo_restrictions: [] };
  assert(isCountryRestricted(deal, 'US') === false, 'expected false for empty array');
});

test('isCountryRestricted: deal without geo_restrictions field → false', () => {
  const deal = { id: 'deal-3' };
  assert(isCountryRestricted(deal, 'US') === false, 'expected false for null field');
});

test('isCountryRestricted: case-insensitive match → true', () => {
  const deal = { geo_restrictions: ['us', 'gb'] };
  assert(isCountryRestricted(deal, 'US') === true, 'expected true case-insensitive');
});

// ════════════════════════════════════════════════════════════
// 5. buildComplianceReport
// ════════════════════════════════════════════════════════════

test('buildComplianceReport: counts compliant and issues correctly', () => {
  const deals = [
    { id: 'd1', title: 'Deal 1', affiliate_network: 'CJ',   original_price: 100, price: 70, discount: 30 },
    { id: 'd2', title: 'Deal 2', affiliate_network: null,   original_price: 100, price: 70, discount: 30 },
    { id: 'd3', title: 'Deal 3', affiliate_network: 'AWIN', original_price: 100, price: 50, discount: 30 },
  ];

  const report = buildComplianceReport(deals);
  assert(report.total === 3, `expected total=3, got ${report.total}`);
  assert(report.compliant >= 1, `expected at least 1 compliant, got ${report.compliant}`);
  assert(Array.isArray(report.issues), 'issues should be array');
  assert(report.issues.length > 0, 'expected some issues');
});

// ════════════════════════════════════════════════════════════
// 6. sanitizeDealTitle
// ════════════════════════════════════════════════════════════

test('sanitizeDealTitle: removes "free*" asterisk warning pattern', () => {
  const result = sanitizeDealTitle('Get free* shipping today');
  assert(!result.includes('free*'), `still contains free*: ${result}`);
});

test('sanitizeDealTitle: normal title unchanged', () => {
  const title  = 'Sony WH-1000XM5 50% off';
  const result = sanitizeDealTitle(title);
  assert(result === title, `expected unchanged, got: ${result}`);
});

test('sanitizeDealTitle: removes "guaranteed" term', () => {
  const result = sanitizeDealTitle('Guaranteed lowest price on Nike');
  assert(!result.toLowerCase().includes('guaranteed'), `still contains guaranteed: ${result}`);
});

test('sanitizeDealTitle: removes "unlimited*" term', () => {
  const result = sanitizeDealTitle('unlimited* cashback offer');
  assert(!result.includes('unlimited*'), `still contains unlimited*: ${result}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-61 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
