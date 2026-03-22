// ════════════════════════════════════════════════════════════
// BOT-59 Tests — Social Proof
// הרצה: node bot59.test.mjs
// ════════════════════════════════════════════════════════════

import {
  seedRandom,
  generateViewCount,
  computeRecentViews,
  formatSocialProof,
  formatRecentBuyers,
  shouldShowSocialProof,
  clampCount,
  computeSocialProofText,
  hashSeed,
} from './bot59.mjs';

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
// seedRandom
// ══════════════════════════════

test('seedRandom: same seed → same result', () => {
  assertEq(seedRandom(12345), seedRandom(12345));
});

test('seedRandom: different seeds → different results', () => {
  const a = seedRandom(1);
  const b = seedRandom(2);
  assert(a !== b, `Expected different values, got ${a} and ${b}`);
});

test('seedRandom: result between 0 and 1', () => {
  const r = seedRandom(99999);
  assert(r >= 0 && r < 1, `Expected 0 ≤ r < 1, got ${r}`);
});

test('seedRandom: seed=0 → valid float', () => {
  const r = seedRandom(0);
  assert(typeof r === 'number' && !isNaN(r) && r >= 0 && r < 1);
});

// ══════════════════════════════
// generateViewCount
// ══════════════════════════════

test('generateViewCount: returns integer >= base (base=50, variance=5)', () => {
  // With variance ±5, result should be in [45, 55], but at least 1
  const result = generateViewCount(50, 5, 100);
  assert(Number.isInteger(result), `Expected integer, got ${result}`);
  assert(result >= 1, `Expected >= 1, got ${result}`);
});

test('generateViewCount: within expected variance range', () => {
  const base     = 100;
  const variance = 10;
  const result   = generateViewCount(base, variance, 42);
  assert(result >= base - variance && result <= base + variance,
    `Expected ${base} ± ${variance}, got ${result}`);
});

test('generateViewCount: base=0, variance=0 → 1 (minimum)', () => {
  const result = generateViewCount(0, 0, 1);
  assertEq(result, 1);
});

// ══════════════════════════════
// computeRecentViews
// ══════════════════════════════

test('computeRecentViews: 100 clicks → 800 views (8x)', () => {
  assertEq(computeRecentViews(100, 8), 800);
});

test('computeRecentViews: 0 clicks → 0', () => {
  assertEq(computeRecentViews(0), 0);
});

test('computeRecentViews: null clicks → 0', () => {
  assertEq(computeRecentViews(null), 0);
});

test('computeRecentViews: custom multiplier 5', () => {
  assertEq(computeRecentViews(20, 5), 100);
});

// ══════════════════════════════
// formatSocialProof
// ══════════════════════════════

test('formatSocialProof: 23 views → correct string', () => {
  const result = formatSocialProof(23);
  assertEq(result, '23 people viewed this in the last hour');
});

test('formatSocialProof: 1 view → "1 person viewed..."', () => {
  const result = formatSocialProof(1);
  assertEq(result, '1 person viewed this in the last hour');
});

test('formatSocialProof: 0 → treated as 1 (minimum)', () => {
  const result = formatSocialProof(0);
  assertEq(result, '1 person viewed this in the last hour');
});

test('formatSocialProof: custom time window', () => {
  const result = formatSocialProof(5, 'the last 30 minutes');
  assertEq(result, '5 people viewed this in the last 30 minutes');
});

// ══════════════════════════════
// formatRecentBuyers
// ══════════════════════════════

test('formatRecentBuyers: 5 → "5 bought this today"', () => {
  assertEq(formatRecentBuyers(5), '5 bought this today');
});

test('formatRecentBuyers: 0 → "0 bought this today"', () => {
  assertEq(formatRecentBuyers(0), '0 bought this today');
});

test('formatRecentBuyers: 12 → correct string', () => {
  assertEq(formatRecentBuyers(12), '12 bought this today');
});

// ══════════════════════════════
// shouldShowSocialProof
// ══════════════════════════════

test('shouldShowSocialProof: score=60, status=active → true', () => {
  assert(shouldShowSocialProof({ score: 60, status: 'active' }) === true);
});

test('shouldShowSocialProof: score=40 → false', () => {
  assert(shouldShowSocialProof({ score: 40, status: 'active' }) === false);
});

test('shouldShowSocialProof: score=50, status=expired → false', () => {
  assert(shouldShowSocialProof({ score: 50, status: 'expired' }) === false);
});

test('shouldShowSocialProof: score=50, status=active → true (boundary)', () => {
  assert(shouldShowSocialProof({ score: 50, status: 'active' }) === true);
});

test('shouldShowSocialProof: null → false', () => {
  assert(shouldShowSocialProof(null) === false);
});

// ══════════════════════════════
// clampCount
// ══════════════════════════════

test('clampCount: 150, min=1, max=100 → 100', () => {
  assertEq(clampCount(150, 1, 100), 100);
});

test('clampCount: -5, min=1, max=100 → 1', () => {
  assertEq(clampCount(-5, 1, 100), 1);
});

test('clampCount: 50, min=1, max=100 → 50 (in range)', () => {
  assertEq(clampCount(50, 1, 100), 50);
});

// ══════════════════════════════
// computeSocialProofText
// ══════════════════════════════

test('computeSocialProofText: qualifying deal → returns string', () => {
  const deal   = { id: 'deal-abc-123', score: 75, status: 'active' };
  const result = computeSocialProofText(deal, 50);
  assert(typeof result === 'string' && result.length > 0, `Expected non-empty string, got ${JSON.stringify(result)}`);
  assert(result.includes('viewed'), `Expected "viewed" in: ${result}`);
});

test('computeSocialProofText: score < 50 → null', () => {
  const deal   = { id: 'deal-xyz', score: 30, status: 'active' };
  const result = computeSocialProofText(deal, 100);
  assertEq(result, null);
});

test('computeSocialProofText: 0 clicks → still returns string based on score', () => {
  const deal   = { id: 'deal-no-clicks', score: 80, status: 'active' };
  const result = computeSocialProofText(deal, 0);
  assert(result !== null && result.includes('viewed'), `Got: ${result}`);
});

// ════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-59: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.error(`\nFailed tests: ${FAILED.join(', ')}`);
  process.exit(1);
}
