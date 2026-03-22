// bot62.test.mjs — בדיקות יחידה ל-BOT-62 GDPR Manager
// הרץ: node bot62.test.mjs
// ════════════════════════════════════════════════════════════

import {
  anonymizeEmail,
  isRetentionExpired,
  buildDeletionSummary,
  maskIpAddress,
  shouldAnonymizeUser,
  generateComplianceToken,
} from './bot62.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ════════════════════════════════════════════════════════════
// 1. anonymizeEmail
// ════════════════════════════════════════════════════════════

test('anonymizeEmail: starts with deleted_ and ends with @deleted.invalid', () => {
  const result = anonymizeEmail('john@example.com');
  assert(result.startsWith('deleted_'), `expected deleted_ prefix, got: ${result}`);
  assert(result.endsWith('@deleted.invalid'), `expected @deleted.invalid suffix, got: ${result}`);
});

test('anonymizeEmail: output is deterministic for same input', () => {
  const r1 = anonymizeEmail('john@example.com');
  const r2 = anonymizeEmail('john@example.com');
  assert(r1 === r2, `expected same output, got: ${r1} vs ${r2}`);
});

test('anonymizeEmail: different emails produce different hashes', () => {
  const r1 = anonymizeEmail('alice@example.com');
  const r2 = anonymizeEmail('bob@example.com');
  assert(r1 !== r2, `expected different hashes, got: ${r1} === ${r2}`);
});

// ════════════════════════════════════════════════════════════
// 2. isRetentionExpired
// ════════════════════════════════════════════════════════════

test('isRetentionExpired: 100 days old, retention=90 → true', () => {
  const now      = new Date('2026-03-17T00:00:00Z');
  const created  = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
  assert(isRetentionExpired(created, 90, now) === true, 'expected true');
});

test('isRetentionExpired: 30 days old, retention=90 → false', () => {
  const now      = new Date('2026-03-17T00:00:00Z');
  const created  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  assert(isRetentionExpired(created, 90, now) === false, 'expected false');
});

test('isRetentionExpired: null createdAt → false (safe default)', () => {
  assert(isRetentionExpired(null, 90) === false, 'expected false for null');
});

// ════════════════════════════════════════════════════════════
// 3. maskIpAddress
// ════════════════════════════════════════════════════════════

test('maskIpAddress: 192.168.1.100 → 192.168.1.x', () => {
  assert(maskIpAddress('192.168.1.100') === '192.168.1.x', `got: ${maskIpAddress('192.168.1.100')}`);
});

test('maskIpAddress: 10.0.0.1 → 10.0.0.x', () => {
  assert(maskIpAddress('10.0.0.1') === '10.0.0.x', `got: ${maskIpAddress('10.0.0.1')}`);
});

test('maskIpAddress: IPv6 2001:db8::1 → 2001:db8::x', () => {
  const result = maskIpAddress('2001:db8::1');
  assert(result.endsWith(':x'), `expected :x suffix, got: ${result}`);
  assert(result.startsWith('2001:db8:'), `expected 2001:db8: prefix, got: ${result}`);
});

// ════════════════════════════════════════════════════════════
// 4. shouldAnonymizeUser
// ════════════════════════════════════════════════════════════

test('shouldAnonymizeUser: inactive 3 years → true', () => {
  const now  = new Date('2026-03-17T00:00:00Z');
  const user = {
    last_sign_in_at:    new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    deletion_requested: false,
  };
  assert(shouldAnonymizeUser(user, now) === true, 'expected true for 3-year inactive');
});

test('shouldAnonymizeUser: deletion_requested=true → true', () => {
  const user = { deletion_requested: true, last_sign_in_at: new Date().toISOString() };
  assert(shouldAnonymizeUser(user) === true, 'expected true for deletion_requested');
});

test('shouldAnonymizeUser: active user → false', () => {
  const now  = new Date('2026-03-17T00:00:00Z');
  const user = {
    last_sign_in_at:    new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    deletion_requested: false,
  };
  assert(shouldAnonymizeUser(user, now) === false, 'expected false for active user');
});

// ════════════════════════════════════════════════════════════
// 5. generateComplianceToken
// ════════════════════════════════════════════════════════════

test('generateComplianceToken: returns 64-char hex string', () => {
  const token = generateComplianceToken();
  assert(typeof token === 'string', 'expected string');
  assert(token.length === 64, `expected 64 chars, got ${token.length}`);
  assert(/^[0-9a-f]+$/i.test(token), `expected hex string, got: ${token}`);
});

// ════════════════════════════════════════════════════════════
// 6. buildDeletionSummary
// ════════════════════════════════════════════════════════════

test('buildDeletionSummary: returns correct shape', () => {
  const summary = buildDeletionSummary('user-123', ['click_log', 'wishlists']);
  assert(summary.userId === 'user-123', `expected userId=user-123, got: ${summary.userId}`);
  assert(Array.isArray(summary.deletedFrom), 'deletedFrom should be array');
  assert(summary.deletedFrom.includes('click_log'), 'should include click_log');
  assert(Array.isArray(summary.anonymizedFields), 'anonymizedFields should be array');
  assert(summary.anonymizedFields.includes('email'), 'should include email field');
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-62 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
