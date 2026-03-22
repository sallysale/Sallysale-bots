// ════════════════════════════════════════════════════════════
// BOT-54 Tests — Stock Monitor
// הרצה: node bot54.test.mjs
// ════════════════════════════════════════════════════════════

import {
  detectLowStock,
  parseStockCount,
  classifyStockLevel,
  buildStockBadge,
  isStockCritical,
  shouldBoostScore,
  analyzeStockFromText,
} from './bot54.mjs';

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
// detectLowStock
// ══════════════════════════════

test('detectLowStock: "Only 5 left in stock" → true', () => {
  assert(detectLowStock('Only 5 left in stock') === true);
});

test('detectLowStock: "Plenty available" → false', () => {
  assert(detectLowStock('Plenty available, ships today') === false);
});

test('detectLowStock: "Last 2 items" → true', () => {
  assert(detectLowStock('Last 2 items remaining — order now!') === true);
});

test('detectLowStock: "Selling fast!" → true', () => {
  assert(detectLowStock('Selling fast! 1000+ sold this week') === true);
});

test('detectLowStock: "100 items in stock" → false (plenty, not low)', () => {
  assert(detectLowStock('100 items in stock') === false);
});

test('detectLowStock: "Limited stock" → true', () => {
  assert(detectLowStock('Limited stock available') === true);
});

test('detectLowStock: "Almost gone" → true', () => {
  assert(detectLowStock('Almost gone — grab yours now!') === true);
});

test('detectLowStock: "3 remaining" → true', () => {
  assert(detectLowStock('3 remaining in our warehouse') === true);
});

test('detectLowStock: null → false', () => {
  assert(detectLowStock(null) === false);
});

test('detectLowStock: "" → false', () => {
  assert(detectLowStock('') === false);
});

test('detectLowStock: "50 items available" → false (medium)', () => {
  assert(detectLowStock('50 items available') === false);
});

test('detectLowStock: "Only 1 left!" → true', () => {
  assert(detectLowStock('Only 1 left!') === true);
});

// ══════════════════════════════
// parseStockCount
// ══════════════════════════════

test('parseStockCount: "Only 5 left" → 5', () => {
  assertEq(parseStockCount('Only 5 left'), 5);
});

test('parseStockCount: "3 remaining" → 3', () => {
  assertEq(parseStockCount('3 remaining in stock'), 3);
});

test('parseStockCount: "limited stock" → null (no number)', () => {
  assertEq(parseStockCount('limited stock available'), null);
});

test('parseStockCount: "Last 2 items" → 2', () => {
  assertEq(parseStockCount('Last 2 items available'), 2);
});

test('parseStockCount: "only 1 left in stock" → 1', () => {
  assertEq(parseStockCount('only 1 left in stock'), 1);
});

test('parseStockCount: "10 units remaining" → 10', () => {
  assertEq(parseStockCount('10 units remaining'), 10);
});

test('parseStockCount: null → null', () => {
  assertEq(parseStockCount(null), null);
});

test('parseStockCount: "no stock info" → null', () => {
  assertEq(parseStockCount('no stock info here'), null);
});

// ══════════════════════════════
// classifyStockLevel
// ══════════════════════════════

test('classifyStockLevel: 2 → "critical"', () => {
  assertEq(classifyStockLevel(2), 'critical');
});

test('classifyStockLevel: 3 → "critical"', () => {
  assertEq(classifyStockLevel(3), 'critical');
});

test('classifyStockLevel: 4 → "low"', () => {
  assertEq(classifyStockLevel(4), 'low');
});

test('classifyStockLevel: 8 → "low"', () => {
  assertEq(classifyStockLevel(8), 'low');
});

test('classifyStockLevel: 10 → "low"', () => {
  assertEq(classifyStockLevel(10), 'low');
});

test('classifyStockLevel: 11 → "medium"', () => {
  assertEq(classifyStockLevel(11), 'medium');
});

test('classifyStockLevel: 25 → "medium"', () => {
  assertEq(classifyStockLevel(25), 'medium');
});

test('classifyStockLevel: 50 → "medium"', () => {
  assertEq(classifyStockLevel(50), 'medium');
});

test('classifyStockLevel: 100 → "plenty"', () => {
  assertEq(classifyStockLevel(100), 'plenty');
});

test('classifyStockLevel: 51 → "plenty"', () => {
  assertEq(classifyStockLevel(51), 'plenty');
});

test('classifyStockLevel: null → "unknown"', () => {
  assertEq(classifyStockLevel(null), 'unknown');
});

test('classifyStockLevel: undefined → "unknown"', () => {
  assertEq(classifyStockLevel(undefined), 'unknown');
});

test('classifyStockLevel: 1 → "critical"', () => {
  assertEq(classifyStockLevel(1), 'critical');
});

// ══════════════════════════════
// buildStockBadge
// ══════════════════════════════

test('buildStockBadge: critical with count 3 → contains "3"', () => {
  const badge = buildStockBadge('critical', 3);
  assert(badge.includes('3'), `Badge should contain "3": ${badge}`);
  assert(badge.includes('🔥'), `Badge should contain 🔥: ${badge}`);
});

test('buildStockBadge: critical without count → "🔥 Almost gone!"', () => {
  assertEq(buildStockBadge('critical', null), '🔥 Almost gone!');
});

test('buildStockBadge: low with count 7 → contains "7"', () => {
  const badge = buildStockBadge('low', 7);
  assert(badge.includes('7'), `Badge should contain "7": ${badge}`);
  assert(badge.includes('⚡'), `Badge should contain ⚡: ${badge}`);
});

test('buildStockBadge: low without count → "⚡ Low stock"', () => {
  assertEq(buildStockBadge('low', null), '⚡ Low stock');
});

test('buildStockBadge: medium → "📦 Low stock"', () => {
  assertEq(buildStockBadge('medium', 20), '📦 Low stock');
});

test('buildStockBadge: plenty → ""', () => {
  assertEq(buildStockBadge('plenty', 200), '');
});

test('buildStockBadge: unknown → ""', () => {
  assertEq(buildStockBadge('unknown', null), '');
});

// ══════════════════════════════
// isStockCritical
// ══════════════════════════════

test('isStockCritical: "critical" → true', () => {
  assert(isStockCritical('critical') === true);
});

test('isStockCritical: "low" → false', () => {
  assert(isStockCritical('low') === false);
});

test('isStockCritical: "unknown" → false', () => {
  assert(isStockCritical('unknown') === false);
});

test('isStockCritical: "plenty" → false', () => {
  assert(isStockCritical('plenty') === false);
});

// ══════════════════════════════
// shouldBoostScore
// ══════════════════════════════

test('shouldBoostScore: "critical" → true', () => {
  assert(shouldBoostScore('critical') === true);
});

test('shouldBoostScore: "low" → true', () => {
  assert(shouldBoostScore('low') === true);
});

test('shouldBoostScore: "medium" → false', () => {
  assert(shouldBoostScore('medium') === false);
});

test('shouldBoostScore: "plenty" → false', () => {
  assert(shouldBoostScore('plenty') === false);
});

test('shouldBoostScore: "unknown" → false', () => {
  assert(shouldBoostScore('unknown') === false);
});

// ══════════════════════════════
// analyzeStockFromText
// ══════════════════════════════

test('analyzeStockFromText: "Only 3 left in stock" → critical', () => {
  const result = analyzeStockFromText('Only 3 left in stock');
  assertEq(result.stock_count, 3);
  assertEq(result.stock_status, 'critical');
  assert(result.stock_badge.includes('3'), `Badge should contain "3": ${result.stock_badge}`);
});

test('analyzeStockFromText: "Plenty available" → unknown, no badge', () => {
  const result = analyzeStockFromText('Plenty available in all sizes');
  assertEq(result.stock_status, 'unknown');
  assertEq(result.stock_badge, '');
});

test('analyzeStockFromText: "limited stock" → low, no specific count', () => {
  const result = analyzeStockFromText('Limited stock available — order now');
  assertEq(result.stock_status, 'low');
  assertEq(result.stock_count, null);
});

// ══════════════════════════════
// Summary
// ══════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-54 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.log(`\nFailed tests:`);
  FAILED.forEach(t => console.log(`  ❌ ${t}`));
  process.exit(1);
}
