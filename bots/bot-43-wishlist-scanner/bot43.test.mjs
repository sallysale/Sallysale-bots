// bot43.test.mjs — בדיקות יחידה ל-BOT-43 Wishlist Scanner
// הרץ: node bot43.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isPriceDropped,
  isBelowTarget,
  shouldSendAlert,
  calcSavingsPct,
  formatDropPct,
  buildAlertData,
  filterTriggeredWishlists,
} from './bot43.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ════════════════════════════════════════════════════════════
// 1. isPriceDropped
// ════════════════════════════════════════════════════════════

test('isPriceDropped: מחזיר true כשירידה >= threshold', () => {
  // 100 → 85 = 15% drop, threshold=10
  assert(isPriceDropped(85, 100, 10) === true, 'expected true for 15% drop');
});

test('isPriceDropped: מחזיר false כשירידה < threshold', () => {
  // 100 → 95 = 5% drop, threshold=10
  assert(isPriceDropped(95, 100, 10) === false, 'expected false for 5% drop');
});

test('isPriceDropped: גבול — בדיוק threshold', () => {
  // 100 → 90 = 10% drop, threshold=10 → true (>=)
  assert(isPriceDropped(90, 100, 10) === true, 'expected true at exact threshold');
});

test('isPriceDropped: מטפל ב-null/zero originalPrice', () => {
  assert(isPriceDropped(80, null, 10)  === false, 'null originalPrice should be false');
  assert(isPriceDropped(80, 0,    10)  === false, 'zero originalPrice should be false');
  assert(isPriceDropped(0,  100,  10)  === false, 'zero currentPrice should be false');
});

// ════════════════════════════════════════════════════════════
// 2. isBelowTarget
// ════════════════════════════════════════════════════════════

test('isBelowTarget: מחזיר true כש-current <= target', () => {
  assert(isBelowTarget(49.99, 50) === true,  '49.99 <= 50 should be true');
  assert(isBelowTarget(50,    50) === true,  '50 == 50 should be true');
});

test('isBelowTarget: מחזיר false כש-current > target', () => {
  assert(isBelowTarget(51, 50) === false, '51 > 50 should be false');
});

test('isBelowTarget: מחזיר false כש-target הוא null', () => {
  assert(isBelowTarget(49, null) === false, 'null target should be false');
  assert(isBelowTarget(49, undefined) === false, 'undefined target should be false');
});

// ════════════════════════════════════════════════════════════
// 3. shouldSendAlert
// ════════════════════════════════════════════════════════════

test('shouldSendAlert: מחזיר true כשמעולם לא נשלחה התראה (null)', () => {
  assert(shouldSendAlert(null)        === true, 'null → should send');
  assert(shouldSendAlert(undefined)   === true, 'undefined → should send');
});

test('shouldSendAlert: מחזיר false כשנשלחה לפחות לפני cooldown', () => {
  const recentMs = Date.now() - 1000 * 60 * 60; // לפני שעה
  const recentIso = new Date(recentMs).toISOString();
  const cooldown  = 24 * 60 * 60 * 1000; // 24 hours
  assert(shouldSendAlert(recentIso, cooldown) === false, 'recent alert should block');
});

// ════════════════════════════════════════════════════════════
// 4. calcSavingsPct
// ════════════════════════════════════════════════════════════

test('calcSavingsPct: חישוב נכון', () => {
  // (100-75)/100 = 25%
  assert(calcSavingsPct(100, 75) === 25, `expected 25, got ${calcSavingsPct(100, 75)}`);
  // (200-150)/200 = 25%
  assert(calcSavingsPct(200, 150) === 25, `expected 25, got ${calcSavingsPct(200, 150)}`);
  // (99.99-49.99)/99.99 ≈ 50%
  const pct = calcSavingsPct(99.99, 49.99);
  assert(pct >= 49 && pct <= 51, `expected ~50, got ${pct}`);
});

test('calcSavingsPct: מטפל ב-zero originalPrice', () => {
  assert(calcSavingsPct(0, 50)   === 0, 'zero old → 0');
  assert(calcSavingsPct(100, 0)  === 100, 'zero new → 100%');
  assert(calcSavingsPct(null, 50) === 0, 'null → 0');
});

// ════════════════════════════════════════════════════════════
// 5. filterTriggeredWishlists
// ════════════════════════════════════════════════════════════

const MOCK_DEAL_1 = { id: 'deal-1', title: 'Sony Headphones', price: 79, original_price: 100, currency: 'USD', score: 85, status: 'active' };
const MOCK_DEAL_2 = { id: 'deal-2', title: 'Nike Shoes',      price: 45, original_price: 100, currency: 'USD', score: 80, status: 'active' };
const MOCK_DEAL_3 = { id: 'deal-3', title: 'IKEA Shelf',      price: 99, original_price: 100, currency: 'USD', score: 70, status: 'active' };

const MOCK_WISHLISTS = [
  // deal-1: ירד מ-100 ל-79 = 21% → price_drop
  { id: 'wl-1', user_id: 'user-1', deal_id: 'deal-1', target_price: null, added_at_price: 100, deal: MOCK_DEAL_1 },
  // deal-2: מחיר 45, target=50 → below_target
  { id: 'wl-2', user_id: 'user-2', deal_id: 'deal-2', target_price: 50, added_at_price: 100, deal: MOCK_DEAL_2 },
  // deal-3: ירד רק 1% → לא עומד בתנאים
  { id: 'wl-3', user_id: 'user-3', deal_id: 'deal-3', target_price: null, added_at_price: 100, deal: MOCK_DEAL_3 },
];

test('filterTriggeredWishlists: מחזיר triggers נכונים', () => {
  const dealsMap     = { 'deal-1': MOCK_DEAL_1, 'deal-2': MOCK_DEAL_2, 'deal-3': MOCK_DEAL_3 };
  const lastAlerts   = {}; // אין התראות קודמות
  const triggered    = filterTriggeredWishlists(MOCK_WISHLISTS, dealsMap, lastAlerts);

  // deal-1: 21% drop → price_drop ✅
  // deal-2: 45 <= 50 → below_target ✅
  // deal-3: 1% drop, no target → לא ✅
  assert(triggered.length === 2, `expected 2, got ${triggered.length}`);

  const reasons = triggered.map(t => t.reason);
  assert(reasons.includes('price_drop'),   'missing price_drop');
  assert(reasons.includes('below_target'), 'missing below_target');
});

// ════════════════════════════════════════════════════════════
// 6. buildAlertData
// ════════════════════════════════════════════════════════════

test('buildAlertData: מבנה נכון', () => {
  const wl   = MOCK_WISHLISTS[0]; // wl-1
  const deal = MOCK_DEAL_1;
  const alert = buildAlertData(wl, deal, 'price_drop');

  assert(alert.wishlist_id === 'wl-1',          `wishlist_id: ${alert.wishlist_id}`);
  assert(alert.user_id     === 'user-1',         `user_id: ${alert.user_id}`);
  assert(alert.deal_id     === 'deal-1',         `deal_id: ${alert.deal_id}`);
  assert(alert.alert_type  === 'price_drop',     `alert_type: ${alert.alert_type}`);
  assert(alert.old_price   === 100,              `old_price: ${alert.old_price}`);
  assert(alert.new_price   === 79,               `new_price: ${alert.new_price}`);
  assert(alert.savings_pct === 21,               `savings_pct: ${alert.savings_pct}`);
  assert(alert.status      === 'pending',        `status: ${alert.status}`);
});

// ════════════════════════════════════════════════════════════
// 7. formatDropPct
// ════════════════════════════════════════════════════════════

test('formatDropPct: פורמט נכון', () => {
  assert(formatDropPct(100, 75) === '25% off', `got: ${formatDropPct(100, 75)}`);
  assert(formatDropPct(200, 0)  === '100% off', `got: ${formatDropPct(200, 0)}`);
});

test('formatDropPct: ללא ירידה → 0% off', () => {
  assert(formatDropPct(100, 100) === '0% off', `no drop: ${formatDropPct(100, 100)}`);
  assert(formatDropPct(100, 110) === '0% off', `price rose: ${formatDropPct(100, 110)}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-43 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
