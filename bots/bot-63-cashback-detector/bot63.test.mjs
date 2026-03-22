// bot63.test.mjs — בדיקות יחידה ל-BOT-63 Cashback Detector
// הרץ: node bot63.test.mjs
// ════════════════════════════════════════════════════════════

import {
  detectCashback,
  parseCashbackAmount,
  normalizeCashbackType,
  computeEffectiveDiscount,
  formatCashbackBadge,
  isCashbackValid,
} from './bot63.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ════════════════════════════════════════════════════════════
// 1. detectCashback
// ════════════════════════════════════════════════════════════

test('detectCashback: "10% cashback on all orders" → true', () => {
  assert(detectCashback('10% cashback on all orders') === true, 'expected true');
});

test('detectCashback: "Get $5 back on purchase" → true', () => {
  assert(detectCashback('Get $5 back on purchase') === true, 'expected true');
});

test('detectCashback: "Earn 2% reward points" → true', () => {
  assert(detectCashback('Earn 2% reward points') === true, 'expected true');
});

test('detectCashback: "50% off Nike shoes" → false (no cashback keyword)', () => {
  assert(detectCashback('50% off Nike shoes') === false, 'expected false');
});

test('detectCashback: cashback in description only → true', () => {
  assert(detectCashback('Nike Air Max', '5% cash back on this order') === true, 'expected true');
});

// ════════════════════════════════════════════════════════════
// 2. parseCashbackAmount
// ════════════════════════════════════════════════════════════

test('parseCashbackAmount: "10% cashback" → { amount: 10, type: percent }', () => {
  const result = parseCashbackAmount('10% cashback');
  assert(result !== null, 'expected non-null');
  assert(result.amount === 10, `expected amount=10, got: ${result.amount}`);
  assert(result.type === 'percent', `expected percent, got: ${result.type}`);
});

test('parseCashbackAmount: "$5 cash back" → { amount: 5, type: fixed }', () => {
  const result = parseCashbackAmount('$5 cash back');
  assert(result !== null, 'expected non-null');
  assert(result.amount === 5, `expected amount=5, got: ${result.amount}`);
  assert(result.type === 'fixed', `expected fixed, got: ${result.type}`);
});

test('parseCashbackAmount: "earn 3% back" → { amount: 3, type: percent }', () => {
  const result = parseCashbackAmount('earn 3% back');
  assert(result !== null, 'expected non-null');
  assert(result.amount === 3, `expected amount=3, got: ${result.amount}`);
  assert(result.type === 'percent', `expected percent, got: ${result.type}`);
});

test('parseCashbackAmount: "no amount here" → null', () => {
  const result = parseCashbackAmount('no amount here');
  assert(result === null, `expected null, got: ${JSON.stringify(result)}`);
});

// ════════════════════════════════════════════════════════════
// 3. normalizeCashbackType
// ════════════════════════════════════════════════════════════

test('normalizeCashbackType: "percent" → "percent"', () => {
  assert(normalizeCashbackType('percent') === 'percent', `got: ${normalizeCashbackType('percent')}`);
});

test('normalizeCashbackType: "reward points" → "points"', () => {
  assert(normalizeCashbackType('reward points') === 'points', `got: ${normalizeCashbackType('reward points')}`);
});

test('normalizeCashbackType: "fixed" → "fixed"', () => {
  assert(normalizeCashbackType('fixed') === 'fixed', `got: ${normalizeCashbackType('fixed')}`);
});

test('normalizeCashbackType: unknown input → "unknown"', () => {
  assert(normalizeCashbackType('foobar') === 'unknown', `got: ${normalizeCashbackType('foobar')}`);
});

// ════════════════════════════════════════════════════════════
// 4. computeEffectiveDiscount
// ════════════════════════════════════════════════════════════

test('computeEffectiveDiscount: 20% sale + 10% cashback → 28% effective', () => {
  const result = computeEffectiveDiscount(20, 10);
  // 1 - (0.8 * 0.9) = 1 - 0.72 = 0.28 = 28%
  assert(Math.abs(result - 28) < 0.1, `expected ~28, got: ${result}`);
});

test('computeEffectiveDiscount: 0% sale + 0% cashback → 0%', () => {
  assert(computeEffectiveDiscount(0, 0) === 0, `got: ${computeEffectiveDiscount(0, 0)}`);
});

test('computeEffectiveDiscount: 50% sale + 0% cashback → 50%', () => {
  const result = computeEffectiveDiscount(50, 0);
  assert(Math.abs(result - 50) < 0.1, `expected ~50, got: ${result}`);
});

// ════════════════════════════════════════════════════════════
// 5. formatCashbackBadge
// ════════════════════════════════════════════════════════════

test('formatCashbackBadge: 10, percent → contains "10% Cashback"', () => {
  const badge = formatCashbackBadge(10, 'percent');
  assert(badge.includes('10%'), `expected 10%, got: ${badge}`);
  assert(badge.includes('Cashback'), `expected Cashback, got: ${badge}`);
});

test('formatCashbackBadge: 5, fixed → contains "$5 Back"', () => {
  const badge = formatCashbackBadge(5, 'fixed');
  assert(badge.includes('$5'), `expected $5, got: ${badge}`);
  assert(badge.includes('Back'), `expected Back, got: ${badge}`);
});

// ════════════════════════════════════════════════════════════
// 6. isCashbackValid
// ════════════════════════════════════════════════════════════

test('isCashbackValid: amount=10, no expiry → true', () => {
  assert(isCashbackValid({ amount: 10 }) === true, 'expected true');
});

test('isCashbackValid: amount=0 → false', () => {
  assert(isCashbackValid({ amount: 0 }) === false, 'expected false for amount=0');
});

test('isCashbackValid: expired → false', () => {
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  assert(isCashbackValid({ amount: 10, expires_at: pastDate }) === false, 'expected false for expired');
});

test('isCashbackValid: future expiry → true', () => {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  assert(isCashbackValid({ amount: 5, expires_at: futureDate }) === true, 'expected true for future expiry');
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-63 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
