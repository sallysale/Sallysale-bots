// bot64.test.mjs — בדיקות יחידה ל-BOT-64 Returns Policy
// הרץ: node bot64.test.mjs
// ════════════════════════════════════════════════════════════

import {
  detectReturnPolicy,
  parseReturnDays,
  classifyReturnPolicy,
  formatReturnBadge,
  buildReturnSummary,
  isGoodReturnPolicy,
  extractPolicyFromText,
} from './bot64.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`\u2705 ${name}`); }
  catch (e) { FAILED.push(name); console.error(`\u274c ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ════════════════════════════════════════════════════════════
// 1. detectReturnPolicy
// ════════════════════════════════════════════════════════════

test('detectReturnPolicy: 30-day free returns → true', () => {
  assert(detectReturnPolicy('30-day free returns policy') === true);
});

test('detectReturnPolicy: generic description → false', () => {
  assert(detectReturnPolicy('Buy now and save big!') === false);
});

test('detectReturnPolicy: No returns accepted → true', () => {
  assert(detectReturnPolicy('No returns accepted after purchase') === true);
});

test('detectReturnPolicy: Exchange only policy → true', () => {
  assert(detectReturnPolicy('Exchange only policy applies to all items') === true);
});

test('detectReturnPolicy: All sales final → true', () => {
  assert(detectReturnPolicy('All sales final — no refunds') === true);
});

test('detectReturnPolicy: restocking fee → true', () => {
  assert(detectReturnPolicy('A 15% restocking fee applies to all returns') === true);
});

// ════════════════════════════════════════════════════════════
// 2. parseReturnDays
// ════════════════════════════════════════════════════════════

test('parseReturnDays: 30-day return policy → 30', () => {
  assert(parseReturnDays('30-day return policy') === 30, `got: ${parseReturnDays('30-day return policy')}`);
});

test('parseReturnDays: 60 days to return → 60', () => {
  assert(parseReturnDays('You have 60 days to return your item') === 60, `got: ${parseReturnDays('You have 60 days to return your item')}`);
});

test('parseReturnDays: free returns (no number) → null', () => {
  assert(parseReturnDays('free returns available') === null, `got: ${parseReturnDays('free returns available')}`);
});

test('parseReturnDays: 90-day return window → 90', () => {
  assert(parseReturnDays('Enjoy a 90-day return window') === 90, `got: ${parseReturnDays('Enjoy a 90-day return window')}`);
});

// ════════════════════════════════════════════════════════════
// 3. classifyReturnPolicy
// ════════════════════════════════════════════════════════════

test('classifyReturnPolicy: 90 days free → excellent', () => {
  const r = classifyReturnPolicy({ days: 90, free: true, type: 'standard' });
  assert(r === 'excellent', `got: ${r}`);
});

test('classifyReturnPolicy: 30 days → good', () => {
  const r = classifyReturnPolicy({ days: 30, free: false, type: 'standard' });
  assert(r === 'good', `got: ${r}`);
});

test('classifyReturnPolicy: 14 days → basic', () => {
  const r = classifyReturnPolicy({ days: 14, free: false, type: 'standard' });
  assert(r === 'basic', `got: ${r}`);
});

test('classifyReturnPolicy: 0 days → none', () => {
  const r = classifyReturnPolicy({ days: 0, free: false, type: 'standard' });
  assert(r === 'none', `got: ${r}`);
});

test('classifyReturnPolicy: no_returns type → none', () => {
  const r = classifyReturnPolicy({ days: null, free: false, type: 'no_returns' });
  assert(r === 'none', `got: ${r}`);
});

test('classifyReturnPolicy: no data → unknown', () => {
  const r = classifyReturnPolicy({ days: null, free: false, type: 'unknown' });
  assert(r === 'unknown', `got: ${r}`);
});

// ════════════════════════════════════════════════════════════
// 4. formatReturnBadge
// ════════════════════════════════════════════════════════════

test('formatReturnBadge: excellent → contains checkmark', () => {
  const b = formatReturnBadge('excellent', 60);
  assert(b.includes('\u2705'), `got: ${b}`);
});

test('formatReturnBadge: none → contains X', () => {
  const b = formatReturnBadge('none');
  assert(b.includes('\u274c'), `got: ${b}`);
});

test('formatReturnBadge: good → contains warning', () => {
  const b = formatReturnBadge('good', 30);
  assert(b.includes('30'), `got: ${b}`);
});

// ════════════════════════════════════════════════════════════
// 5. buildReturnSummary
// ════════════════════════════════════════════════════════════

test('buildReturnSummary: returns best/worst/average', () => {
  const policies = [
    { days: 90, rating: 'excellent' },
    { days: 30, rating: 'good' },
    { days: 14, rating: 'basic' },
  ];
  const summary = buildReturnSummary(policies);
  assert(summary.best  === 'excellent', `best: ${summary.best}`);
  assert(summary.worst === 'basic',     `worst: ${summary.worst}`);
  assert(summary.average_days === 45,   `avg: ${summary.average_days}`);
});

test('buildReturnSummary: empty → unknown', () => {
  const summary = buildReturnSummary([]);
  assert(summary.best === 'unknown');
  assert(summary.average_days === null);
});

// ════════════════════════════════════════════════════════════
// 6. isGoodReturnPolicy
// ════════════════════════════════════════════════════════════

test('isGoodReturnPolicy: excellent → true', () => {
  assert(isGoodReturnPolicy('excellent') === true);
});

test('isGoodReturnPolicy: good → true', () => {
  assert(isGoodReturnPolicy('good') === true);
});

test('isGoodReturnPolicy: none → false', () => {
  assert(isGoodReturnPolicy('none') === false);
});

test('isGoodReturnPolicy: basic → false', () => {
  assert(isGoodReturnPolicy('basic') === false);
});

test('isGoodReturnPolicy: unknown → false', () => {
  assert(isGoodReturnPolicy('unknown') === false);
});

// ════════════════════════════════════════════════════════════
// 7. extractPolicyFromText (integration of pure functions)
// ════════════════════════════════════════════════════════════

test('extractPolicyFromText: 30-day free returns', () => {
  const p = extractPolicyFromText('We offer 30-day free returns on all items.');
  assert(p.days === 30,        `days: ${p.days}`);
  assert(p.free === true,      `free: ${p.free}`);
  assert(p.type === 'standard', `type: ${p.type}`);
});

test('extractPolicyFromText: no returns policy', () => {
  const p = extractPolicyFromText('All sales final — no returns accepted.');
  assert(p.type === 'no_returns', `type: ${p.type}`);
  assert(p.days === null,         `days: ${p.days}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(55)}`);
console.log(`BOT-64 Tests: ${PASSED.length} עברו \u2705, ${FAILED.length} נכשלו \u274c`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
