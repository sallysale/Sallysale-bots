// bot45.test.mjs — unit tests for BOT-45 Demand Tracker
// No DB, no HTTP — pure functions only.

import {
  aggregateByDeal,
  aggregateByCategory,
  computeTrendScore,
  normalizeTrendScore,
  rankItems,
  buildDemandStats,
} from './bot45.mjs';

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

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─── aggregateByDeal ─────────────────────────────────────

test("aggregateByDeal: empty array returns []", () => {
  const result = aggregateByDeal([]);
  assert(Array.isArray(result) && result.length === 0);
});

test("aggregateByDeal: groups correctly by deal_id", () => {
  const clicks = [
    { deal_id: 'd1' },
    { deal_id: 'd1' },
    { deal_id: 'd2' },
  ];
  const result = aggregateByDeal(clicks);
  const d1 = result.find(r => r.deal_id === 'd1');
  const d2 = result.find(r => r.deal_id === 'd2');
  assertEqual(d1.count, 2);
  assertEqual(d2.count, 1);
});

test("aggregateByDeal: sorts by count DESC", () => {
  const clicks = [
    { deal_id: 'low'  },
    { deal_id: 'high' },
    { deal_id: 'high' },
    { deal_id: 'high' },
    { deal_id: 'mid'  },
    { deal_id: 'mid'  },
  ];
  const result = aggregateByDeal(clicks);
  assertEqual(result[0].deal_id, 'high');
  assertEqual(result[1].deal_id, 'mid');
  assertEqual(result[2].deal_id, 'low');
});

test("aggregateByDeal: skips rows without deal_id", () => {
  const clicks = [
    { deal_id: 'd1' },
    { },             // no deal_id
    { deal_id: null },
  ];
  const result = aggregateByDeal(clicks);
  assertEqual(result.length, 1);
  assertEqual(result[0].deal_id, 'd1');
});

// ─── aggregateByCategory ─────────────────────────────────

test("aggregateByCategory: groups by category", () => {
  const deals = new Map([
    ['d1', 'fashion'],
    ['d2', 'fashion'],
    ['d3', 'electronics'],
  ]);
  const clicks = [
    { deal_id: 'd1' },
    { deal_id: 'd2' },
    { deal_id: 'd3' },
    { deal_id: 'd3' },
  ];
  const result = aggregateByCategory(deals, clicks);
  const fashion = result.find(r => r.category === 'fashion');
  const elec    = result.find(r => r.category === 'electronics');
  assertEqual(fashion.count, 2);
  assertEqual(elec.count, 2);
});

test("aggregateByCategory: handles unknown category", () => {
  const deals  = new Map(); // empty
  const clicks = [{ deal_id: 'd_unknown' }];
  const result = aggregateByCategory(deals, clicks);
  assertEqual(result.length, 1);
  assertEqual(result[0].category, 'unknown');
});

test("aggregateByCategory: accepts array of deals", () => {
  const deals  = [{ id: 'd1', category: 'beauty' }];
  const clicks = [{ deal_id: 'd1' }, { deal_id: 'd1' }];
  const result = aggregateByCategory(deals, clicks);
  assertEqual(result[0].category, 'beauty');
  assertEqual(result[0].count, 2);
});

test("aggregateByCategory: empty clicks returns []", () => {
  const result = aggregateByCategory(new Map(), []);
  assert(Array.isArray(result) && result.length === 0);
});

// ─── computeTrendScore ───────────────────────────────────

test("computeTrendScore: both zero → returns 0", () => {
  assertEqual(computeTrendScore(0, 0), 0);
});

test("computeTrendScore: zero historical → returns recent", () => {
  const score = computeTrendScore(5, 0);
  assertEqual(score, 5);
});

test("computeTrendScore: recent > expected → score > 50", () => {
  // expected = 30 * (7/30) = 7 clicks
  // recent = 21 = 3x expected → raw = (21/7)*50 = 150 → normalized → 100
  const score = computeTrendScore(21, 30);
  assert(score > 50, `Expected score > 50, got ${score}`);
});

test("computeTrendScore: recent == expected → score around 50", () => {
  // expected = 30 * (7/30) = 7; recent = 7 → raw = (7/7)*50 = 50
  const score = computeTrendScore(7, 30);
  assert(Math.abs(score - 50) < 1, `Expected ~50, got ${score}`);
});

test("computeTrendScore: recent < expected → score < 50", () => {
  // expected = 30 * (7/30) = 7; recent = 1 → raw = (1/7)*50 ≈ 7.1
  const score = computeTrendScore(1, 30);
  assert(score < 50, `Expected score < 50, got ${score}`);
});

// ─── normalizeTrendScore ─────────────────────────────────

test("normalizeTrendScore: clamps at 0 for negative", () => {
  assertEqual(normalizeTrendScore(-10), 0);
});

test("normalizeTrendScore: clamps at 100 for values > 100", () => {
  assertEqual(normalizeTrendScore(200), 100);
});

test("normalizeTrendScore: mid value passes through", () => {
  assertEqual(normalizeTrendScore(50), 50);
});

test("normalizeTrendScore: returns integer", () => {
  const result = normalizeTrendScore(73.7);
  assertEqual(typeof result, 'number');
  assertEqual(result, Math.round(73.7));
});

test("normalizeTrendScore: zero stays zero", () => {
  assertEqual(normalizeTrendScore(0), 0);
});

// ─── rankItems ────────────────────────────────────────────

test("rankItems: assigns rank 1 to highest", () => {
  const items = [
    { id: 'a', score: 80 },
    { id: 'b', score: 50 },
    { id: 'c', score: 95 },
  ];
  const result = rankItems(items, 'score');
  assertEqual(result[0].id, 'c');
  assertEqual(result[0].rank, 1);
});

test("rankItems: empty array returns []", () => {
  const result = rankItems([], 'score');
  assert(Array.isArray(result) && result.length === 0);
});

test("rankItems: ties get same rank", () => {
  const items = [
    { id: 'a', count: 10 },
    { id: 'b', count: 10 },
    { id: 'c', count: 5  },
  ];
  const result = rankItems(items, 'count');
  assertEqual(result[0].rank, 1);
  assertEqual(result[1].rank, 1);
  assertEqual(result[2].rank, 3);
});

test("rankItems: preserves original fields", () => {
  const items = [{ id: 'x', score: 42, extra: 'data' }];
  const result = rankItems(items, 'score');
  assertEqual(result[0].extra, 'data');
  assertEqual(result[0].id, 'x');
});

// ─── buildDemandStats ────────────────────────────────────

test("buildDemandStats: combines 7d and 30d correctly", () => {
  const clicks7d  = [{ deal_id: 'd1' }, { deal_id: 'd1' }];
  const clicks30d = [
    { deal_id: 'd1' }, { deal_id: 'd1' },
    { deal_id: 'd1' }, { deal_id: 'd1' },
    { deal_id: 'd1' }, { deal_id: 'd1' },
  ];
  const catMap = new Map([['d1', 'fashion']]);
  const result = buildDemandStats(clicks7d, clicks30d, catMap);

  assertEqual(result.length, 1);
  assertEqual(result[0].deal_id, 'd1');
  assertEqual(result[0].click_count_7d, 2);
  assertEqual(result[0].click_count_30d, 6);
  assertEqual(result[0].category, 'fashion');
  assert(result[0].trend_score >= 0 && result[0].trend_score <= 100);
});

test("buildDemandStats: empty clicks returns []", () => {
  const result = buildDemandStats([], [], new Map());
  assert(Array.isArray(result) && result.length === 0);
});

test("buildDemandStats: deal only in 30d (not 7d) gets count_7d=0", () => {
  const clicks7d  = [];
  const clicks30d = [{ deal_id: 'd1' }, { deal_id: 'd1' }];
  const catMap    = new Map();
  const result    = buildDemandStats(clicks7d, clicks30d, catMap);
  assertEqual(result[0].click_count_7d, 0);
  assertEqual(result[0].click_count_30d, 2);
});

// ─── Summary ─────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-45 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.error(`\nFailed tests:\n${FAILED.map(n => `  - ${n}`).join('\n')}`);
  process.exit(1);
}
