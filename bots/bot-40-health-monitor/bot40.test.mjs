// bot40.test.mjs — בדיקות יחידה ל-BOT-40 Health Monitor
// הרץ: node bot40.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isHealthy,
  shouldAlert,
  buildAlertMessage,
  getServiceEmoji,
  parseServiceResult,
  formatHealthSummary,
  PING_TIMEOUT_MS,
  ALERT_COOLDOWN_MS,
} from './bot40.mjs';

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
// 1. isHealthy
// ════════════════════════════════════════════════════════════

test('isHealthy: true עבור תגובה מהירה + 200', () => {
  assert(isHealthy(123, 200) === true);
});

test('isHealthy: false עבור timeout (ms >= PING_TIMEOUT)', () => {
  assert(isHealthy(PING_TIMEOUT_MS, 200) === false);
  assert(isHealthy(PING_TIMEOUT_MS + 1000, null) === false);
});

test('isHealthy: false עבור 5xx', () => {
  assert(isHealthy(100, 500) === false);
  assert(isHealthy(100, 503) === false);
});

test('isHealthy: true עבור 4xx (השרת עונה)', () => {
  assert(isHealthy(200, 404) === true);
  assert(isHealthy(200, 403) === true);
});

test('isHealthy: false כש-ms הוא null', () => {
  assert(isHealthy(null, 200) === false);
});

// ════════════════════════════════════════════════════════════
// 2. shouldAlert
// ════════════════════════════════════════════════════════════

test('shouldAlert: true אם לא הייתה התראה', () => {
  assert(shouldAlert(null) === true);
  assert(shouldAlert(undefined) === true);
});

test('shouldAlert: false אם הייתה התראה לאחרונה', () => {
  assert(shouldAlert(new Date()) === false);
});

test('shouldAlert: true אם עבר cooldown', () => {
  const longAgo = new Date(Date.now() - ALERT_COOLDOWN_MS - 60000);
  assert(shouldAlert(longAgo) === true);
});

// ════════════════════════════════════════════════════════════
// 3. buildAlertMessage
// ════════════════════════════════════════════════════════════

test('buildAlertMessage: מכיל שם שירות', () => {
  const msg = buildAlertMessage('supabase', 'Connection refused', 5100);
  assert(msg.includes('supabase'), `missing service: ${msg}`);
});

test('buildAlertMessage: מכיל הודעת שגיאה', () => {
  const msg = buildAlertMessage('site', 'ECONNREFUSED', null);
  assert(msg.includes('ECONNREFUSED'), `missing error: ${msg}`);
});

test('buildAlertMessage: מכיל זמן', () => {
  const msg = buildAlertMessage('railway', null, 200);
  assert(msg.includes('Time:'), `missing time: ${msg}`);
});

// ════════════════════════════════════════════════════════════
// 4. getServiceEmoji
// ════════════════════════════════════════════════════════════

test('getServiceEmoji: ✅ עבור ok', () => {
  assert(getServiceEmoji(true) === '✅');
});

test('getServiceEmoji: ❌ עבור down', () => {
  assert(getServiceEmoji(false) === '❌');
});

// ════════════════════════════════════════════════════════════
// 5. parseServiceResult
// ════════════════════════════════════════════════════════════

test('parseServiceResult: מבנה נכון', () => {
  const r = parseServiceResult('supabase', true, 123, null);
  assert(r.service === 'supabase');
  assert(r.ok === true);
  assert(r.ms === 123);
  assert(r.error === null);
  assert(r.status === 'ok');
  assert(typeof r.checkedAt === 'string');
});

test('parseServiceResult: status=timeout עבור ms גדול', () => {
  const r = parseServiceResult('site', false, PING_TIMEOUT_MS + 1, 'timeout');
  assert(r.status === 'timeout');
});

// ════════════════════════════════════════════════════════════
// 6. formatHealthSummary
// ════════════════════════════════════════════════════════════

test('formatHealthSummary: מכיל emoji ושמות שירותים', () => {
  const results = [
    parseServiceResult('supabase', true, 50, null),
    parseServiceResult('site', false, 5001, 'timeout'),
  ];
  const summary = formatHealthSummary(results);
  assert(summary.includes('✅'), `missing ✅: ${summary}`);
  assert(summary.includes('❌'), `missing ❌: ${summary}`);
  assert(summary.includes('supabase'), `missing supabase: ${summary}`);
  assert(summary.includes('site'), `missing site: ${summary}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-40 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
