// bot50.test.mjs — בדיקות יחידה ל-BOT-50 Personalization Engine
// הרץ: node bot50.test.mjs
// ════════════════════════════════════════════════════════════

import {
  computeAffinityScore,
  buildUserProfile,
  classifyPriceRange,
  rankDealsForUser,
  getTopCategories,
  CLICK_WINDOW_DAYS,
  FEED_SIZE,
  MIN_CLICKS_FOR_PREFS,
} from './bot50.mjs';

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

function assertBetween(val, lo, hi, msg) {
  if (val < lo || val > hi) throw new Error(msg || `expected ${val} between ${lo}-${hi}`);
}

// ════════════════════════════════════════════════════════════
// 1. computeAffinityScore
// ════════════════════════════════════════════════════════════

test('computeAffinityScore: 0 total → 0', () => {
  assertEq(computeAffinityScore(5, 0, 0), 0);
});

test('computeAffinityScore: 0 clicks → 0', () => {
  assertEq(computeAffinityScore(0, 10, 0), 0);
});

test('computeAffinityScore: all clicks in category, recent → high score', () => {
  const score = computeAffinityScore(10, 10, 0);
  assert(score > 80, `expected >80, got ${score}`);
});

test('computeAffinityScore: few clicks, old → low score', () => {
  const score = computeAffinityScore(1, 20, 29);
  assert(score < 20, `expected <20, got ${score}`);
});

test('computeAffinityScore: returns 0-100', () => {
  assertBetween(computeAffinityScore(5, 10, 5), 0, 100);
});

// ════════════════════════════════════════════════════════════
// 2. buildUserProfile
// ════════════════════════════════════════════════════════════

const now = new Date().toISOString();
const recentClicks = [
  { category: 'fashion', store_id: 's1', price: 50, clicked_at: now },
  { category: 'fashion', store_id: 's1', price: 60, clicked_at: now },
  { category: 'electronics', store_id: 's2', price: 200, clicked_at: now },
  { category: 'fashion', store_id: 's3', price: 40, clicked_at: now },
];

test('buildUserProfile: empty clicks → zero profile', () => {
  const p = buildUserProfile([]);
  assertEq(p.avgPrice, 0);
  assertEq(p.priceRange, 'any');
  assertEq(p.categories.size, 0);
});

test('buildUserProfile: detects top category', () => {
  const p = buildUserProfile(recentClicks);
  const fashionScore = p.categories.get('fashion') || 0;
  const elecScore    = p.categories.get('electronics') || 0;
  assert(fashionScore > elecScore, `fashion (${fashionScore}) should beat electronics (${elecScore})`);
});

test('buildUserProfile: computes avg price', () => {
  const p = buildUserProfile(recentClicks);
  // (50+60+200+40)/4 = 87.5
  assertBetween(p.avgPrice, 80, 95, `avgPrice=${p.avgPrice} expected ~87`);
});

test('buildUserProfile: price range "mid" for avg ~87', () => {
  const p = buildUserProfile(recentClicks);
  assertEq(p.priceRange, 'mid');
});

test('buildUserProfile: null input → zero profile', () => {
  const p = buildUserProfile(null);
  assertEq(p.avgPrice, 0);
});

// ════════════════════════════════════════════════════════════
// 3. classifyPriceRange
// ════════════════════════════════════════════════════════════

test('classifyPriceRange: 0 → any', () => {
  assertEq(classifyPriceRange(0), 'any');
});

test('classifyPriceRange: 20 → budget', () => {
  assertEq(classifyPriceRange(20), 'budget');
});

test('classifyPriceRange: 75 → mid', () => {
  assertEq(classifyPriceRange(75), 'mid');
});

test('classifyPriceRange: 300 → premium', () => {
  assertEq(classifyPriceRange(300), 'premium');
});

test('classifyPriceRange: 1000 → luxury', () => {
  assertEq(classifyPriceRange(1000), 'luxury');
});

// ════════════════════════════════════════════════════════════
// 4. rankDealsForUser
// ════════════════════════════════════════════════════════════

const profile = {
  categories: new Map([['fashion', 90], ['electronics', 30]]),
  stores:     new Map([['s1', 70]]),
  avgPrice:   60,
};

const deals = [
  { id: 'd1', category: 'fashion',     store_id: 's1', score: 80, price: 55 },
  { id: 'd2', category: 'electronics', store_id: 's2', score: 85, price: 200 },
  { id: 'd3', category: 'fashion',     store_id: 's2', score: 70, price: 60 },
];

test('rankDealsForUser: fashion deals ranked higher for fashion user', () => {
  const ranked = rankDealsForUser(deals, profile);
  const top = ranked[0];
  assert(top.id === 'd1' || top.id === 'd3', `expected fashion deal on top, got ${top.id}`);
});

test('rankDealsForUser: returns same count as input', () => {
  const ranked = rankDealsForUser(deals, profile);
  assertEq(ranked.length, deals.length);
});

test('rankDealsForUser: sorted descending by personalScore', () => {
  const ranked = rankDealsForUser(deals, profile);
  for (let i = 0; i < ranked.length - 1; i++) {
    assert(ranked[i].personalScore >= ranked[i+1].personalScore,
      `not sorted: ${ranked[i].personalScore} < ${ranked[i+1].personalScore}`);
  }
});

test('rankDealsForUser: empty deals → empty result', () => {
  assertEq(rankDealsForUser([], profile).length, 0);
});

// ════════════════════════════════════════════════════════════
// 5. getTopCategories
// ════════════════════════════════════════════════════════════

test('getTopCategories: returns top N by score', () => {
  const cats = new Map([['fashion', 90], ['electronics', 60], ['home', 40], ['sports', 20]]);
  const top = getTopCategories(cats, 2);
  assertEq(top.length, 2);
  assertEq(top[0], 'fashion');
  assertEq(top[1], 'electronics');
});

test('getTopCategories: empty map → empty array', () => {
  assertEq(getTopCategories(new Map(), 3).length, 0);
});

test('getTopCategories: default n=3', () => {
  const cats = new Map([['a', 5], ['b', 4], ['c', 3], ['d', 2]]);
  assertEq(getTopCategories(cats).length, 3);
});

// ════════════════════════════════════════════════════════════
// 6. constants
// ════════════════════════════════════════════════════════════

test('CLICK_WINDOW_DAYS is 30', () => {
  assertEq(CLICK_WINDOW_DAYS, 30);
});

test('FEED_SIZE is 50', () => {
  assertEq(FEED_SIZE, 50);
});

test('MIN_CLICKS_FOR_PREFS is 3', () => {
  assertEq(MIN_CLICKS_FOR_PREFS, 3);
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-50 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) process.exit(1);
