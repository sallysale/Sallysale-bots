// bot67.test.mjs — בדיקות יחידה ל-BOT-67 Bot Block Detector
// הרץ: node bot67.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isBlockedResponse,
  computeBlockRate,
  classifyBlockSeverity,
  shouldAlert,
  getRecommendation,
  buildBlockReport,
  DEFAULT_ALERT_THRESHOLD,
} from './bot67.mjs';

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
  if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`);
}

// ════════════════════════════════════════════════════════════
// 1. isBlockedResponse
// ════════════════════════════════════════════════════════════

test('isBlockedResponse: 403 + empty body → true', () => {
  assert(isBlockedResponse(403, '') === true);
});

test('isBlockedResponse: 429 + empty body → true', () => {
  assert(isBlockedResponse(429, '') === true);
});

test('isBlockedResponse: 503 + empty body → true', () => {
  assert(isBlockedResponse(503, '') === true);
});

test('isBlockedResponse: 200 + "please verify you are human" → true', () => {
  assert(isBlockedResponse(200, 'Please verify you are human to continue') === true);
});

test('isBlockedResponse: 200 + "access denied" → true', () => {
  assert(isBlockedResponse(200, 'Access denied to this resource') === true);
});

test('isBlockedResponse: 200 + "captcha" in body → true', () => {
  assert(isBlockedResponse(200, 'Please solve the captcha to proceed') === true);
});

test('isBlockedResponse: 200 + "cloudflare" in body → true', () => {
  assert(isBlockedResponse(200, 'Cloudflare security check') === true);
});

test('isBlockedResponse: 200 + "bot detected" → true', () => {
  assert(isBlockedResponse(200, 'bot detected — blocking request') === true);
});

test('isBlockedResponse: 200 + normal content → false', () => {
  assert(isBlockedResponse(200, 'here are your deals: 50% off shoes') === false);
});

test('isBlockedResponse: 404 + empty body → false', () => {
  assert(isBlockedResponse(404, '') === false);
});

// ════════════════════════════════════════════════════════════
// 2. computeBlockRate
// ════════════════════════════════════════════════════════════

test('computeBlockRate: 10 attempts, 3 blocks → 30', () => {
  assertEq(computeBlockRate(10, 3), 30);
});

test('computeBlockRate: 0 attempts → 0', () => {
  assertEq(computeBlockRate(0, 0), 0);
});

test('computeBlockRate: 100 attempts, 100 blocks → 100', () => {
  assertEq(computeBlockRate(100, 100), 100);
});

test('computeBlockRate: 4 attempts, 2 blocks → 50', () => {
  assertEq(computeBlockRate(4, 2), 50);
});

// ════════════════════════════════════════════════════════════
// 3. classifyBlockSeverity
// ════════════════════════════════════════════════════════════

test('classifyBlockSeverity: 0 → "none"', () => {
  assertEq(classifyBlockSeverity(0), 'none');
});

test('classifyBlockSeverity: 5 → "low"', () => {
  assertEq(classifyBlockSeverity(5), 'low');
});

test('classifyBlockSeverity: 30 → "medium"', () => {
  assertEq(classifyBlockSeverity(30), 'medium');
});

test('classifyBlockSeverity: 50 → "medium" (boundary inclusive)', () => {
  assertEq(classifyBlockSeverity(50), 'medium');
});

test('classifyBlockSeverity: 75 → "high"', () => {
  assertEq(classifyBlockSeverity(75), 'high');
});

test('classifyBlockSeverity: 100 → "full"', () => {
  assertEq(classifyBlockSeverity(100), 'full');
});

// ════════════════════════════════════════════════════════════
// 4. shouldAlert
// ════════════════════════════════════════════════════════════

test('shouldAlert: 30%, threshold=25 → true', () => {
  assert(shouldAlert(30, 25) === true);
});

test('shouldAlert: 10%, threshold=25 → false', () => {
  assert(shouldAlert(10, 25) === false);
});

test('shouldAlert: exactly at threshold → true', () => {
  assert(shouldAlert(25, 25) === true);
});

test('shouldAlert: uses default threshold', () => {
  assert(shouldAlert(DEFAULT_ALERT_THRESHOLD) === true);
  assert(shouldAlert(DEFAULT_ALERT_THRESHOLD - 1) === false);
});

// ════════════════════════════════════════════════════════════
// 5. getRecommendation
// ════════════════════════════════════════════════════════════

test('getRecommendation: "none" → "none"', () => {
  assertEq(getRecommendation('none'), 'none');
});

test('getRecommendation: "low" → "rotate_proxy"', () => {
  assertEq(getRecommendation('low'), 'rotate_proxy');
});

test('getRecommendation: "medium" → "reduce_frequency"', () => {
  assertEq(getRecommendation('medium'), 'reduce_frequency');
});

test('getRecommendation: "high" → "pause_scraping"', () => {
  assertEq(getRecommendation('high'), 'pause_scraping');
});

test('getRecommendation: "full" → "contact_support"', () => {
  assertEq(getRecommendation('full'), 'contact_support');
});

// ════════════════════════════════════════════════════════════
// 6. buildBlockReport
// ════════════════════════════════════════════════════════════

test('buildBlockReport: correct shape', () => {
  const report = buildBlockReport('store-abc', { attempts: 20, blocks: 5 });
  assert(report.store === 'store-abc', `store mismatch: ${report.store}`);
  assert(typeof report.blockRate === 'number', 'blockRate not a number');
  assert(typeof report.severity === 'string', 'severity not a string');
  assert(typeof report.recommendation === 'string', 'recommendation not a string');
  assertEq(report.blockRate, 25);
  assertEq(report.severity, 'medium');
  assertEq(report.recommendation, 'reduce_frequency');
});

test('buildBlockReport: 0 blocks → none severity', () => {
  const report = buildBlockReport('store-ok', { attempts: 10, blocks: 0 });
  assertEq(report.severity, 'none');
  assertEq(report.recommendation, 'none');
  assertEq(report.blockRate, 0);
});

test('buildBlockReport: all blocked → full severity', () => {
  const report = buildBlockReport('store-full', { attempts: 5, blocks: 5 });
  assertEq(report.severity, 'full');
  assertEq(report.recommendation, 'contact_support');
  assertEq(report.blockRate, 100);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-67 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
