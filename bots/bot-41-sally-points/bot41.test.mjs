// bot41.test.mjs — בדיקות יחידה ל-BOT-41 Sally Points
// הרץ: node bot41.test.mjs
// ════════════════════════════════════════════════════════════

import {
  POINTS_CONFIG,
  TIERS,
  getTierForPoints,
  getPointsForAction,
  calcNextTier,
  validateAction,
  buildTransactionRecord,
  formatLeaderboard,
} from './bot41.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'failed'); }

// ════════════════════════════════════════════════════════════
// 1. POINTS_CONFIG — ערכי נקודות
// ════════════════════════════════════════════════════════════

test('POINTS_CONFIG: register = 100', () => {
  assert(POINTS_CONFIG.register === 100, `got ${POINTS_CONFIG.register}`);
});

test('POINTS_CONFIG: daily_login = 10', () => {
  assert(POINTS_CONFIG.daily_login === 10, `got ${POINTS_CONFIG.daily_login}`);
});

test('POINTS_CONFIG: deal_submit = 50', () => {
  assert(POINTS_CONFIG.deal_submit === 50, `got ${POINTS_CONFIG.deal_submit}`);
});

test('POINTS_CONFIG: referral = 200', () => {
  assert(POINTS_CONFIG.referral === 200, `got ${POINTS_CONFIG.referral}`);
});

test('POINTS_CONFIG: wishlist_fulfilled = 300', () => {
  assert(POINTS_CONFIG.wishlist_fulfilled === 300, `got ${POINTS_CONFIG.wishlist_fulfilled}`);
});

// ════════════════════════════════════════════════════════════
// 2. getTierForPoints — חישוב רמה
// ════════════════════════════════════════════════════════════

test('getTierForPoints: 0 → hunter', () => {
  assert(getTierForPoints(0).tier === 'hunter');
});

test('getTierForPoints: 499 → hunter', () => {
  assert(getTierForPoints(499).tier === 'hunter');
});

test('getTierForPoints: 500 → deal_pro', () => {
  assert(getTierForPoints(500).tier === 'deal_pro', `got ${getTierForPoints(500).tier}`);
});

test('getTierForPoints: 1999 → deal_pro', () => {
  assert(getTierForPoints(1999).tier === 'deal_pro');
});

test('getTierForPoints: 2000 → deal_king', () => {
  assert(getTierForPoints(2000).tier === 'deal_king', `got ${getTierForPoints(2000).tier}`);
});

test('getTierForPoints: 5000 → elite', () => {
  assert(getTierForPoints(5000).tier === 'elite', `got ${getTierForPoints(5000).tier}`);
});

test('getTierForPoints: מספר שלילי → hunter', () => {
  assert(getTierForPoints(-100).tier === 'hunter');
});

test('getTierForPoints: NaN → hunter', () => {
  assert(getTierForPoints(NaN).tier === 'hunter');
});

// ════════════════════════════════════════════════════════════
// 3. getPointsForAction
// ════════════════════════════════════════════════════════════

test('getPointsForAction: פעולה מוכרת', () => {
  assert(getPointsForAction('register') === 100);
  assert(getPointsForAction('daily_login') === 10);
});

test('getPointsForAction: פעולה לא מוכרת → 0', () => {
  assert(getPointsForAction('unknown_action') === 0);
  assert(getPointsForAction('') === 0);
  assert(getPointsForAction(null) === 0);
});

// ════════════════════════════════════════════════════════════
// 4. calcNextTier
// ════════════════════════════════════════════════════════════

test('calcNextTier: Hunter (250) → Deal Pro at 500', () => {
  const r = calcNextTier(250);
  assert(r.nextTier === 'deal_pro', `nextTier: ${r.nextTier}`);
  assert(r.pointsNeeded === 250, `need: ${r.pointsNeeded}`);
});

test('calcNextTier: Deal Pro (600) → Deal King at 2000', () => {
  const r = calcNextTier(600);
  assert(r.nextTier === 'deal_king', `nextTier: ${r.nextTier}`);
  assert(r.pointsNeeded === 1400, `need: ${r.pointsNeeded}`);
});

test('calcNextTier: Elite (5000) → אין רמה הבאה', () => {
  const r = calcNextTier(5000);
  assert(r.nextTier === null, `expected null, got ${r.nextTier}`);
  assert(r.pointsNeeded === 0);
});

// ════════════════════════════════════════════════════════════
// 5. validateAction
// ════════════════════════════════════════════════════════════

test('validateAction: פעולות חוקיות', () => {
  assert(validateAction('register') === true);
  assert(validateAction('daily_login') === true);
  assert(validateAction('deal_submit') === true);
  assert(validateAction('referral') === true);
  assert(validateAction('wishlist_fulfilled') === true);
});

test('validateAction: פעולות לא חוקיות', () => {
  assert(validateAction('hack') === false);
  assert(validateAction('') === false);
  assert(validateAction(null) === false);
  assert(validateAction(123) === false);
});

// ════════════════════════════════════════════════════════════
// 6. buildTransactionRecord
// ════════════════════════════════════════════════════════════

test('buildTransactionRecord: רשומה תקינה', () => {
  const rec = buildTransactionRecord('user-uuid-123', 'register', 100);
  assert(rec.user_id === 'user-uuid-123');
  assert(rec.action === 'register');
  assert(rec.points === 100);
  assert(rec.created_at);
});

test('buildTransactionRecord: ללא userId → שגיאה', () => {
  let threw = false;
  try { buildTransactionRecord(null, 'register', 100); }
  catch { threw = true; }
  assert(threw, 'expected throw');
});

test('buildTransactionRecord: פעולה לא חוקית → שגיאה', () => {
  let threw = false;
  try { buildTransactionRecord('user-1', 'hack_points', 9999); }
  catch { threw = true; }
  assert(threw, 'expected throw');
});

test('buildTransactionRecord: עם referenceId', () => {
  const rec = buildTransactionRecord('user-1', 'deal_submit', 50, 'deal-uuid-456');
  assert(rec.reference_id === 'deal-uuid-456');
});

// ════════════════════════════════════════════════════════════
// 7. formatLeaderboard
// ════════════════════════════════════════════════════════════

const MOCK_LB = [
  { user_id: 'u1', total_points: 6000, tier: 'elite',    rank: 1 },
  { user_id: 'u2', total_points: 2500, tier: 'deal_king', rank: 2 },
  { user_id: 'u3', total_points: 800,  tier: 'deal_pro',  rank: 3 },
];

test('formatLeaderboard: מחזיר rank נכון', () => {
  const lb = formatLeaderboard(MOCK_LB);
  assert(lb[0].rank === 1);
  assert(lb[1].rank === 2);
});

test('formatLeaderboard: מוסיף badge', () => {
  const lb = formatLeaderboard(MOCK_LB);
  assert(lb[0].badge === '💎', `elite badge: ${lb[0].badge}`);
  assert(lb[1].badge === '👑', `king badge: ${lb[1].badge}`);
  assert(lb[2].badge === '⭐', `pro badge: ${lb[2].badge}`);
});

test('formatLeaderboard: input ריק → []', () => {
  assert(formatLeaderboard([]).length === 0);
  assert(formatLeaderboard(null).length === 0);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-41 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
