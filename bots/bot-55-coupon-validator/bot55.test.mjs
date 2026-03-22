// ════════════════════════════════════════════════════════════
// BOT-55 Tests — Coupon Validator
// הרצה: node bot55.test.mjs
// ════════════════════════════════════════════════════════════

import {
  normalizeCouponCode,
  isCouponExpired,
  detectCouponInText,
  scoreCoupon,
  formatCouponDisplay,
  isCouponValid,
} from './bot55.mjs';

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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label || ''}: expected ${e}, got ${a}`);
  }
}

// ════════════════════════════════════════════════════════════
// normalizeCouponCode
// ════════════════════════════════════════════════════════════

test('normalizeCouponCode: trims and uppercases', () => {
  assertEqual(normalizeCouponCode('save 20 '), 'SAVE20', 'normalize save20');
});

test('normalizeCouponCode: preserves dashes', () => {
  assertEqual(normalizeCouponCode('summer-sale'), 'SUMMER-SALE', 'preserve dash');
});

test('normalizeCouponCode: preserves underscores', () => {
  assertEqual(normalizeCouponCode('flash_50'), 'FLASH_50', 'preserve underscore');
});

test('normalizeCouponCode: removes special chars', () => {
  const result = normalizeCouponCode('SAVE!20@#');
  assert(!result.includes('!') && !result.includes('@') && !result.includes('#'), 'no special chars');
  assert(result.includes('SAVE') && result.includes('20'), 'keeps alphanumeric');
});

test('normalizeCouponCode: empty string returns empty', () => {
  assertEqual(normalizeCouponCode(''), '', 'empty');
});

test('normalizeCouponCode: null returns empty', () => {
  assertEqual(normalizeCouponCode(null), '', 'null input');
});

// ════════════════════════════════════════════════════════════
// isCouponExpired
// ════════════════════════════════════════════════════════════

test('isCouponExpired: past date → true', () => {
  const past = new Date(Date.now() - 1000 * 60 * 60 * 24);
  assert(isCouponExpired(past) === true, 'past date should be expired');
});

test('isCouponExpired: future date → false', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
  assert(isCouponExpired(future) === false, 'future date should not be expired');
});

test('isCouponExpired: null → false (no expiry = never expires)', () => {
  assert(isCouponExpired(null) === false, 'null expiry should not be expired');
});

test('isCouponExpired: undefined → false', () => {
  assert(isCouponExpired(undefined) === false, 'undefined expiry should not be expired');
});

test('isCouponExpired: string date in past → true', () => {
  assert(isCouponExpired('2020-01-01T00:00:00Z') === true, 'old string date expired');
});

// ════════════════════════════════════════════════════════════
// detectCouponInText
// ════════════════════════════════════════════════════════════

test('detectCouponInText: "Use code SAVE20 for 20% off" → [SAVE20]', () => {
  const result = detectCouponInText('Use code SAVE20 for 20% off');
  assert(result.includes('SAVE20'), `expected SAVE20, got ${JSON.stringify(result)}`);
});

test('detectCouponInText: "Coupon: SUMMER10" → [SUMMER10]', () => {
  const result = detectCouponInText('Coupon: SUMMER10');
  assert(result.includes('SUMMER10'), `expected SUMMER10, got ${JSON.stringify(result)}`);
});

test('detectCouponInText: "no coupon here" → []', () => {
  const result = detectCouponInText('no coupon here, big sale today');
  assertDeepEqual(result, [], 'no coupon patterns');
});

test('detectCouponInText: "promo code FLASH50 at checkout" → [FLASH50]', () => {
  const result = detectCouponInText('promo code FLASH50 at checkout');
  assert(result.includes('FLASH50'), `expected FLASH50, got ${JSON.stringify(result)}`);
});

test('detectCouponInText: "discount code EXTRA30" → [EXTRA30]', () => {
  const result = detectCouponInText('Apply discount code EXTRA30 to save more');
  assert(result.includes('EXTRA30'), `expected EXTRA30, got ${JSON.stringify(result)}`);
});

test('detectCouponInText: empty string → []', () => {
  assertDeepEqual(detectCouponInText(''), [], 'empty string');
});

test('detectCouponInText: null → []', () => {
  assertDeepEqual(detectCouponInText(null), [], 'null input');
});

// ════════════════════════════════════════════════════════════
// scoreCoupon
// ════════════════════════════════════════════════════════════

test('scoreCoupon: high discount + verified → high score', () => {
  const coupon = {
    discount_amount: 50,
    discount_type: 'percent',
    is_verified: true,
    is_active: true,
    uses_remaining: null,
    expires_at: null,
    created_at: new Date().toISOString(),
  };
  const score = scoreCoupon(coupon);
  assert(score >= 60, `expected score >= 60, got ${score}`);
});

test('scoreCoupon: expired → 0', () => {
  const coupon = {
    discount_amount: 50,
    discount_type: 'percent',
    is_verified: true,
    is_active: true,
    uses_remaining: null,
    expires_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    created_at: new Date().toISOString(),
  };
  assertEqual(scoreCoupon(coupon), 0, 'expired coupon score');
});

test('scoreCoupon: inactive → 0', () => {
  const coupon = {
    discount_amount: 50,
    discount_type: 'percent',
    is_verified: true,
    is_active: false,
    uses_remaining: null,
    expires_at: null,
    created_at: new Date().toISOString(),
  };
  assertEqual(scoreCoupon(coupon), 0, 'inactive coupon score');
});

test('scoreCoupon: no discount, not verified → low score', () => {
  const coupon = {
    discount_amount: 0,
    discount_type: 'percent',
    is_verified: false,
    is_active: true,
    uses_remaining: 5,
    expires_at: null,
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
  };
  const score = scoreCoupon(coupon);
  assert(score < 20, `expected low score, got ${score}`);
});

test('scoreCoupon: score is between 0 and 100', () => {
  const coupon = {
    discount_amount: 100,
    discount_type: 'percent',
    is_verified: true,
    is_active: true,
    uses_remaining: 1000,
    expires_at: null,
    created_at: new Date().toISOString(),
  };
  const score = scoreCoupon(coupon);
  assert(score >= 0 && score <= 100, `score out of range: ${score}`);
});

// ════════════════════════════════════════════════════════════
// formatCouponDisplay
// ════════════════════════════════════════════════════════════

test('formatCouponDisplay: includes code', () => {
  const coupon = { code: 'SAVE20', discount_amount: 20, discount_type: 'percent', is_verified: false, currency: 'USD' };
  const display = formatCouponDisplay(coupon);
  assert(display.includes('SAVE20'), `display should include code, got: ${display}`);
});

test('formatCouponDisplay: shows discount amount', () => {
  const coupon = { code: 'FLAT10', discount_amount: 10, discount_type: 'fixed', is_verified: false, currency: 'USD' };
  const display = formatCouponDisplay(coupon);
  assert(display.includes('10'), `display should include amount, got: ${display}`);
});

test('formatCouponDisplay: verified coupon shows verified badge', () => {
  const coupon = { code: 'VIP50', discount_amount: 50, discount_type: 'percent', is_verified: true, currency: 'USD' };
  const display = formatCouponDisplay(coupon);
  assert(display.includes('verified') || display.includes('✅'), `should show verified badge, got: ${display}`);
});

test('formatCouponDisplay: null coupon returns empty string', () => {
  assertEqual(formatCouponDisplay(null), '', 'null coupon');
});

// ════════════════════════════════════════════════════════════
// isCouponValid
// ════════════════════════════════════════════════════════════

test('isCouponValid: not expired + active → true', () => {
  const coupon = {
    is_active: true,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    uses_remaining: null,
  };
  assert(isCouponValid(coupon) === true, 'valid coupon should return true');
});

test('isCouponValid: expired → false', () => {
  const coupon = {
    is_active: true,
    expires_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    uses_remaining: null,
  };
  assert(isCouponValid(coupon) === false, 'expired coupon should return false');
});

test('isCouponValid: inactive → false', () => {
  const coupon = {
    is_active: false,
    expires_at: null,
    uses_remaining: null,
  };
  assert(isCouponValid(coupon) === false, 'inactive coupon should return false');
});

test('isCouponValid: uses_remaining = 0 → false', () => {
  const coupon = {
    is_active: true,
    expires_at: null,
    uses_remaining: 0,
  };
  assert(isCouponValid(coupon) === false, 'exhausted coupon should return false');
});

test('isCouponValid: null coupon → false', () => {
  assert(isCouponValid(null) === false, 'null coupon');
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-55 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.error(`\nFailed tests:\n${FAILED.map(t => `  - ${t}`).join('\n')}`);
  process.exit(1);
} else {
  console.log('All tests passed! ✅');
}
