// bot69.test.mjs — בדיקות יחידה ל-BOT-69 Affiliate Link Tester
// הרץ: node bot69.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isAffiliateUrl,
  classifyLinkStatus,
  detectExpiredAffiliate,
  buildTestResult,
  prioritizeDealsByLink,
  shouldTestLink,
} from './bot69.mjs';

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
// 1. isAffiliateUrl
// ════════════════════════════════════════════════════════════

test('isAffiliateUrl: URL with tag= → true', () => {
  assert(isAffiliateUrl('https://amazon.com/dp/B001?tag=sallysale-20') === true);
});

test('isAffiliateUrl: URL with aff_id= → true', () => {
  assert(isAffiliateUrl('https://shop.com/product?aff_id=12345') === true);
});

test('isAffiliateUrl: URL with tduid= (Tradedoubler) → true', () => {
  assert(isAffiliateUrl('https://store.com/item?tduid=abc123') === true);
});

test('isAffiliateUrl: URL with awc= (AWIN) → true', () => {
  assert(isAffiliateUrl('https://brand.com/sale?awc=xyz') === true);
});

test('isAffiliateUrl: URL with cjevent= (CJ) → true', () => {
  assert(isAffiliateUrl('https://shop.com/?cjevent=abc') === true);
});

test('isAffiliateUrl: clean product URL → false', () => {
  assert(isAffiliateUrl('https://amazon.com/dp/B001XYZ123') === false);
});

test('isAffiliateUrl: null/empty → false', () => {
  assert(isAffiliateUrl(null) === false);
  assert(isAffiliateUrl('') === false);
});

// ════════════════════════════════════════════════════════════
// 2. classifyLinkStatus
// ════════════════════════════════════════════════════════════

test('classifyLinkStatus: 200, same URL → "ok"', () => {
  assertEq(classifyLinkStatus(200, null), 'ok');
});

test('classifyLinkStatus: 404 → "broken"', () => {
  assertEq(classifyLinkStatus(404, null), 'broken');
});

test('classifyLinkStatus: 301, new URL → "redirect"', () => {
  assertEq(classifyLinkStatus(301, 'https://new.url/page'), 'redirect');
});

test('classifyLinkStatus: 302, new URL → "redirect"', () => {
  assertEq(classifyLinkStatus(302, 'https://other.url/'), 'redirect');
});

test('classifyLinkStatus: 403 → "blocked"', () => {
  assertEq(classifyLinkStatus(403, null), 'blocked');
});

test('classifyLinkStatus: 410 → "expired"', () => {
  assertEq(classifyLinkStatus(410, null), 'expired');
});

test('classifyLinkStatus: 500 → "broken"', () => {
  assertEq(classifyLinkStatus(500, null), 'broken');
});

// ════════════════════════════════════════════════════════════
// 3. detectExpiredAffiliate
// ════════════════════════════════════════════════════════════

test('detectExpiredAffiliate: "This offer has expired" → true', () => {
  assert(detectExpiredAffiliate('https://example.com', 'This offer has expired. Find other deals.') === true);
});

test('detectExpiredAffiliate: "deal ended" → true', () => {
  assert(detectExpiredAffiliate('', 'Sorry, this deal ended last week.') === true);
});

test('detectExpiredAffiliate: "no longer available" → true', () => {
  assert(detectExpiredAffiliate('', 'This product is no longer available.') === true);
});

test('detectExpiredAffiliate: normal content → false', () => {
  assert(detectExpiredAffiliate('', 'Great deal still available! 50% off shoes today!') === false);
});

test('detectExpiredAffiliate: empty body → false', () => {
  assert(detectExpiredAffiliate('https://example.com', '') === false);
  assert(detectExpiredAffiliate('https://example.com', null) === false);
});

// ════════════════════════════════════════════════════════════
// 4. buildTestResult
// ════════════════════════════════════════════════════════════

test('buildTestResult: 200 + normal body → { status: "ok", isWorking: true }', () => {
  const result = buildTestResult('https://example.com/?tag=x', 200, null, 'Buy now — great deal!');
  assertEq(result.status, 'ok');
  assert(result.isWorking === true);
});

test('buildTestResult: 404 → { status: "broken", isWorking: false }', () => {
  const result = buildTestResult('https://example.com/', 404, null, '');
  assertEq(result.status, 'broken');
  assert(result.isWorking === false);
});

test('buildTestResult: 200 + expired body → { status: "expired", isWorking: false }', () => {
  const result = buildTestResult('https://example.com/', 200, null, 'This offer has expired.');
  assertEq(result.status, 'expired');
  assert(result.isWorking === false);
});

test('buildTestResult: 403 → { status: "blocked", isWorking: false }', () => {
  const result = buildTestResult('https://example.com/', 403, null, '');
  assertEq(result.status, 'blocked');
  assert(result.isWorking === false);
});

// ════════════════════════════════════════════════════════════
// 5. shouldTestLink
// ════════════════════════════════════════════════════════════

test('shouldTestLink: never tested (null) → true', () => {
  assert(shouldTestLink({ last_affiliate_test_at: null }) === true);
});

test('shouldTestLink: tested 2h ago, max=24 → false', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert(shouldTestLink({ last_affiliate_test_at: twoHoursAgo }, 24, new Date()) === false);
});

test('shouldTestLink: tested 25h ago, max=24 → true', () => {
  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  assert(shouldTestLink({ last_affiliate_test_at: twentyFiveHoursAgo }, 24, new Date()) === true);
});

// ════════════════════════════════════════════════════════════
// 6. prioritizeDealsByLink
// ════════════════════════════════════════════════════════════

test('prioritizeDealsByLink: oldest tested first', () => {
  const now = new Date();
  const recent  = new Date(now.getTime() - 1  * 60 * 60 * 1000).toISOString();
  const older   = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const never   = null;

  const deals = [
    { id: 'a', score: 80, last_affiliate_test_at: recent },
    { id: 'b', score: 90, last_affiliate_test_at: older  },
    { id: 'c', score: 70, last_affiliate_test_at: never  },
  ];

  const sorted = prioritizeDealsByLink(deals);
  assertEq(sorted[0].id, 'c', 'never-tested should be first');
  assertEq(sorted[1].id, 'b', 'older should be second');
  assertEq(sorted[2].id, 'a', 'recent should be last');
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-69 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
