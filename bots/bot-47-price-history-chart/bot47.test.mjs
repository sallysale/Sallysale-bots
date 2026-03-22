// bot47.test.mjs — unit tests for BOT-47 Price History Chart
// No DB, no HTTP calls — pure function tests only.

import {
  aggregateChartData,
  computeMovingAverage,
  findPriceExtremes,
  computePercentileRank,
  filterByDeal,
  generateChartPoints,
} from './bot47.mjs';

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

function assertEquals(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertClose(a, b, tolerance, msg) {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(msg || `Expected ${b} ± ${tolerance}, got ${a}`);
  }
}

// ── Test data helpers ──────────────────────────────────────

function makeRow(daysAgo, price, dealId = 'deal-1') {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return { deal_id: dealId, price, recorded_at: ts };
}

function makePoint(dateStr, price) {
  return { date: dateStr, price };
}

// ══════════════════════════════════════════════════════════
// aggregateChartData
// ══════════════════════════════════════════════════════════

test('aggregateChartData: empty array returns []', () => {
  const result = aggregateChartData([]);
  assert(Array.isArray(result) && result.length === 0, 'Expected empty array');
});

test('aggregateChartData: groups by date correctly', () => {
  const rows = [
    makeRow(2, 100),
    makeRow(2, 90),   // same day — should keep lower
    makeRow(1, 80),
  ];
  const result = aggregateChartData(rows, 0);
  assert(result.length === 2, `Expected 2 days, got ${result.length}`);
});

test('aggregateChartData: uses lowest price per day', () => {
  const rows = [
    makeRow(1, 150),
    makeRow(1, 100),  // same day, lower price
    makeRow(1, 200),  // same day, higher price
  ];
  const result = aggregateChartData(rows, 0);
  assert(result.length === 1, `Expected 1 day point, got ${result.length}`);
  assertEquals(result[0].price, 100, 'Should use lowest price: 100');
});

test('aggregateChartData: windowDays filters old data', () => {
  const rows = [
    makeRow(100, 50),  // 100 days ago — should be excluded with window=30
    makeRow(5,   80),  // 5 days ago — should be included
    makeRow(1,   70),  // 1 day ago — should be included
  ];
  const result = aggregateChartData(rows, 30);
  assert(result.length === 2, `Expected 2 points within 30 days, got ${result.length}`);
});

test('aggregateChartData: returns sorted by date ascending', () => {
  const rows = [
    makeRow(1, 80),
    makeRow(5, 120),
    makeRow(3, 100),
  ];
  const result = aggregateChartData(rows, 0);
  assert(result.length >= 2, 'Need at least 2 points');
  assert(result[0].date <= result[result.length - 1].date, 'Should be sorted ascending');
});

// ══════════════════════════════════════════════════════════
// computeMovingAverage
// ══════════════════════════════════════════════════════════

test('computeMovingAverage: window=3 averages correctly', () => {
  const points = [
    makePoint('2025-01-01', 100),
    makePoint('2025-01-02', 200),
    makePoint('2025-01-03', 300),
    makePoint('2025-01-04', 400),
  ];
  const result = computeMovingAverage(points, 3);
  // index 2: avg of [100, 200, 300] = 200
  assertEquals(result[2].avg, 200, 'Window-3 average at index 2 should be 200');
  // index 3: avg of [200, 300, 400] = 300
  assertEquals(result[3].avg, 300, 'Window-3 average at index 3 should be 300');
});

test('computeMovingAverage: returns same length as input', () => {
  const points = [
    makePoint('2025-01-01', 100),
    makePoint('2025-01-02', 200),
    makePoint('2025-01-03', 150),
  ];
  const result = computeMovingAverage(points, 7);
  assertEquals(result.length, points.length, 'Output length should equal input length');
});

test('computeMovingAverage: handles array shorter than window', () => {
  const points = [
    makePoint('2025-01-01', 100),
    makePoint('2025-01-02', 200),
  ];
  const result = computeMovingAverage(points, 7); // window bigger than array
  assertEquals(result.length, 2, 'Should return same length even when window > length');
  assertEquals(result[0].avg, 100, 'First point: avg is itself');
  assertEquals(result[1].avg, 150, 'Second point: avg of [100, 200] = 150');
});

test('computeMovingAverage: empty input returns []', () => {
  const result = computeMovingAverage([], 7);
  assert(Array.isArray(result) && result.length === 0, 'Empty input returns empty array');
});

// ══════════════════════════════════════════════════════════
// findPriceExtremes
// ══════════════════════════════════════════════════════════

test('findPriceExtremes: finds correct min and max', () => {
  const points = [
    makePoint('2025-01-01', 150),
    makePoint('2025-01-02', 80),
    makePoint('2025-01-03', 200),
    makePoint('2025-01-04', 120),
  ];
  const result = findPriceExtremes(points);
  assert(result !== null, 'Expected non-null result');
  assertEquals(result.min, 80, 'Min should be 80');
  assertEquals(result.max, 200, 'Max should be 200');
});

test('findPriceExtremes: returns correct dates', () => {
  const points = [
    makePoint('2025-03-01', 150),
    makePoint('2025-03-02', 50),   // min
    makePoint('2025-03-03', 300),  // max
  ];
  const result = findPriceExtremes(points);
  assertEquals(result.minDate, '2025-03-02', 'Min date should be 2025-03-02');
  assertEquals(result.maxDate, '2025-03-03', 'Max date should be 2025-03-03');
});

test('findPriceExtremes: single point returns same min and max', () => {
  const points = [makePoint('2025-01-01', 99)];
  const result = findPriceExtremes(points);
  assert(result !== null, 'Expected non-null result');
  assertEquals(result.min, 99, 'Single point min should be 99');
  assertEquals(result.max, 99, 'Single point max should be 99');
});

test('findPriceExtremes: empty array returns null', () => {
  const result = findPriceExtremes([]);
  assert(result === null, 'Empty array should return null');
});

// ══════════════════════════════════════════════════════════
// computePercentileRank
// ══════════════════════════════════════════════════════════

test('computePercentileRank: lowest price → 0', () => {
  const allPrices = [50, 100, 150, 200];
  const result = computePercentileRank(50, allPrices);
  assertEquals(result, 0, 'Lowest price should give percentile 0');
});

test('computePercentileRank: highest price → 100', () => {
  const allPrices = [50, 100, 150, 200];
  const result = computePercentileRank(200, allPrices);
  assertEquals(result, 100, 'Highest price should give percentile 100');
});

test('computePercentileRank: middle price → ~50', () => {
  const allPrices = [0, 100];
  const result = computePercentileRank(50, allPrices);
  assertEquals(result, 50, 'Middle price should give percentile 50');
});

test('computePercentileRank: all same prices → 50', () => {
  const allPrices = [100, 100, 100, 100];
  const result = computePercentileRank(100, allPrices);
  assertEquals(result, 50, 'When all prices equal, should return 50');
});

test('computePercentileRank: empty allPrices → 50 (default)', () => {
  const result = computePercentileRank(75, []);
  assertEquals(result, 50, 'Empty prices should return default 50');
});

// ══════════════════════════════════════════════════════════
// filterByDeal
// ══════════════════════════════════════════════════════════

test('filterByDeal: filters correctly', () => {
  const rows = [
    { deal_id: 'deal-A', price: 100, recorded_at: '2025-01-01T00:00:00Z' },
    { deal_id: 'deal-B', price: 200, recorded_at: '2025-01-01T00:00:00Z' },
    { deal_id: 'deal-A', price: 90,  recorded_at: '2025-01-02T00:00:00Z' },
  ];
  const result = filterByDeal(rows, 'deal-A');
  assertEquals(result.length, 2, 'Should return 2 rows for deal-A');
  assert(result.every(r => r.deal_id === 'deal-A'), 'All rows should be for deal-A');
});

test('filterByDeal: returns [] for unknown deal', () => {
  const rows = [
    { deal_id: 'deal-A', price: 100, recorded_at: '2025-01-01T00:00:00Z' },
  ];
  const result = filterByDeal(rows, 'deal-Z');
  assertEquals(result.length, 0, 'Should return empty for unknown deal');
});

test('filterByDeal: handles empty rows', () => {
  const result = filterByDeal([], 'deal-A');
  assertEquals(result.length, 0, 'Empty rows should return empty array');
});

test('filterByDeal: handles null dealId', () => {
  const rows = [{ deal_id: 'deal-A', price: 100, recorded_at: '2025-01-01T00:00:00Z' }];
  const result = filterByDeal(rows, null);
  assertEquals(result.length, 0, 'Null dealId should return empty array');
});

// ══════════════════════════════════════════════════════════
// generateChartPoints
// ══════════════════════════════════════════════════════════

test('generateChartPoints: limits to requested days', () => {
  const rows = [
    makeRow(5,  100),
    makeRow(10, 110),
    makeRow(40, 90),   // outside 30-day window
  ];
  const result = generateChartPoints(rows, 30);
  // Only 2 points should be within the 30-day window
  assert(result.length <= 2, `Expected at most 2 points within 30 days, got ${result.length}`);
});

test('generateChartPoints: marks is_sale correctly for low price', () => {
  // Create rows where one day is very cheap compared to the average
  const rows = [
    makeRow(6, 100),
    makeRow(5, 100),
    makeRow(4, 100),
    makeRow(3, 100),
    makeRow(2, 100),
    makeRow(1, 50),  // 50% of average — definitely a sale (threshold = 85%)
  ];
  const result = generateChartPoints(rows, 30);
  const cheapPoint = result.find(p => p.price === 50);
  assert(cheapPoint !== undefined, 'Should include the cheap point');
  assert(cheapPoint.is_sale === true, `Cheap point at $50 vs avg $91.67 should be is_sale=true, got ${cheapPoint.is_sale}`);
});

test('generateChartPoints: marks is_sale=false for normal price', () => {
  const rows = [
    makeRow(3, 100),
    makeRow(2, 100),
    makeRow(1, 100),  // same as average — not a sale
  ];
  const result = generateChartPoints(rows, 30);
  assert(result.length > 0, 'Should have chart points');
  assert(result.every(p => p.is_sale === false), 'All points at average price should not be sale');
});

test('generateChartPoints: empty rows returns []', () => {
  const result = generateChartPoints([], 90);
  assert(Array.isArray(result) && result.length === 0, 'Empty rows return empty array');
});

test('generateChartPoints: returns objects with date, price, is_sale', () => {
  const rows = [makeRow(1, 99), makeRow(2, 110)];
  const result = generateChartPoints(rows, 30);
  assert(result.length > 0, 'Should have at least 1 point');
  const point = result[0];
  assert('date' in point,    'Point should have date');
  assert('price' in point,   'Point should have price');
  assert('is_sale' in point, 'Point should have is_sale');
});

// ══════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-47 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.log(`\nFailed tests:`);
  FAILED.forEach(name => console.log(`  ✗ ${name}`));
  process.exit(1);
}
