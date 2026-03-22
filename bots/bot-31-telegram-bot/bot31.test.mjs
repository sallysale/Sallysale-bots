// bot31.test.mjs — בדיקות יחידה ל-BOT-31 Telegram Bot
// הרץ: node bot31.test.mjs
//
// בדיקות פונקציות טהורות בלבד — ללא HTTP או Supabase.
// ════════════════════════════════════════════════════════════

import {
  escapeMd,
  formatDiscount,
  formatPrice,
  scoreEmoji,
  formatTelegramMessage,
  countSentToday,
  pickDealsToSend,
} from './bot31.mjs';

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
// 1. escapeMd — בריחה לMarkdownV2
// ════════════════════════════════════════════════════════════

test('escapeMd: נקודה מברחת', () => {
  assert(escapeMd('hello.world') === 'hello\\.world');
});

test('escapeMd: מינוס מברח', () => {
  assert(escapeMd('price-drop') === 'price\\-drop');
});

test('escapeMd: סוגריים מבריחים', () => {
  const result = escapeMd('(was $49)');
  assert(result.includes('\\(') && result.includes('\\)'), `got: ${result}`);
});

test('escapeMd: null → ""', () => {
  assert(escapeMd(null) === '');
  assert(escapeMd('') === '');
});

test('escapeMd: סימן קריאה מברח', () => {
  assert(escapeMd('Amazing!') === 'Amazing\\!');
});

// ════════════════════════════════════════════════════════════
// 2. formatDiscount
// ════════════════════════════════════════════════════════════

test('formatDiscount: 37% → "37% OFF"', () => {
  assert(formatDiscount(37) === '37% OFF');
});

test('formatDiscount: 90% → FREE', () => {
  assert(formatDiscount(90).includes('FREE') || formatDiscount(90).includes('90'));
});

test('formatDiscount: null → Deal label', () => {
  assert(typeof formatDiscount(null) === 'string');
  assert(formatDiscount(null).length > 0);
});

test('formatDiscount: 0 → Deal label', () => {
  assert(typeof formatDiscount(0) === 'string');
});

// ════════════════════════════════════════════════════════════
// 3. formatPrice
// ════════════════════════════════════════════════════════════

test('formatPrice: $49.99 USD', () => {
  const r = formatPrice(49.99, 'USD');
  assert(r.includes('$') && r.includes('49'), `got: ${r}`);
});

test('formatPrice: ₪189 ILS', () => {
  const r = formatPrice(189, 'ILS');
  assert(r.includes('₪'), `got: ${r}`);
});

test('formatPrice: €99.99 EUR', () => {
  const r = formatPrice(99.99, 'EUR');
  assert(r.includes('€'), `got: ${r}`);
});

test('formatPrice: null → ""', () => {
  assert(formatPrice(null) === '');
});

test('formatPrice: מחיר עגול ללא .00', () => {
  const r = formatPrice(50, 'USD');
  assert(!r.includes('.00'), `got: ${r}`);
  assert(r.includes('50'));
});

// ════════════════════════════════════════════════════════════
// 4. scoreEmoji
// ════════════════════════════════════════════════════════════

test('scoreEmoji: 95+ → 🏆', () => {
  assert(scoreEmoji(95) === '🏆');
  assert(scoreEmoji(100) === '🏆');
});

test('scoreEmoji: 90-94 → 🔥', () => {
  assert(scoreEmoji(90) === '🔥');
});

test('scoreEmoji: 85-89 → ⭐', () => {
  assert(scoreEmoji(85) === '⭐');
});

test('scoreEmoji: 80-84 → ✅', () => {
  assert(scoreEmoji(80) === '✅');
  assert(scoreEmoji(82) === '✅');
});

// ════════════════════════════════════════════════════════════
// 5. formatTelegramMessage
// ════════════════════════════════════════════════════════════

const MOCK_DEAL = {
  id:             'deal-001',
  title:          'Sony WH-1000XM5 Wireless Headphones',
  price:          249.99,
  original_price: 399.99,
  currency:       'USD',
  discount:       37,
  score:          88,
  category:       'Electronics',
  store_name:     'Amazon',
  url:            'https://www.amazon.com/dp/B09XS7JWHH?tag=sallysale-20',
  status:         'active',
  telegram_sent_at: null,
};

test('formatTelegramMessage: מכיל כותרת', () => {
  const msg = formatTelegramMessage(MOCK_DEAL);
  assert(msg.includes('Sony'), `missing title: ${msg.substring(0, 100)}`);
});

test('formatTelegramMessage: מכיל % הנחה', () => {
  const msg = formatTelegramMessage(MOCK_DEAL);
  assert(msg.includes('37'), `missing discount: ${msg.substring(0, 100)}`);
});

test('formatTelegramMessage: מכיל ציון', () => {
  const msg = formatTelegramMessage(MOCK_DEAL);
  assert(msg.includes('88'), `missing score: ${msg.substring(0, 100)}`);
});

test('formatTelegramMessage: מכיל קישור', () => {
  const msg = formatTelegramMessage(MOCK_DEAL);
  assert(msg.includes('amazon.com'), `missing link: ${msg.substring(0, 200)}`);
});

test('formatTelegramMessage: מכיל מחיר', () => {
  const msg = formatTelegramMessage(MOCK_DEAL);
  assert(msg.includes('249') || msg.includes('$'), `missing price: ${msg.substring(0, 200)}`);
});

test('formatTelegramMessage: deal ללא מחיר מקורי', () => {
  const deal = { ...MOCK_DEAL, original_price: null };
  const msg = formatTelegramMessage(deal);
  assert(typeof msg === 'string' && msg.length > 0);
});

// ════════════════════════════════════════════════════════════
// 6. countSentToday
// ════════════════════════════════════════════════════════════

test('countSentToday: 0 כשאין נשלחים', () => {
  assert(countSentToday([]) === 0);
  assert(countSentToday([{ telegram_sent_at: null }]) === 0);
});

test('countSentToday: סופר רק היום', () => {
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000 * 2).toISOString();
  const deals = [
    { telegram_sent_at: today },
    { telegram_sent_at: today },
    { telegram_sent_at: yesterday }, // לא נספר
    { telegram_sent_at: null },      // לא נספר
  ];
  assert(countSentToday(deals) === 2, `got ${countSentToday(deals)}`);
});

// ════════════════════════════════════════════════════════════
// 7. pickDealsToSend
// ════════════════════════════════════════════════════════════

const CANDIDATES = [
  { id: '1', status: 'active', score: 95, telegram_sent_at: null },
  { id: '2', status: 'active', score: 88, telegram_sent_at: null },
  { id: '3', status: 'active', score: 85, telegram_sent_at: null },
  { id: '4', status: 'active', score: 75, telegram_sent_at: null },   // מתחת לסף
  { id: '5', status: 'inactive', score: 90, telegram_sent_at: null }, // לא active
  { id: '6', status: 'active', score: 90, telegram_sent_at: new Date().toISOString() }, // כבר נשלח
];

test('pickDealsToSend: מסנן נכון', () => {
  const picks = pickDealsToSend(CANDIDATES, 0);
  // רק 1, 2, 3 עוברים (active + score >= 80 + לא נשלח)
  assert(picks.length === 3, `expected 3, got ${picks.length}: ${picks.map(p=>p.id)}`);
});

test('pickDealsToSend: מגביל לפי MAX_PER_DAY', () => {
  const picks = pickDealsToSend(CANDIDATES, 18); // 18 כבר נשלחו → נותרו 2
  assert(picks.length <= 2, `expected ≤2, got ${picks.length}`);
});

test('pickDealsToSend: 0 אם הגענו לmax', () => {
  const picks = pickDealsToSend(CANDIDATES, 20);
  assert(picks.length === 0, `expected 0, got ${picks.length}`);
});

test('pickDealsToSend: candidates ריק → []', () => {
  assert(pickDealsToSend([], 0).length === 0);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-31 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
