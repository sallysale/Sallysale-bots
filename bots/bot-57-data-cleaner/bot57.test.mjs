// ════════════════════════════════════════════════════════════
// BOT-57 Tests — Data Cleaner
// הרצה: node bot57.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isPriceAnomaly,
  isStaleLink,
  isBrokenImage,
  classifyDeal,
  buildCleanupReport,
  shouldArchiveDeal,
} from './bot57.mjs';

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ══════════════════════════════
// isPriceAnomaly
// ══════════════════════════════

test('isPriceAnomaly: price=0.001 → true', () => {
  assert(isPriceAnomaly(0.001, 10) === true);
});

test('isPriceAnomaly: price=0 → true', () => {
  assert(isPriceAnomaly(0, 10) === true);
});

test('isPriceAnomaly: price=5, avg=10 → false', () => {
  assert(isPriceAnomaly(5, 10) === false);
});

test('isPriceAnomaly: price=1000, avg=50 → true (exceeds 10x)', () => {
  assert(isPriceAnomaly(1000, 50) === true);   // 1000 > 50*10 = 500 ✓
});

test('isPriceAnomaly: price=50, avg=50 → false', () => {
  assert(isPriceAnomaly(50, 50) === false);
});

test('isPriceAnomaly: price=-5 → true (negative)', () => {
  assert(isPriceAnomaly(-5, 10) === true);
});

test('isPriceAnomaly: price=NaN → true', () => {
  assert(isPriceAnomaly(NaN, 10) === true);
});

// ══════════════════════════════
// isStaleLink
// ══════════════════════════════

test('isStaleLink: 10 days ago, maxAge=7 → true', () => {
  const now     = new Date('2026-03-17T12:00:00Z');
  const checked = new Date('2026-03-07T12:00:00Z').toISOString();
  assert(isStaleLink(checked, 7, now) === true);
});

test('isStaleLink: 3 days ago, maxAge=7 → false', () => {
  const now     = new Date('2026-03-17T12:00:00Z');
  const checked = new Date('2026-03-14T12:00:00Z').toISOString();
  assert(isStaleLink(checked, 7, now) === false);
});

test('isStaleLink: null lastChecked → true (never checked = stale)', () => {
  assert(isStaleLink(null, 7, new Date()) === true);
});

test('isStaleLink: undefined lastChecked → true', () => {
  assert(isStaleLink(undefined, 7, new Date()) === true);
});

test('isStaleLink: invalid date string → true', () => {
  assert(isStaleLink('not-a-date', 7, new Date()) === true);
});

// ══════════════════════════════
// isBrokenImage
// ══════════════════════════════

test('isBrokenImage: null → true', () => {
  assert(isBrokenImage(null) === true);
});

test('isBrokenImage: empty string → true', () => {
  assert(isBrokenImage('') === true);
});

test('isBrokenImage: data URI → true', () => {
  assert(isBrokenImage('data:image/png;base64,abc123') === true);
});

test('isBrokenImage: valid HTTPS URL → false', () => {
  assert(isBrokenImage('https://cdn.example.com/img.jpg') === false);
});

test('isBrokenImage: undefined → true', () => {
  assert(isBrokenImage(undefined) === true);
});

// ══════════════════════════════
// classifyDeal
// ══════════════════════════════

test('classifyDeal: null image → broken_image', () => {
  const deal = { image_url: null, price: 10, original_price: 20, last_checked_at: new Date().toISOString() };
  assertEq(classifyDeal(deal, new Date()), 'broken_image');
});

test('classifyDeal: normal data → clean', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    image_url:       'https://cdn.example.com/img.jpg',
    price:           20,
    original_price:  40,
    last_checked_at: new Date('2026-03-16T12:00:00Z').toISOString(),  // 1 day ago
    expires_at:      null,
    price_validated: true,
    created_at:      new Date('2026-01-01').toISOString(),
  };
  assertEq(classifyDeal(deal, now), 'clean');
});

test('classifyDeal: price anomaly → anomaly_price', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    image_url:       'https://cdn.example.com/img.jpg',
    price:           9999,
    original_price:  50,
    last_checked_at: new Date('2026-03-16T12:00:00Z').toISOString(),
    expires_at:      null,
    price_validated: true,
    created_at:      new Date('2026-01-01').toISOString(),
  };
  assertEq(classifyDeal(deal, now), 'anomaly_price');
});

test('classifyDeal: expired deal → expired', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    image_url:       'https://cdn.example.com/img.jpg',
    price:           20,
    original_price:  40,
    last_checked_at: new Date('2026-03-16T12:00:00Z').toISOString(),
    expires_at:      new Date('2026-03-10T00:00:00Z').toISOString(),  // 7 days ago
    price_validated: true,
    created_at:      new Date('2026-01-01').toISOString(),
  };
  assertEq(classifyDeal(deal, now), 'expired');
});

// ══════════════════════════════
// buildCleanupReport
// ══════════════════════════════

test('buildCleanupReport: counts correctly by reason', () => {
  const results = [
    { action: 'fix_image' },
    { action: 'fix_image' },
    { action: 'archive' },
    { action: 'skip' },
    { action: null },
  ];
  const report = buildCleanupReport(results);
  assertEq(report.total,   5);
  assertEq(report.cleaned, 3);
  assertEq(report.skipped, 2);
  assertEq(report.byReason.fix_image, 2);
  assertEq(report.byReason.archive, 1);
});

test('buildCleanupReport: empty array → zeroes', () => {
  const report = buildCleanupReport([]);
  assertEq(report.total,   0);
  assertEq(report.cleaned, 0);
  assertEq(report.skipped, 0);
});

test('buildCleanupReport: non-array → zeroes', () => {
  const report = buildCleanupReport(null);
  assertEq(report.total, 0);
});

// ══════════════════════════════
// shouldArchiveDeal
// ══════════════════════════════

test('shouldArchiveDeal: expired 31 days ago → true', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    expires_at:      new Date('2026-02-14T12:00:00Z').toISOString(), // 31 days ago
    price_validated: true,
    created_at:      new Date('2026-01-01').toISOString(),
  };
  assert(shouldArchiveDeal(deal, now) === true);
});

test('shouldArchiveDeal: expired 10 days ago → false', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    expires_at:      new Date('2026-03-07T12:00:00Z').toISOString(), // 10 days ago
    price_validated: true,
    created_at:      new Date('2026-01-01').toISOString(),
  };
  assert(shouldArchiveDeal(deal, now) === false);
});

test('shouldArchiveDeal: price_validated=false, created 10 days ago → true', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    expires_at:      null,
    price_validated: false,
    created_at:      new Date('2026-03-07T00:00:00Z').toISOString(), // 10 days ago
  };
  assert(shouldArchiveDeal(deal, now) === true);
});

test('shouldArchiveDeal: price_validated=false, created 3 days ago → false', () => {
  const now  = new Date('2026-03-17T12:00:00Z');
  const deal = {
    expires_at:      null,
    price_validated: false,
    created_at:      new Date('2026-03-14T00:00:00Z').toISOString(), // 3 days ago
  };
  assert(shouldArchiveDeal(deal, now) === false);
});

test('shouldArchiveDeal: null deal → false', () => {
  assert(shouldArchiveDeal(null, new Date()) === false);
});

// ════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-57: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.error(`\nFailed tests: ${FAILED.join(', ')}`);
  process.exit(1);
}
