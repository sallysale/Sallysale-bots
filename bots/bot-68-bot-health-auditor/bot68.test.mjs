// bot68.test.mjs — בדיקות יחידה ל-BOT-68 Bot Health Auditor
// הרץ: node bot68.test.mjs
// ════════════════════════════════════════════════════════════

import {
  computeBotSuccessRate,
  getLastRunStatus,
  detectStaleBots,
  buildHealthSummary,
  classifyBotHealth,
  formatHealthReport,
} from './bot68.mjs';

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
// Helpers
// ════════════════════════════════════════════════════════════

function makeLogs(statuses, baseTime = new Date()) {
  return statuses.map((status, i) => ({
    status,
    started_at: new Date(baseTime.getTime() - i * 60 * 60 * 1000).toISOString(),
    errors: status === 'error' ? [`error ${i}`] : [],
  }));
}

// ════════════════════════════════════════════════════════════
// 1. computeBotSuccessRate
// ════════════════════════════════════════════════════════════

test('computeBotSuccessRate: 8 done + 2 error → 80', () => {
  const logs = makeLogs(['done','done','done','done','done','done','done','done','error','error']);
  assertEq(computeBotSuccessRate(logs), 80);
});

test('computeBotSuccessRate: all done → 100', () => {
  const logs = makeLogs(['done','done','done']);
  assertEq(computeBotSuccessRate(logs), 100);
});

test('computeBotSuccessRate: empty → 0', () => {
  assertEq(computeBotSuccessRate([]), 0);
  assertEq(computeBotSuccessRate(null), 0);
});

test('computeBotSuccessRate: all errors → 0', () => {
  const logs = makeLogs(['error','error','error']);
  assertEq(computeBotSuccessRate(logs), 0);
});

// ════════════════════════════════════════════════════════════
// 2. getLastRunStatus
// ════════════════════════════════════════════════════════════

test('getLastRunStatus: returns most recent by timestamp', () => {
  const now = new Date();
  const older = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const logs = [
    { status: 'error',  started_at: older.toISOString(), errors: ['old error'] },
    { status: 'done',   started_at: now.toISOString(),   errors: [] },
  ];
  const result = getLastRunStatus(logs);
  assertEq(result.status, 'done');
  assertEq(result.timestamp, now.toISOString());
});

test('getLastRunStatus: empty logs → null', () => {
  assert(getLastRunStatus([]) === null);
  assert(getLastRunStatus(null) === null);
});

test('getLastRunStatus: returns errors array', () => {
  const logs = [{ status: 'error', started_at: new Date().toISOString(), errors: ['err1', 'err2'] }];
  const result = getLastRunStatus(logs);
  assert(Array.isArray(result.errors));
  assertEq(result.errors.length, 2);
});

// ════════════════════════════════════════════════════════════
// 3. detectStaleBots
// ════════════════════════════════════════════════════════════

test('detectStaleBots: bot last ran 25h ago (threshold=24) → detected', () => {
  const now = new Date();
  const logs25h = [{ status: 'done', started_at: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(), errors: [] }];
  const stale = detectStaleBots({ 'BOT-01': logs25h }, 24, now);
  assert(stale.includes('BOT-01'), 'BOT-01 should be stale');
});

test('detectStaleBots: bot last ran 23h ago (threshold=24) → not detected', () => {
  const now = new Date();
  const logs23h = [{ status: 'done', started_at: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(), errors: [] }];
  const stale = detectStaleBots({ 'BOT-02': logs23h }, 24, now);
  assert(!stale.includes('BOT-02'), 'BOT-02 should NOT be stale');
});

test('detectStaleBots: bot with no logs → detected', () => {
  const now = new Date();
  const stale = detectStaleBots({ 'BOT-EMPTY': [] }, 24, now);
  assert(stale.includes('BOT-EMPTY'), 'BOT-EMPTY should be stale');
});

// ════════════════════════════════════════════════════════════
// 4. buildHealthSummary
// ════════════════════════════════════════════════════════════

test('buildHealthSummary: counts by status correctly', () => {
  const botStats = [
    { health_status: 'healthy' },
    { health_status: 'healthy' },
    { health_status: 'warning' },
    { health_status: 'critical' },
    { health_status: 'stale' },
    { health_status: 'stale' },
  ];
  const summary = buildHealthSummary(botStats);
  assertEq(summary.healthy, 2);
  assertEq(summary.warning, 1);
  assertEq(summary.critical, 1);
  assertEq(summary.stale, 2);
  assertEq(summary.total, 6);
});

test('buildHealthSummary: empty → all zeros', () => {
  const summary = buildHealthSummary([]);
  assertEq(summary.total, 0);
  assertEq(summary.healthy, 0);
});

// ════════════════════════════════════════════════════════════
// 5. classifyBotHealth
// ════════════════════════════════════════════════════════════

test('classifyBotHealth: 95% success, 2h ago → "healthy"', () => {
  assertEq(classifyBotHealth(95, 2), 'healthy');
});

test('classifyBotHealth: 80% success, 24h ago → "healthy" (boundary)', () => {
  assertEq(classifyBotHealth(80, 24), 'healthy');
});

test('classifyBotHealth: 60% success → "warning"', () => {
  assertEq(classifyBotHealth(60, 5), 'warning');
});

test('classifyBotHealth: 20% success → "critical"', () => {
  assertEq(classifyBotHealth(20, 5), 'critical');
});

test('classifyBotHealth: never ran (null) → "stale"', () => {
  assertEq(classifyBotHealth(0, null), 'stale');
  assertEq(classifyBotHealth(100, null), 'stale');
});

// ════════════════════════════════════════════════════════════
// 6. formatHealthReport
// ════════════════════════════════════════════════════════════

test('formatHealthReport: includes bot counts', () => {
  const summary = { healthy: 3, warning: 1, critical: 1, stale: 0, total: 5 };
  const botStats = [
    { bot_id: 'BOT-01', health_status: 'healthy',  success_rate: 100 },
    { bot_id: 'BOT-02', health_status: 'critical', success_rate: 10  },
  ];
  const report = formatHealthReport(summary, botStats);
  assert(report.includes('5'),  `missing total: ${report}`);
  assert(report.includes('3'),  `missing healthy count: ${report}`);
});

test('formatHealthReport: mentions critical bots by name', () => {
  const summary = { healthy: 0, warning: 0, critical: 2, stale: 0, total: 2 };
  const botStats = [
    { bot_id: 'BOT-07', health_status: 'critical', success_rate: 5  },
    { bot_id: 'BOT-09', health_status: 'critical', success_rate: 15 },
  ];
  const report = formatHealthReport(summary, botStats);
  assert(report.includes('BOT-07'), `missing BOT-07: ${report}`);
  assert(report.includes('BOT-09'), `missing BOT-09: ${report}`);
  assert(report.toLowerCase().includes('critical'), `missing 'critical': ${report}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-68 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
