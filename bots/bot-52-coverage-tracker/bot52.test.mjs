// bot52.test.mjs — בדיקות יחידה ל-BOT-52 Coverage Tracker
// הרץ: node bot52.test.mjs
// ════════════════════════════════════════════════════════════

import {
  computeCoverageScore,
  classifyCoverage,
  detectWeakCategories,
  detectMissingCategories,
  buildCoverageReport,
  prioritizeCategories,
  MIN_DEALS_THRESHOLD,
  TARGET_DEALS,
  WEAK_SCORE_THRESHOLD,
  EXPECTED_CATEGORIES,
} from './bot52.mjs';

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
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ════════════════════════════════════════════════════════════
// 1. computeCoverageScore
// ════════════════════════════════════════════════════════════

test('computeCoverageScore: 1000 deals → 100', () => {
  assertEq(computeCoverageScore(1000, 1000), 100);
});

test('computeCoverageScore: 500 deals → 50', () => {
  assertEq(computeCoverageScore(500, 1000), 50);
});

test('computeCoverageScore: 0 deals → 0', () => {
  assertEq(computeCoverageScore(0, 1000), 0);
});

test('computeCoverageScore: target=0 → 0', () => {
  assertEq(computeCoverageScore(100, 0), 0);
});

test('computeCoverageScore: over-target → capped at 100', () => {
  assertEq(computeCoverageScore(2000, 1000), 100);
});

// ════════════════════════════════════════════════════════════
// 2. classifyCoverage
// ════════════════════════════════════════════════════════════

test('classifyCoverage: 90 → excellent', () => {
  assertEq(classifyCoverage(90), 'excellent');
});

test('classifyCoverage: 60 → good', () => {
  assertEq(classifyCoverage(60), 'good');
});

test('classifyCoverage: 35 → weak', () => {
  assertEq(classifyCoverage(35), 'weak');
});

test('classifyCoverage: 10 → critical', () => {
  assertEq(classifyCoverage(10), 'critical');
});

test('classifyCoverage: 0 → missing', () => {
  assertEq(classifyCoverage(0), 'missing');
});

// ════════════════════════════════════════════════════════════
// 3. detectWeakCategories
// ════════════════════════════════════════════════════════════

const sampleCounts = [
  { category: 'fashion',     count: 500 },
  { category: 'electronics', count: 80  },
  { category: 'home',        count: 20  },
  { category: 'beauty',      count: 150 },
];

test('detectWeakCategories: finds categories below threshold', () => {
  const weak = detectWeakCategories(sampleCounts, 100);
  assert(weak.length === 2, `expected 2 weak, got ${weak.length}`);
  assert(weak.some(w => w.category === 'electronics'));
  assert(weak.some(w => w.category === 'home'));
});

test('detectWeakCategories: sorted by count ascending', () => {
  const weak = detectWeakCategories(sampleCounts, 100);
  assertEq(weak[0].category, 'home'); // 20 < 80
});

test('detectWeakCategories: includes score and status', () => {
  const weak = detectWeakCategories(sampleCounts, 100);
  assert('score' in weak[0]);
  assert('status' in weak[0]);
});

test('detectWeakCategories: empty array → empty result', () => {
  assertEq(detectWeakCategories([]).length, 0);
});

// ════════════════════════════════════════════════════════════
// 4. detectMissingCategories
// ════════════════════════════════════════════════════════════

test('detectMissingCategories: finds missing ones', () => {
  const existing = ['fashion', 'electronics', 'home'];
  const expected = ['fashion', 'electronics', 'home', 'beauty', 'sports'];
  const missing  = detectMissingCategories(existing, expected);
  assertEq(missing.length, 2);
  assert(missing.includes('beauty'));
  assert(missing.includes('sports'));
});

test('detectMissingCategories: case-insensitive', () => {
  const existing = ['Fashion', 'ELECTRONICS'];
  const expected = ['fashion', 'electronics', 'home'];
  const missing  = detectMissingCategories(existing, expected);
  assertEq(missing.length, 1);
  assertEq(missing[0], 'home');
});

test('detectMissingCategories: nothing missing → empty array', () => {
  const cats = ['fashion', 'electronics'];
  assertEq(detectMissingCategories(cats, cats).length, 0);
});

// ════════════════════════════════════════════════════════════
// 5. buildCoverageReport
// ════════════════════════════════════════════════════════════

test('buildCoverageReport: returns full structure', () => {
  const report = buildCoverageReport(sampleCounts);
  assert('summary' in report);
  assert('weak' in report);
  assert('missing' in report);
  assert('overall_score' in report);
  assert('generated_at' in report);
});

test('buildCoverageReport: summary totals correct', () => {
  const report = buildCoverageReport(sampleCounts);
  assertEq(report.summary.total_deals, 500 + 80 + 20 + 150);
  assertEq(report.summary.total_cats, 4);
});

test('buildCoverageReport: overall_score 0-100', () => {
  const report = buildCoverageReport(sampleCounts);
  assert(report.overall_score >= 0 && report.overall_score <= 100,
    `overall_score out of range: ${report.overall_score}`);
});

// ════════════════════════════════════════════════════════════
// 6. prioritizeCategories
// ════════════════════════════════════════════════════════════

test('prioritizeCategories: lower score first', () => {
  const weak = [
    { category: 'home',   count: 20,  score: 2  },
    { category: 'sports', count: 50,  score: 5  },
    { category: 'kids',   count: 90,  score: 9  },
  ];
  const p = prioritizeCategories(weak);
  assertEq(p[0].category, 'home');
  assertEq(p[2].category, 'kids');
});

test('prioritizeCategories: does not mutate original', () => {
  const weak = [
    { category: 'a', count: 10, score: 1 },
    { category: 'b', count: 20, score: 2 },
  ];
  const original = [...weak];
  prioritizeCategories(weak);
  assertEq(weak[0].category, original[0].category);
});

// ════════════════════════════════════════════════════════════
// 7. constants
// ════════════════════════════════════════════════════════════

test('MIN_DEALS_THRESHOLD is 100', () => {
  assertEq(MIN_DEALS_THRESHOLD, 100);
});

test('TARGET_DEALS is 1000', () => {
  assertEq(TARGET_DEALS, 1000);
});

test('WEAK_SCORE_THRESHOLD is 30', () => {
  assertEq(WEAK_SCORE_THRESHOLD, 30);
});

test('EXPECTED_CATEGORIES includes fashion and electronics', () => {
  assert(EXPECTED_CATEGORIES.includes('fashion'));
  assert(EXPECTED_CATEGORIES.includes('electronics'));
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-52 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) process.exit(1);
