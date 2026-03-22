// bot38.test.mjs — בדיקות יחידה ל-BOT-38 Click Fraud Detector
// הרץ: node bot38.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isFraudByIpDeal,
  isFraudByIpTotal,
  isFraudByUser,
  detectFraudReasons,
  groupClicksByIpDeal,
  scoreClickSuspicion,
  formatFraudSummary,
  MAX_CLICKS_PER_IP_PER_DEAL,
  MAX_CLICKS_PER_IP_TOTAL,
  MAX_CLICKS_PER_USER,
  FRAUD_WINDOW_MS,
} from './bot38.mjs';

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

// ── helpers ─────────────────────────────────────────────────

function makeClicks(ip, dealId, count, minsAgo = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id:          `click-${Math.random()}`,
    ip_address:  ip,
    deal_id:     dealId,
    user_id:     null,
    clicked_at:  new Date(Date.now() - (minsAgo * 60000) - i).toISOString(),
    is_fraud:    false,
  }));
}

// ════════════════════════════════════════════════════════════
// 1. isFraudByIpDeal
// ════════════════════════════════════════════════════════════

test('isFraudByIpDeal: false כשפחות מ-MAX קליקים', () => {
  const clicks = makeClicks('1.2.3.4', 'deal-A', MAX_CLICKS_PER_IP_PER_DEAL);
  assert(isFraudByIpDeal(clicks, '1.2.3.4', 'deal-A') === false);
});

test('isFraudByIpDeal: true כשיותר מ-MAX', () => {
  const clicks = makeClicks('1.2.3.4', 'deal-A', MAX_CLICKS_PER_IP_PER_DEAL + 1);
  assert(isFraudByIpDeal(clicks, '1.2.3.4', 'deal-A') === true);
});

test('isFraudByIpDeal: IP אחר לא מסומן', () => {
  const clicks = makeClicks('1.2.3.4', 'deal-A', MAX_CLICKS_PER_IP_PER_DEAL + 5);
  assert(isFraudByIpDeal(clicks, '9.9.9.9', 'deal-A') === false);
});

test('isFraudByIpDeal: קליקים מחוץ לחלון לא נספרים', () => {
  const oldClicks = makeClicks('1.2.3.4', 'deal-A', MAX_CLICKS_PER_IP_PER_DEAL + 5, 120); // 2h ago
  // חלון 30 דקות
  assert(isFraudByIpDeal(oldClicks, '1.2.3.4', 'deal-A', 30 * 60000) === false);
});

// ════════════════════════════════════════════════════════════
// 2. isFraudByIpTotal
// ════════════════════════════════════════════════════════════

test('isFraudByIpTotal: true כשיותר מ-MAX total', () => {
  const clicks = [
    ...makeClicks('2.2.2.2', 'deal-1', 15),
    ...makeClicks('2.2.2.2', 'deal-2', 16),
  ];
  assert(isFraudByIpTotal(clicks, '2.2.2.2') === true);
});

test('isFraudByIpTotal: false עבור IP תקין', () => {
  const clicks = makeClicks('3.3.3.3', 'deal-X', 5);
  assert(isFraudByIpTotal(clicks, '3.3.3.3') === false);
});

// ════════════════════════════════════════════════════════════
// 3. isFraudByUser
// ════════════════════════════════════════════════════════════

test('isFraudByUser: true כשיותר מ-MAX', () => {
  const clicks = Array.from({ length: MAX_CLICKS_PER_USER + 1 }, (_, i) => ({
    id:         `c-${i}`,
    ip_address: `ip-${i}`,
    deal_id:    `deal-${i}`,
    user_id:    'user-123',
    clicked_at: new Date().toISOString(),
    is_fraud:   false,
  }));
  assert(isFraudByUser(clicks, 'user-123') === true);
});

test('isFraudByUser: null user_id לא מסומן', () => {
  const clicks = makeClicks('1.1.1.1', 'deal-Y', 50);
  clicks.forEach(c => c.user_id = null);
  assert(isFraudByUser(clicks, null) === false);
});

// ════════════════════════════════════════════════════════════
// 4. detectFraudReasons
// ════════════════════════════════════════════════════════════

test('detectFraudReasons: [] עבור קליק לגיטימי', () => {
  const allClicks = makeClicks('4.4.4.4', 'deal-1', 2);
  const reasons = detectFraudReasons(allClicks[0], allClicks);
  assert(reasons.length === 0, `expected [], got: ${JSON.stringify(reasons)}`);
});

test('detectFraudReasons: מחזיר סיבה עבור חריגה', () => {
  const allClicks = makeClicks('5.5.5.5', 'deal-1', MAX_CLICKS_PER_IP_PER_DEAL + 2);
  const reasons = detectFraudReasons(allClicks[0], allClicks);
  assert(reasons.length > 0, 'expected fraud reasons');
  assert(reasons[0].includes('ip_deal_exceeded'));
});

// ════════════════════════════════════════════════════════════
// 5. groupClicksByIpDeal
// ════════════════════════════════════════════════════════════

test('groupClicksByIpDeal: מקבץ נכון', () => {
  const clicks = [
    { ip_address: '1.1.1.1', deal_id: 'A' },
    { ip_address: '1.1.1.1', deal_id: 'A' },
    { ip_address: '1.1.1.1', deal_id: 'B' },
    { ip_address: '2.2.2.2', deal_id: 'A' },
  ];
  const groups = groupClicksByIpDeal(clicks);
  assert(groups.get('1.1.1.1:A').length === 2);
  assert(groups.get('1.1.1.1:B').length === 1);
  assert(groups.get('2.2.2.2:A').length === 1);
});

// ════════════════════════════════════════════════════════════
// 6. scoreClickSuspicion
// ════════════════════════════════════════════════════════════

test('scoreClickSuspicion: ציון גבוה לדפוס חשוד', () => {
  const suspiciousClicks = makeClicks('6.6.6.6', 'deal-Z', MAX_CLICKS_PER_IP_PER_DEAL + 5);
  const score = scoreClickSuspicion(suspiciousClicks[0], suspiciousClicks);
  assert(score > 50, `expected score >50, got ${score}`);
});

test('scoreClickSuspicion: ציון נמוך לקליק תקין', () => {
  const normalClicks = makeClicks('7.7.7.7', 'deal-X', 2);
  const score = scoreClickSuspicion(normalClicks[0], normalClicks);
  assert(score < 50, `expected score <50, got ${score}`);
});

// ════════════════════════════════════════════════════════════
// 7. formatFraudSummary
// ════════════════════════════════════════════════════════════

test('formatFraudSummary: פורמט נכון', () => {
  const msg = formatFraudSummary(5, 100);
  assert(msg.includes('5'), `missing count: ${msg}`);
  assert(msg.includes('100'), `missing total: ${msg}`);
  assert(msg.includes('%'), `missing pct: ${msg}`);
});

test('formatFraudSummary: 0 מתוך 0 לא קורס', () => {
  const msg = formatFraudSummary(0, 0);
  assert(typeof msg === 'string' && msg.length > 0);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-38 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
