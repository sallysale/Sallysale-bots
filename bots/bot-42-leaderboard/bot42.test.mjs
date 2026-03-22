// bot42.test.mjs — unit tests for BOT-42 Leaderboard
// No DB, no HTTP — pure functions only.

import {
  getPeriodStart,
  filterByPeriod,
  buildLeaderboard,
  formatLeaderboardEntry,
  aggregateTransactionPoints,
} from './bot42.mjs';

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

// ─── getPeriodStart ───────────────────────────────────────

test("getPeriodStart('alltime') returns '1970-01-01'", () => {
  assertEqual(getPeriodStart('alltime'), '1970-01-01');
});

test("getPeriodStart('monthly') returns first day of current month", () => {
  const now    = new Date('2026-03-17T10:00:00Z');
  const result = getPeriodStart('monthly', now);
  assertEqual(result, '2026-03-01');
});

test("getPeriodStart('monthly') works for January", () => {
  const now    = new Date('2026-01-25T00:00:00Z');
  const result = getPeriodStart('monthly', now);
  assertEqual(result, '2026-01-01');
});

test("getPeriodStart('weekly') returns a Monday date", () => {
  // 2026-03-17 is a Tuesday — Monday is 2026-03-16
  const now    = new Date('2026-03-17T10:00:00Z');
  const result = getPeriodStart('weekly', now);
  const day    = new Date(result + 'T00:00:00Z').getUTCDay();
  assertEqual(day, 1, `Expected Monday (1), got day ${day} for date ${result}`);
});

test("getPeriodStart('weekly') from Monday returns same day", () => {
  // 2026-03-16 is a Monday
  const now    = new Date('2026-03-16T08:00:00Z');
  const result = getPeriodStart('weekly', now);
  assertEqual(result, '2026-03-16');
});

test("getPeriodStart('weekly') from Sunday returns previous Monday", () => {
  // 2026-03-15 is a Sunday — Monday is 2026-03-09
  const now    = new Date('2026-03-15T00:00:00Z');
  const result = getPeriodStart('weekly', now);
  assertEqual(result, '2026-03-09');
});

test("getPeriodStart with unknown period throws", () => {
  let threw = false;
  try { getPeriodStart('yearly'); } catch { threw = true; }
  assert(threw, 'Should throw for unknown period');
});

// ─── buildLeaderboard ────────────────────────────────────

test("buildLeaderboard: empty array returns []", () => {
  const result = buildLeaderboard([]);
  assert(Array.isArray(result) && result.length === 0);
});

test("buildLeaderboard: sorts by total_points DESC", () => {
  const rows = [
    { user_id: 'u1', total_points: 100, tier: 'hunter' },
    { user_id: 'u2', total_points: 500, tier: 'deal_pro' },
    { user_id: 'u3', total_points: 50,  tier: 'hunter' },
  ];
  const result = buildLeaderboard(rows);
  assertEqual(result[0].user_id, 'u2');
  assertEqual(result[1].user_id, 'u1');
  assertEqual(result[2].user_id, 'u3');
});

test("buildLeaderboard: assigns ranks 1, 2, 3", () => {
  const rows = [
    { user_id: 'u1', total_points: 300, tier: 'hunter' },
    { user_id: 'u2', total_points: 200, tier: 'hunter' },
    { user_id: 'u3', total_points: 100, tier: 'hunter' },
  ];
  const result = buildLeaderboard(rows);
  assertEqual(result[0].rank, 1);
  assertEqual(result[1].rank, 2);
  assertEqual(result[2].rank, 3);
});

test("buildLeaderboard: limits to top 100", () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({
    user_id:      `user-${i}`,
    total_points: 150 - i,
    tier:         'hunter',
  }));
  const result = buildLeaderboard(rows);
  assert(result.length === 100, `Expected 100, got ${result.length}`);
});

test("buildLeaderboard: handles ties — same rank for equal points", () => {
  const rows = [
    { user_id: 'u1', total_points: 500, tier: 'deal_pro' },
    { user_id: 'u2', total_points: 500, tier: 'deal_pro' },
    { user_id: 'u3', total_points: 100, tier: 'hunter' },
  ];
  const result = buildLeaderboard(rows);
  assertEqual(result[0].rank, 1);
  assertEqual(result[1].rank, 1); // tie — same rank
  assertEqual(result[2].rank, 3); // next unique rank
});

test("buildLeaderboard: passes period through to entries", () => {
  const rows = [{ user_id: 'u1', total_points: 100, tier: 'hunter' }];
  const result = buildLeaderboard(rows, 'monthly');
  assertEqual(result[0].period, 'monthly');
});

// ─── formatLeaderboardEntry ──────────────────────────────

test("formatLeaderboardEntry: returns correct shape", () => {
  const row    = { user_id: 'abc', total_points: 250, tier: 'hunter' };
  const entry  = formatLeaderboardEntry(row, 5, 'alltime');
  assert('rank'         in entry);
  assert('user_id'      in entry);
  assert('total_points' in entry);
  assert('tier'         in entry);
  assert('period'       in entry);
});

test("formatLeaderboardEntry: rank is integer", () => {
  const row   = { user_id: 'abc', total_points: 100, tier: 'hunter' };
  const entry = formatLeaderboardEntry(row, '3', 'weekly');
  assertEqual(typeof entry.rank, 'number');
  assertEqual(entry.rank, 3);
});

test("formatLeaderboardEntry: defaults tier to 'hunter' when missing", () => {
  const row   = { user_id: 'abc', total_points: 50 };
  const entry = formatLeaderboardEntry(row, 1);
  assertEqual(entry.tier, 'hunter');
});

// ─── filterByPeriod ──────────────────────────────────────

test("filterByPeriod: alltime returns all rows", () => {
  const txs = [
    { user_id: 'u1', points: 100, created_at: '2020-01-01T00:00:00Z' },
    { user_id: 'u2', points: 50,  created_at: '2025-06-15T12:00:00Z' },
  ];
  const result = filterByPeriod(txs, 'alltime');
  assertEqual(result.length, 2);
});

test("filterByPeriod: monthly filters correctly", () => {
  const now = new Date('2026-03-17T10:00:00Z');
  const txs = [
    { user_id: 'u1', points: 100, created_at: '2026-03-05T00:00:00Z' },  // in
    { user_id: 'u2', points: 50,  created_at: '2026-02-28T00:00:00Z' },  // out
    { user_id: 'u3', points: 200, created_at: '2026-03-17T09:00:00Z' },  // in
  ];
  const result = filterByPeriod(txs, 'monthly', now);
  assertEqual(result.length, 2);
  assert(result.every(r => r.created_at >= '2026-03-01'));
});

test("filterByPeriod: weekly filters correctly", () => {
  // 2026-03-17 = Tuesday, so Monday = 2026-03-16
  const now = new Date('2026-03-17T10:00:00Z');
  const txs = [
    { user_id: 'u1', points: 100, created_at: '2026-03-16T00:00:00Z' }, // in (Monday)
    { user_id: 'u2', points: 50,  created_at: '2026-03-15T23:59:59Z' }, // out (Sunday)
    { user_id: 'u3', points: 200, created_at: '2026-03-17T09:00:00Z' }, // in (Tuesday)
  ];
  const result = filterByPeriod(txs, 'weekly', now);
  assertEqual(result.length, 2);
});

test("filterByPeriod: empty array returns []", () => {
  const result = filterByPeriod([], 'monthly');
  assert(Array.isArray(result) && result.length === 0);
});

test("filterByPeriod: skips rows with no created_at", () => {
  const now = new Date('2026-03-17T10:00:00Z');
  const txs = [
    { user_id: 'u1', points: 100 },                                     // no date
    { user_id: 'u2', points: 50, created_at: '2026-03-10T00:00:00Z' }, // in
  ];
  const result = filterByPeriod(txs, 'monthly', now);
  assertEqual(result.length, 1);
  assertEqual(result[0].user_id, 'u2');
});

// ─── aggregateTransactionPoints ──────────────────────────

test("aggregateTransactionPoints: sums points per user", () => {
  const txs = [
    { user_id: 'u1', points: 100 },
    { user_id: 'u1', points: 50  },
    { user_id: 'u2', points: 200 },
  ];
  const map = aggregateTransactionPoints(txs);
  assertEqual(map.get('u1'), 150);
  assertEqual(map.get('u2'), 200);
});

test("aggregateTransactionPoints: empty array returns empty map", () => {
  const map = aggregateTransactionPoints([]);
  assertEqual(map.size, 0);
});

test("aggregateTransactionPoints: skips rows without user_id", () => {
  const txs = [
    { points: 100 },             // no user_id
    { user_id: 'u1', points: 50 },
  ];
  const map = aggregateTransactionPoints(txs);
  assertEqual(map.size, 1);
  assertEqual(map.get('u1'), 50);
});

// ─── Summary ─────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-42 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.error(`\nFailed tests:\n${FAILED.map(n => `  - ${n}`).join('\n')}`);
  process.exit(1);
}
