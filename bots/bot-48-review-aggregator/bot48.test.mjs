// bot48.test.mjs — בדיקות יחידה ל-BOT-48 Review Aggregator
// הרץ: node bot48.test.mjs
// ════════════════════════════════════════════════════════════

import {
  normalizeRating,
  classifyRating,
  mergeReviews,
  parseAmazonReviewBlock,
  buildReviewBadge,
  isValidReviewData,
  extractASINFromUrl,
  REVIEW_SOURCES,
} from './bot48.mjs';

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
// 1. normalizeRating
// ════════════════════════════════════════════════════════════

test('normalizeRating: 4.5/5 → 4.5', () => {
  assertEq(normalizeRating(4.5, 5), 4.5);
});

test('normalizeRating: 8/10 → 4.0', () => {
  assertEq(normalizeRating(8, 10), 4.0);
});

test('normalizeRating: 0/5 → 0', () => {
  assertEq(normalizeRating(0, 5), 0);
});

test('normalizeRating: NaN → 0', () => {
  assertEq(normalizeRating(NaN, 5), 0);
});

test('normalizeRating: maxScale=0 → 0', () => {
  assertEq(normalizeRating(4, 0), 0);
});

test('normalizeRating: clamps to 5 max', () => {
  assertEq(normalizeRating(10, 5), 5);
});

// ════════════════════════════════════════════════════════════
// 2. classifyRating
// ════════════════════════════════════════════════════════════

test('classifyRating: 4.8 → excellent', () => {
  assertEq(classifyRating(4.8), 'excellent');
});

test('classifyRating: 4.0 → good', () => {
  assertEq(classifyRating(4.0), 'good');
});

test('classifyRating: 3.0 → average', () => {
  assertEq(classifyRating(3.0), 'average');
});

test('classifyRating: 2.0 → poor', () => {
  assertEq(classifyRating(2.0), 'poor');
});

test('classifyRating: 0 → no_data', () => {
  assertEq(classifyRating(0), 'no_data');
});

// ════════════════════════════════════════════════════════════
// 3. mergeReviews
// ════════════════════════════════════════════════════════════

test('mergeReviews: empty array → zeros', () => {
  const r = mergeReviews([]);
  assertEq(r.avg_rating, 0);
  assertEq(r.total_count, 0);
});

test('mergeReviews: single source', () => {
  const r = mergeReviews([{ source: 'amazon', rating: 4.5, count: 1000 }]);
  assertEq(r.avg_rating, 4.5);
  assertEq(r.total_count, 1000);
});

test('mergeReviews: weighted average of two sources', () => {
  const r = mergeReviews([
    { source: 'amazon',          rating: 4.0, count: 100 },
    { source: 'google_shopping', rating: 5.0, count: 100 },
  ]);
  assertEq(r.avg_rating, 4.5);
  assertEq(r.total_count, 200);
});

test('mergeReviews: ignores zero-count entries', () => {
  const r = mergeReviews([
    { source: 'amazon', rating: 4.0, count: 0 },
    { source: 'trustpilot', rating: 3.0, count: 50 },
  ]);
  assertEq(r.avg_rating, 3.0);
  assertEq(r.total_count, 50);
});

// ════════════════════════════════════════════════════════════
// 4. parseAmazonReviewBlock
// ════════════════════════════════════════════════════════════

test('parseAmazonReviewBlock: parses rating + count', () => {
  const html = '<span>4.5 out of 5 stars</span><span>1,234 global ratings</span>';
  const result = parseAmazonReviewBlock(html);
  assert(result !== null, 'should parse');
  assertEq(result.rating, 4.5);
  assertEq(result.count, 1234);
});

test('parseAmazonReviewBlock: no rating → null', () => {
  const result = parseAmazonReviewBlock('<div>Some text</div>');
  assertEq(result, null);
});

test('parseAmazonReviewBlock: null input → null', () => {
  assertEq(parseAmazonReviewBlock(null), null);
});

// ════════════════════════════════════════════════════════════
// 5. buildReviewBadge
// ════════════════════════════════════════════════════════════

test('buildReviewBadge: 4.5 with 1500 reviews', () => {
  const badge = buildReviewBadge(4.5, 1500);
  assert(badge.includes('4.5'), 'badge should contain rating');
  assert(badge.includes('1.5k'), 'badge should abbreviate count');
});

test('buildReviewBadge: 0 rating → empty string', () => {
  assertEq(buildReviewBadge(0, 100), '');
});

test('buildReviewBadge: 0 count → empty string', () => {
  assertEq(buildReviewBadge(4.5, 0), '');
});

// ════════════════════════════════════════════════════════════
// 6. isValidReviewData
// ════════════════════════════════════════════════════════════

test('isValidReviewData: valid review → true', () => {
  assert(isValidReviewData({ rating: 4.5, count: 100, source: 'amazon' }));
});

test('isValidReviewData: invalid source → false', () => {
  assert(!isValidReviewData({ rating: 4.5, count: 100, source: 'unknown' }));
});

test('isValidReviewData: rating > 5 → false', () => {
  assert(!isValidReviewData({ rating: 6, count: 100, source: 'amazon' }));
});

test('isValidReviewData: null → false', () => {
  assert(!isValidReviewData(null));
});

// ════════════════════════════════════════════════════════════
// 7. extractASINFromUrl
// ════════════════════════════════════════════════════════════

test('extractASINFromUrl: standard /dp/ URL', () => {
  const asin = extractASINFromUrl('https://www.amazon.com/dp/B08N5WRWNW');
  assertEq(asin, 'B08N5WRWNW');
});

test('extractASINFromUrl: /gp/product/ URL', () => {
  const asin = extractASINFromUrl('https://www.amazon.com/gp/product/B08N5WRWNW');
  assertEq(asin, 'B08N5WRWNW');
});

test('extractASINFromUrl: non-Amazon URL → null', () => {
  assertEq(extractASINFromUrl('https://www.ebay.com/item/12345'), null);
});

test('extractASINFromUrl: null → null', () => {
  assertEq(extractASINFromUrl(null), null);
});

// ════════════════════════════════════════════════════════════
// 8. REVIEW_SOURCES
// ════════════════════════════════════════════════════════════

test('REVIEW_SOURCES includes amazon', () => {
  assert(REVIEW_SOURCES.includes('amazon'));
});

test('REVIEW_SOURCES includes trustpilot', () => {
  assert(REVIEW_SOURCES.includes('trustpilot'));
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-48 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) process.exit(1);
