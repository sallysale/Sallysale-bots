// bot46.test.mjs — unit tests for BOT-46 Abandonment Bot
// No DB, no HTTP calls — pure function tests only.

import {
  isAbandoned,
  shouldSkipUser,
  formatDealUrl,
  getSubjectLine,
  buildAbandonmentEmail,
} from './bot46.mjs';

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

// ── Helpers ────────────────────────────────────────────────
const THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

// ══════════════════════════════════════════════════════════
// isAbandoned
// ══════════════════════════════════════════════════════════

test('isAbandoned: viewed 3h ago, no click → true', () => {
  const result = isAbandoned(hoursAgo(3), null, THRESHOLD_MS);
  assert(result === true, `Expected true, got ${result}`);
});

test('isAbandoned: viewed 1h ago, no click → false (below threshold)', () => {
  const result = isAbandoned(hoursAgo(1), null, THRESHOLD_MS);
  assert(result === false, `Expected false, got ${result}`);
});

test('isAbandoned: viewed 3h ago, clicked → false', () => {
  const result = isAbandoned(hoursAgo(3), hoursAgo(2), THRESHOLD_MS);
  assert(result === false, `Expected false, got ${result}`);
});

test('isAbandoned: no viewedAt → false', () => {
  const result = isAbandoned(null, null, THRESHOLD_MS);
  assert(result === false, `Expected false, got ${result}`);
});

test('isAbandoned: exactly at threshold boundary → false (not yet exceeded)', () => {
  // viewedAt is exactly THRESHOLD_MS ago — should be false because >= is needed
  const viewedAt = new Date(Date.now() - THRESHOLD_MS + 1000); // 1 second short
  const result = isAbandoned(viewedAt, null, THRESHOLD_MS);
  assert(result === false, `Expected false at boundary, got ${result}`);
});

test('isAbandoned: viewed 5h ago, custom 4h threshold → true', () => {
  const result = isAbandoned(hoursAgo(5), null, 4 * 60 * 60 * 1000);
  assert(result === true, `Expected true, got ${result}`);
});

test('isAbandoned: invalid viewedAt string → false', () => {
  const result = isAbandoned('not-a-date', null, THRESHOLD_MS);
  assert(result === false, `Expected false for invalid date, got ${result}`);
});

// ══════════════════════════════════════════════════════════
// shouldSkipUser
// ══════════════════════════════════════════════════════════

test('shouldSkipUser: within cooldown → true', () => {
  const lastSentAt = hoursAgo(12); // 12h ago, cooldown 24h
  const result = shouldSkipUser(lastSentAt, 24);
  assert(result === true, `Expected true, got ${result}`);
});

test('shouldSkipUser: outside cooldown → false', () => {
  const lastSentAt = hoursAgo(25); // 25h ago, cooldown 24h
  const result = shouldSkipUser(lastSentAt, 24);
  assert(result === false, `Expected false, got ${result}`);
});

test('shouldSkipUser: null lastSentAt → false', () => {
  const result = shouldSkipUser(null, 24);
  assert(result === false, `Expected false for null lastSentAt, got ${result}`);
});

test('shouldSkipUser: just sent 1min ago → true', () => {
  const lastSentAt = new Date(Date.now() - 60 * 1000); // 1 minute ago
  const result = shouldSkipUser(lastSentAt, 24);
  assert(result === true, `Expected true, got ${result}`);
});

// ══════════════════════════════════════════════════════════
// formatDealUrl
// ══════════════════════════════════════════════════════════

test('formatDealUrl: returns correct URL format', () => {
  const url = formatDealUrl('abc-123', 'https://sallysale.com');
  assertEquals(url, 'https://sallysale.com/deals/abc-123', 'Incorrect URL format');
});

test('formatDealUrl: missing dealId returns baseUrl', () => {
  const url = formatDealUrl(null, 'https://sallysale.com');
  assertEquals(url, 'https://sallysale.com', 'Should return baseUrl when no dealId');
});

test('formatDealUrl: uses SITE_URL default when baseUrl omitted', () => {
  const url = formatDealUrl('deal-99');
  assert(url.includes('/deals/deal-99'), `Expected URL with /deals/deal-99, got ${url}`);
});

// ══════════════════════════════════════════════════════════
// getSubjectLine
// ══════════════════════════════════════════════════════════

test('getSubjectLine: includes deal title', () => {
  const subject = getSubjectLine('Nike Air Max', 30);
  assert(subject.includes('Nike Air Max'), `Expected title in subject, got: ${subject}`);
});

test('getSubjectLine: includes discount percentage', () => {
  const subject = getSubjectLine('Nike Air Max', 30);
  assert(subject.includes('30%'), `Expected 30% in subject, got: ${subject}`);
});

test('getSubjectLine: handles missing discount gracefully', () => {
  const subject = getSubjectLine('Nike Air Max', null);
  assert(typeof subject === 'string' && subject.length > 0, 'Expected non-empty string');
  assert(!subject.includes('undefined') && !subject.includes('null'),
    `Subject should not contain undefined/null: ${subject}`);
});

test('getSubjectLine: handles missing title gracefully', () => {
  const subject = getSubjectLine(null, 20);
  assert(typeof subject === 'string' && subject.length > 0, 'Expected non-empty string');
  assert(!subject.includes('null'), `Subject should not contain null: ${subject}`);
});

test('getSubjectLine: zero discount shows non-percentage version', () => {
  const subject = getSubjectLine('Sony Headphones', 0);
  assert(typeof subject === 'string', 'Expected string result');
  // 0 discount should not show "0%"
  assert(!subject.includes('0%'), `Should not show 0% discount: ${subject}`);
});

// ══════════════════════════════════════════════════════════
// buildAbandonmentEmail
// ══════════════════════════════════════════════════════════

test('buildAbandonmentEmail: returns subject and html', () => {
  const user = { email: 'test@example.com', name: 'Test User' };
  const deal = { id: 'deal-1', title: 'Nike Air Max', price: 79.99, currency: 'USD', discount: 30 };
  const result = buildAbandonmentEmail(user, deal, 'https://sallysale.com');

  assert(typeof result === 'object', 'Expected object result');
  assert(typeof result.subject === 'string' && result.subject.length > 0, 'Expected subject string');
  assert(typeof result.html === 'string' && result.html.length > 0, 'Expected html string');
});

test('buildAbandonmentEmail: html contains deal title', () => {
  const user = { email: 'test@example.com', name: 'Test' };
  const deal = { id: 'deal-2', title: 'Adidas Ultraboost', price: 120, currency: 'USD', discount: 25 };
  const { html } = buildAbandonmentEmail(user, deal, 'https://sallysale.com');

  assert(html.includes('Adidas Ultraboost'), `HTML should contain deal title. Got: ${html.substring(0, 200)}`);
});

test('buildAbandonmentEmail: html contains deal URL', () => {
  const user = { email: 'test@example.com', name: 'Test' };
  const deal = { id: 'deal-3', title: 'Zara Jacket', seo_slug: 'zara-jacket-sale', price: 60, currency: 'EUR' };
  const { html } = buildAbandonmentEmail(user, deal, 'https://sallysale.com');

  assert(html.includes('/deals/zara-jacket-sale') || html.includes('/deals/deal-3'),
    'HTML should contain deal URL');
});

test('buildAbandonmentEmail: subject mentions deal title', () => {
  const user = { email: 'test@example.com', name: 'Test' };
  const deal = { id: 'deal-4', title: 'Samsung Galaxy S25', price: 799, currency: 'USD', discount: 15 };
  const { subject } = buildAbandonmentEmail(user, deal, 'https://sallysale.com');

  assert(subject.includes('Samsung Galaxy S25'), `Subject should mention deal title. Got: ${subject}`);
});

test('buildAbandonmentEmail: html valid structure (has DOCTYPE)', () => {
  const user = { email: 'a@b.com', name: 'A' };
  const deal = { id: 'deal-5', title: 'Test Deal', price: 50, currency: 'USD' };
  const { html } = buildAbandonmentEmail(user, deal, 'https://sallysale.com');

  assert(html.startsWith('<!DOCTYPE html>'), 'HTML should start with DOCTYPE');
  assert(html.includes('</html>'), 'HTML should close html tag');
});

test('buildAbandonmentEmail: handles deal without image gracefully', () => {
  const user = { email: 'x@y.com', name: 'X' };
  const deal = { id: 'deal-6', title: 'No Image Deal', price: 30, currency: 'USD' };
  const { html } = buildAbandonmentEmail(user, deal, 'https://sallysale.com');

  assert(html.includes('No Image Deal'), 'HTML should contain deal title even without image');
});

// ══════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-46 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.log(`\nFailed tests:`);
  FAILED.forEach(name => console.log(`  ✗ ${name}`));
  process.exit(1);
}
