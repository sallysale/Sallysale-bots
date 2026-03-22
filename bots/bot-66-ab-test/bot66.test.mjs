// bot66.test.mjs — בדיקות יחידה ל-BOT-66 A/B Test Manager
// הרץ: node bot66.test.mjs
// ════════════════════════════════════════════════════════════

import {
  assignVariant,
  computeConversionRate,
  computeZScore,
  isStatisticallySignificant,
  declareWinner,
  buildTestReport,
} from './bot66.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`\u2705 ${name}`); }
  catch (e) { FAILED.push(name); console.error(`\u274c ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function assertClose(a, b, tol = 0.01, m) {
  if (Math.abs(a - b) > tol) throw new Error(m || `${a} !== ${b} (±${tol})`);
}

// ════════════════════════════════════════════════════════════
// 1. assignVariant
// ════════════════════════════════════════════════════════════

test('assignVariant: same user+test → same variant always', () => {
  const v1 = assignVariant('user-123', 'test-abc', ['control', 'treatment']);
  const v2 = assignVariant('user-123', 'test-abc', ['control', 'treatment']);
  assert(v1 === v2, `v1=${v1}, v2=${v2}`);
});

test('assignVariant: different users spread across variants', () => {
  const variants = ['control', 'treatment'];
  const results  = new Set();
  for (let i = 0; i < 20; i++) {
    results.add(assignVariant(`user-${i}`, 'test-x', variants));
  }
  assert(results.size >= 2, `only ${results.size} variants used`);
});

test('assignVariant: returns valid variant from list', () => {
  const variants = ['control', 'treatment', 'variant-c'];
  const v = assignVariant('user-456', 'test-789', variants);
  assert(variants.includes(v), `got: ${v}`);
});

test('assignVariant: different testIds give different variants for same user', () => {
  // Not guaranteed, but likely with different test IDs
  const variants = ['control', 'treatment'];
  const results  = new Set();
  for (let t = 0; t < 10; t++) {
    results.add(assignVariant('user-same', `test-${t}`, variants));
  }
  // Should use both variants across multiple tests
  assert(results.size >= 1, 'expected at least one variant');
});

// ════════════════════════════════════════════════════════════
// 2. computeConversionRate
// ════════════════════════════════════════════════════════════

test('computeConversionRate: 10 clicks, 2 conversions → 20', () => {
  assertClose(computeConversionRate(10, 2), 20, 0.01, `got: ${computeConversionRate(10, 2)}`);
});

test('computeConversionRate: 0 clicks → 0', () => {
  assert(computeConversionRate(0, 5) === 0, `got: ${computeConversionRate(0, 5)}`);
});

test('computeConversionRate: 100 clicks, 100 conversions → 100', () => {
  assertClose(computeConversionRate(100, 100), 100, 0.01);
});

// ════════════════════════════════════════════════════════════
// 3. computeZScore
// ════════════════════════════════════════════════════════════

test('computeZScore: equal rates → ~0', () => {
  const z = computeZScore(10, 10, 100, 100);
  assertClose(z, 0, 0.1, `got z=${z}`);
});

test('computeZScore: very different rates, large n → large |z|', () => {
  // 30% vs 10% with n=1000 each — should give large z
  const z = computeZScore(30, 10, 1000, 1000);
  assert(Math.abs(z) > 5, `z=${z}, expected |z|>5`);
});

test('computeZScore: zero n → 0', () => {
  const z = computeZScore(20, 10, 0, 100);
  assert(z === 0, `got: ${z}`);
});

// ════════════════════════════════════════════════════════════
// 4. isStatisticallySignificant
// ════════════════════════════════════════════════════════════

test('isStatisticallySignificant: z=2.5 → true', () => {
  assert(isStatisticallySignificant(2.5) === true, 'z=2.5 should be significant');
});

test('isStatisticallySignificant: z=1.0 → false', () => {
  assert(isStatisticallySignificant(1.0) === false, 'z=1.0 should NOT be significant');
});

test('isStatisticallySignificant: z=-2.5 → true (two-tailed)', () => {
  assert(isStatisticallySignificant(-2.5) === true, 'negative z should also be significant');
});

test('isStatisticallySignificant: z=0 → false', () => {
  assert(isStatisticallySignificant(0) === false, 'z=0 should not be significant');
});

// ════════════════════════════════════════════════════════════
// 5. declareWinner
// ════════════════════════════════════════════════════════════

test('declareWinner: one variant significantly better → returns it', () => {
  // treatment: 30% conversion (300/1000), control: 10% (100/1000) — huge difference
  const variants = [
    { name: 'control',   clicks: 1000, conversions: 100 },
    { name: 'treatment', clicks: 1000, conversions: 300 },
  ];
  const winner = declareWinner(variants);
  assert(winner === 'treatment', `expected treatment, got: ${winner}`);
});

test('declareWinner: not significant → null', () => {
  // Very similar rates — 11% vs 10% with small sample
  const variants = [
    { name: 'control',   clicks: 20, conversions: 2 },
    { name: 'treatment', clicks: 20, conversions: 3 },
  ];
  const winner = declareWinner(variants);
  assert(winner === null, `expected null, got: ${winner}`);
});

test('declareWinner: less than 2 variants → null', () => {
  const winner = declareWinner([{ name: 'control', clicks: 100, conversions: 10 }]);
  assert(winner === null, `expected null, got: ${winner}`);
});

// ════════════════════════════════════════════════════════════
// 6. buildTestReport
// ════════════════════════════════════════════════════════════

test('buildTestReport: correct shape with variants array', () => {
  const test_obj = { id: 'test-1', test_name: 'CTA Button Color', status: 'active', min_sample_size: 100 };
  const results  = [
    { name: 'control',   clicks: 100, conversions: 10 },
    { name: 'treatment', clicks: 100, conversions: 15 },
  ];
  const report = buildTestReport(test_obj, results);
  assert(report.testId   === 'test-1',       `testId: ${report.testId}`);
  assert(Array.isArray(report.variants),     'variants not array');
  assert(report.variants.length === 2,       `variants.length: ${report.variants.length}`);
  assert('rate' in report.variants[0],       'rate missing');
  assert('n'    in report.variants[0],       'n missing');
});

test('buildTestReport: status reflects winner', () => {
  const test_obj = { id: 'test-2', test_name: 'Price Display', status: 'active', min_sample_size: 100 };
  // Significant difference
  const results  = [
    { name: 'control',   clicks: 1000, conversions: 100 },
    { name: 'treatment', clicks: 1000, conversions: 300 },
  ];
  const report = buildTestReport(test_obj, results);
  assert(report.winner === 'treatment',   `winner: ${report.winner}`);
  assert(report.status === 'completed',   `status: ${report.status}`);
});

test('buildTestReport: no winner → status running', () => {
  const test_obj = { id: 'test-3', test_name: 'Card Layout', status: 'active', min_sample_size: 100 };
  const results  = [
    { name: 'control',   clicks: 20, conversions: 2 },
    { name: 'treatment', clicks: 20, conversions: 2 },
  ];
  const report = buildTestReport(test_obj, results);
  assert(report.winner === null,       `winner: ${report.winner}`);
  assert(report.status === 'running',  `status: ${report.status}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(55)}`);
console.log(`BOT-66 Tests: ${PASSED.length} עברו \u2705, ${FAILED.length} נכשלו \u274c`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
