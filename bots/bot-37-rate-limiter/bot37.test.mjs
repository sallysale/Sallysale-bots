// bot37.test.mjs — בדיקות יחידה ל-BOT-37 Rate Limiter
// הרץ: node bot37.test.mjs
// ════════════════════════════════════════════════════════════

import {
  RateLimiterMemory,
  MAX_REQUESTS_PER_WINDOW,
  WINDOW_MS,
  BLOCK_DURATION_MS,
  formatBlockedResponse,
  shouldCleanup,
} from './bot37.mjs';

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

// ════════════════════════════════════════════════════════════
// 1. RateLimiterMemory — check()
// ════════════════════════════════════════════════════════════

test('RateLimiterMemory: בקשה ראשונה מותרת', () => {
  const rl = new RateLimiterMemory();
  const r = rl.check('1.2.3.4', '/api');
  assert(r.allowed === true, `expected allowed=true, got ${r.allowed}`);
  assert(r.remaining === MAX_REQUESTS_PER_WINDOW - 1);
});

test('RateLimiterMemory: 100 בקשות מותרות', () => {
  const rl = new RateLimiterMemory();
  let last;
  for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
    last = rl.check('5.5.5.5', '/');
  }
  assert(last.allowed === true, `request #100 should be allowed`);
  assert(last.remaining === 0);
});

test('RateLimiterMemory: בקשה 101 חסומה', () => {
  const rl = new RateLimiterMemory();
  for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) rl.check('6.6.6.6', '/');
  const over = rl.check('6.6.6.6', '/');
  assert(over.allowed === false, `expected blocked`);
  assert(over.blockedUntil !== null);
});

test('RateLimiterMemory: IPs שונים עצמאיים', () => {
  const rl = new RateLimiterMemory();
  // חרג IP אחד
  for (let i = 0; i <= MAX_REQUESTS_PER_WINDOW; i++) rl.check('10.0.0.1', '/');
  // IP שני לא מושפע
  const r = rl.check('10.0.0.2', '/');
  assert(r.allowed === true, 'different IP should not be blocked');
});

test('RateLimiterMemory: endpoints שונים עצמאיים', () => {
  const rl = new RateLimiterMemory();
  for (let i = 0; i <= MAX_REQUESTS_PER_WINDOW; i++) rl.check('7.7.7.7', '/api/deals');
  const r = rl.check('7.7.7.7', '/api/stores');
  assert(r.allowed === true, 'different endpoint should not be blocked');
});

// ════════════════════════════════════════════════════════════
// 2. RateLimiterMemory — isBlocked()
// ════════════════════════════════════════════════════════════

test('isBlocked: לא חסום בתחילה', () => {
  const rl = new RateLimiterMemory();
  assert(rl.isBlocked('9.9.9.9') === false);
});

test('isBlocked: חסום אחרי חריגה', () => {
  const rl = new RateLimiterMemory();
  for (let i = 0; i <= MAX_REQUESTS_PER_WINDOW; i++) rl.check('8.8.8.8', '/');
  assert(rl.isBlocked('8.8.8.8', '/') === true, 'should be blocked after exceeding limit');
});

// ════════════════════════════════════════════════════════════
// 3. RateLimiterMemory — getTopAbusers()
// ════════════════════════════════════════════════════════════

test('getTopAbusers: ממוין לפי count', () => {
  const rl = new RateLimiterMemory();
  for (let i = 0; i < 5;  i++) rl.check('low.ip', '/');
  for (let i = 0; i < 50; i++) rl.check('high.ip', '/');
  const abusers = rl.getTopAbusers(2);
  assert(abusers[0].ip === 'high.ip', `expected high.ip first, got ${abusers[0].ip}`);
  assert(abusers[0].count > abusers[1].count);
});

test('getTopAbusers: מגביל ל-limit', () => {
  const rl = new RateLimiterMemory();
  ['a','b','c','d','e'].forEach(ip => rl.check(ip, '/'));
  const top = rl.getTopAbusers(3);
  assert(top.length <= 3, `expected ≤3, got ${top.length}`);
});

// ════════════════════════════════════════════════════════════
// 4. formatBlockedResponse
// ════════════════════════════════════════════════════════════

test('formatBlockedResponse: status 429', () => {
  const r = formatBlockedResponse(Date.now() + 60000);
  assert(r.status === 429);
});

test('formatBlockedResponse: retryAfter חיובי', () => {
  const r = formatBlockedResponse(Date.now() + 60000);
  assert(r.retryAfter > 0, `expected positive retryAfter, got ${r.retryAfter}`);
});

test('formatBlockedResponse: מכיל message', () => {
  const r = formatBlockedResponse(Date.now() + 30000);
  assert(typeof r.message === 'string' && r.message.length > 0);
});

// ════════════════════════════════════════════════════════════
// 5. shouldCleanup
// ════════════════════════════════════════════════════════════

test('shouldCleanup: true אם אין cleanup קודם', () => {
  assert(shouldCleanup(null) === true);
});

test('shouldCleanup: false אם cleanup היה זה עתה', () => {
  assert(shouldCleanup(new Date()) === false);
});

test('shouldCleanup: true אם עבר מספיק זמן', () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  assert(shouldCleanup(twoDaysAgo, 24 * 60 * 60 * 1000) === true);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-37 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
