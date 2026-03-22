// ════════════════════════════════════════════════════════════
// BOT-53 Tests — Flash Sale Detector
// הרצה: node bot53.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isFlashSaleTitle,
  isFlashSaleByDiscount,
  extractFlashExpiry,
  computeFlashBadge,
  formatCountdown,
  isExpiredFlash,
  buildFlashBadgeText,
} from './bot53.mjs';

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
// isFlashSaleTitle
// ══════════════════════════════

test('isFlashSaleTitle: "Flash Sale 50% OFF" → true', () => {
  assert(isFlashSaleTitle('Flash Sale 50% OFF') === true);
});

test('isFlashSaleTitle: "⚡ Lightning Deal" → true', () => {
  assert(isFlashSaleTitle('⚡ Lightning Deal on Sony Headphones') === true);
});

test('isFlashSaleTitle: "Summer Collection" → false', () => {
  assert(isFlashSaleTitle('Summer Collection New Arrivals') === false);
});

test('isFlashSaleTitle: "Today Only - 40% OFF" → true', () => {
  assert(isFlashSaleTitle('Today Only - 40% OFF Nike Shoes') === true);
});

test('isFlashSaleTitle: "Limited Time Offer" → true', () => {
  assert(isFlashSaleTitle('Limited Time Offer — Up to 70% OFF') === true);
});

test('isFlashSaleTitle: "Ends Tonight" → true', () => {
  assert(isFlashSaleTitle('Ends Tonight: Huge Clearance Event') === true);
});

test('isFlashSaleTitle: "24 Hours Only Deal" → true', () => {
  assert(isFlashSaleTitle('24 Hours Only Deal on TVs') === true);
});

test('isFlashSaleTitle: null → false', () => {
  assert(isFlashSaleTitle(null) === false);
});

test('isFlashSaleTitle: "" → false', () => {
  assert(isFlashSaleTitle('') === false);
});

test('isFlashSaleTitle: "Deal of the Day" → true', () => {
  assert(isFlashSaleTitle('Deal of the Day: Dyson V11') === true);
});

test('isFlashSaleTitle: case insensitive — "FLASH SALE" → true', () => {
  assert(isFlashSaleTitle('FLASH SALE 80% OFF') === true);
});

// ══════════════════════════════
// isFlashSaleByDiscount
// ══════════════════════════════

test('isFlashSaleByDiscount: 70% → true', () => {
  assert(isFlashSaleByDiscount(70) === true);
});

test('isFlashSaleByDiscount: 30% → false', () => {
  assert(isFlashSaleByDiscount(30) === false);
});

test('isFlashSaleByDiscount: exactly 60% (threshold) → true', () => {
  assert(isFlashSaleByDiscount(60) === true);
});

test('isFlashSaleByDiscount: 59% → false', () => {
  assert(isFlashSaleByDiscount(59) === false);
});

test('isFlashSaleByDiscount: custom threshold 50% → true for 55', () => {
  assert(isFlashSaleByDiscount(55, 50) === true);
});

test('isFlashSaleByDiscount: NaN → false', () => {
  assert(isFlashSaleByDiscount(NaN) === false);
});

test('isFlashSaleByDiscount: null → false', () => {
  assert(isFlashSaleByDiscount(null) === false);
});

// ══════════════════════════════
// extractFlashExpiry
// ══════════════════════════════

test('extractFlashExpiry: "ends in 3 hours" → Date ~3h from now', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const result = extractFlashExpiry('ends in 3 hours', now);
  assert(result instanceof Date, 'Should be a Date');
  const diffH = (result.getTime() - now.getTime()) / 3600000;
  assert(Math.abs(diffH - 3) < 0.01, `Expected ~3h, got ${diffH}h`);
});

test('extractFlashExpiry: "expires in 30 minutes" → ~30m from now', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const result = extractFlashExpiry('expires in 30 minutes', now);
  assert(result instanceof Date, 'Should be a Date');
  const diffM = (result.getTime() - now.getTime()) / 60000;
  assert(Math.abs(diffM - 30) < 0.5, `Expected ~30m, got ${diffM}m`);
});

test('extractFlashExpiry: "no expiry info" → null', () => {
  const result = extractFlashExpiry('no expiry info here, regular deal');
  assertEq(result, null);
});

test('extractFlashExpiry: "today only" → end of day', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const result = extractFlashExpiry('today only 50% off', now);
  assert(result instanceof Date, 'Should be a Date');
  assertEq(result.getUTCHours(), 23);
  assertEq(result.getUTCMinutes(), 59);
});

test('extractFlashExpiry: "2 hours left" → ~2h from now', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const result = extractFlashExpiry('2 hours left on this deal', now);
  assert(result instanceof Date, 'Should be a Date');
  const diffH = (result.getTime() - now.getTime()) / 3600000;
  assert(Math.abs(diffH - 2) < 0.01, `Expected ~2h, got ${diffH}h`);
});

test('extractFlashExpiry: null → null', () => {
  assertEq(extractFlashExpiry(null), null);
});

// ══════════════════════════════
// computeFlashBadge
// ══════════════════════════════

test('computeFlashBadge: flash title → is_flash true', () => {
  const deal   = { title: 'Flash Sale 70% OFF', discount: 30 };
  const result = computeFlashBadge(deal);
  assert(result.is_flash === true, 'is_flash should be true');
  assert(result.flash_reason === 'title_keyword', `Unexpected reason: ${result.flash_reason}`);
});

test('computeFlashBadge: normal deal → is_flash false', () => {
  const deal   = { title: 'Summer Collection Shirts', discount: 20 };
  const result = computeFlashBadge(deal);
  assert(result.is_flash === false, 'is_flash should be false');
  assertEq(result.flash_expires_at, null);
});

test('computeFlashBadge: deep discount (65%) → is_flash true', () => {
  const deal   = { title: 'Regular Product 65% Off', discount: 65 };
  const result = computeFlashBadge(deal);
  assert(result.is_flash === true, 'is_flash should be true for deep discount');
  assert(
    result.flash_reason === 'deep_discount' || result.flash_reason === 'title_and_discount',
    `Unexpected reason: ${result.flash_reason}`
  );
});

test('computeFlashBadge: title flash + deep discount → reason=title_and_discount', () => {
  const deal   = { title: '⚡ Flash Sale NOW', discount: 75 };
  const result = computeFlashBadge(deal);
  assert(result.is_flash === true);
  assertEq(result.flash_reason, 'title_and_discount');
});

test('computeFlashBadge: null deal → is_flash false', () => {
  const result = computeFlashBadge(null);
  assert(result.is_flash === false);
});

test('computeFlashBadge: description has expiry → flash_expires_at set', () => {
  const now  = new Date('2026-01-01T10:00:00Z');
  const deal = { title: 'Flash Sale!', description: 'Ends in 5 hours', discount: 30 };
  const result = computeFlashBadge(deal, now);
  assert(result.is_flash === true);
  assert(result.flash_expires_at !== null, 'flash_expires_at should be set');
  const expiry = new Date(result.flash_expires_at);
  const diffH  = (expiry.getTime() - now.getTime()) / 3600000;
  assert(Math.abs(diffH - 5) < 0.01, `Expected ~5h, got ${diffH}h`);
});

// ══════════════════════════════
// formatCountdown
// ══════════════════════════════

test('formatCountdown: 2.5 hours → "2h 30m left"', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const expiry = new Date(now.getTime() + 2.5 * 3600000);
  assertEq(formatCountdown(expiry, now), '2h 30m left');
});

test('formatCountdown: exactly 1 hour → "1h left"', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const expiry = new Date(now.getTime() + 3600000);
  assertEq(formatCountdown(expiry, now), '1h left');
});

test('formatCountdown: 45 minutes → "45m left"', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const expiry = new Date(now.getTime() + 45 * 60000);
  assertEq(formatCountdown(expiry, now), '45m left');
});

test('formatCountdown: past date → "Expired"', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const expiry = new Date(now.getTime() - 3600000);
  assertEq(formatCountdown(expiry, now), 'Expired');
});

test('formatCountdown: ISO string input', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const expiry = new Date(now.getTime() + 2.5 * 3600000).toISOString();
  assertEq(formatCountdown(expiry, now), '2h 30m left');
});

test('formatCountdown: null → ""', () => {
  assertEq(formatCountdown(null), '');
});

// ══════════════════════════════
// isExpiredFlash
// ══════════════════════════════

test('isExpiredFlash: past date → true', () => {
  const now  = new Date('2026-01-01T10:00:00Z');
  const past = new Date(now.getTime() - 60000).toISOString();
  assert(isExpiredFlash(past, now) === true);
});

test('isExpiredFlash: future date → false', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const future = new Date(now.getTime() + 3600000).toISOString();
  assert(isExpiredFlash(future, now) === false);
});

test('isExpiredFlash: null → false', () => {
  assert(isExpiredFlash(null) === false);
});

test('isExpiredFlash: Date object past → true', () => {
  const now  = new Date('2026-01-01T10:00:00Z');
  const past = new Date(now.getTime() - 1);
  assert(isExpiredFlash(past, now) === true);
});

// ══════════════════════════════
// buildFlashBadgeText
// ══════════════════════════════

test('buildFlashBadgeText: with expiry → contains countdown', () => {
  const now    = new Date('2026-01-01T10:00:00Z');
  const expiry = new Date(now.getTime() + 3600000).toISOString();
  const badge  = buildFlashBadgeText(expiry, now);
  assert(badge.includes('⚡'), 'Should contain ⚡');
  assert(badge.includes('left'), 'Should contain "left"');
});

test('buildFlashBadgeText: no expiry → "⚡ Flash Sale"', () => {
  assertEq(buildFlashBadgeText(null), '⚡ Flash Sale');
});

// ══════════════════════════════
// Summary
// ══════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-53 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.log(`\nFailed tests:`);
  FAILED.forEach(t => console.log(`  ❌ ${t}`));
  process.exit(1);
}
