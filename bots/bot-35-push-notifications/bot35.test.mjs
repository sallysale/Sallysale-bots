// bot35.test.mjs — בדיקות יחידה ל-BOT-35 Push Notifications
// הרץ: node bot35.test.mjs
// ════════════════════════════════════════════════════════════

import {
  buildPushPayload,
  countPushSentToday,
  isWithinSendHours,
  filterActiveSubscriptions,
  buildWebPushOptions,
  isValidVapidConfig,
} from './bot35.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'failed'); }

const DEAL = {
  id:             'deal-push-001',
  title:          'Sony WH-1000XM5 Headphones',
  price:          249.99,
  original_price: 399.99,
  currency:       'USD',
  discount:       37,
  score:          88,
  store_name:     'Amazon',
  seo_slug:       'sony-headphones-abc123',
  category:       'electronics',
};

// ════════════════════════════════════════════════════════════
// 1. buildPushPayload
// ════════════════════════════════════════════════════════════

test('buildPushPayload: שדות חובה', () => {
  const p = buildPushPayload(DEAL);
  assert(p !== null);
  assert(p.title,   'missing title');
  assert(p.body,    'missing body');
  assert(p.icon,    'missing icon');
  assert(p.url,     'missing url');
  assert(p.data?.deal_id === 'deal-push-001', `deal_id: ${p.data?.deal_id}`);
});

test('buildPushPayload: title מקסימום 50 תווים', () => {
  const p = buildPushPayload(DEAL);
  assert(p.title.length <= 50, `too long: ${p.title.length}`);
});

test('buildPushPayload: body מכיל מחיר', () => {
  const p = buildPushPayload(DEAL);
  assert(p.body.includes('249'), `missing price: ${p.body}`);
});

test('buildPushPayload: URL מכיל seo_slug', () => {
  const p = buildPushPayload(DEAL);
  assert(p.url.includes('sony-headphones-abc123'), `url: ${p.url}`);
});

test('buildPushPayload: null → null', () => {
  assert(buildPushPayload(null) === null);
});

test('buildPushPayload: ללא מחיר — עדיין תקין', () => {
  const p = buildPushPayload({ ...DEAL, price: null });
  assert(typeof p.body === 'string' && p.body.length > 0);
});

// ════════════════════════════════════════════════════════════
// 2. countPushSentToday
// ════════════════════════════════════════════════════════════

test('countPushSentToday: ריק → 0', () => {
  assert(countPushSentToday([]) === 0);
  assert(countPushSentToday(null) === 0);
});

test('countPushSentToday: סופר רק היום', () => {
  const today = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000 * 2).toISOString();
  const rows = [
    { sent_at: today },
    { sent_at: today },
    { sent_at: yesterday },
  ];
  assert(countPushSentToday(rows) === 2, `got ${countPushSentToday(rows)}`);
});

// ════════════════════════════════════════════════════════════
// 3. isWithinSendHours
// ════════════════════════════════════════════════════════════

test('isWithinSendHours: 09:00 UTC → true', () => {
  const d = new Date(); d.setUTCHours(9, 0, 0, 0);
  assert(isWithinSendHours(d) === true);
});

test('isWithinSendHours: 21:59 UTC → true', () => {
  const d = new Date(); d.setUTCHours(21, 59, 0, 0);
  assert(isWithinSendHours(d) === true);
});

test('isWithinSendHours: 03:00 UTC → false', () => {
  const d = new Date(); d.setUTCHours(3, 0, 0, 0);
  assert(isWithinSendHours(d) === false);
});

test('isWithinSendHours: 22:00 UTC → false', () => {
  const d = new Date(); d.setUTCHours(22, 0, 0, 0);
  assert(isWithinSendHours(d) === false);
});

// ════════════════════════════════════════════════════════════
// 4. filterActiveSubscriptions
// ════════════════════════════════════════════════════════════

const SUBS = [
  { id: '1', active: true,  endpoint: 'https://fcm.example.com/1', p256dh: 'key1', auth_key: 'auth1' },
  { id: '2', active: false, endpoint: 'https://fcm.example.com/2', p256dh: 'key2', auth_key: 'auth2' }, // לא פעיל
  { id: '3', active: true,  endpoint: '',                           p256dh: 'key3', auth_key: 'auth3' }, // חסר endpoint
  { id: '4', active: true,  endpoint: 'https://fcm.example.com/4', p256dh: 'key4', auth_key: 'auth4' },
];

test('filterActiveSubscriptions: מסנן נכון', () => {
  const active = filterActiveSubscriptions(SUBS);
  assert(active.length === 2, `expected 2, got ${active.length}`);
  assert(active.every(s => s.active && s.endpoint));
});

test('filterActiveSubscriptions: null → []', () => {
  assert(filterActiveSubscriptions(null).length === 0);
  assert(filterActiveSubscriptions([]).length === 0);
});

// ════════════════════════════════════════════════════════════
// 5. buildWebPushOptions
// ════════════════════════════════════════════════════════════

test('buildWebPushOptions: פורמט נכון', () => {
  const opts = buildWebPushOptions({ endpoint: 'https://endpoint.com', p256dh: 'pubkey', auth_key: 'authsec' });
  assert(opts.endpoint === 'https://endpoint.com');
  assert(opts.keys?.p256dh === 'pubkey');
  assert(opts.keys?.auth === 'authsec');
});

// ════════════════════════════════════════════════════════════
// 6. isValidVapidConfig
// ════════════════════════════════════════════════════════════

test('isValidVapidConfig: מפתחות תקינים', () => {
  assert(isValidVapidConfig('BLong-public-key-here', 'long-private-key-here') === true);
});

test('isValidVapidConfig: חסרים → false', () => {
  assert(isValidVapidConfig('', 'private') === false);
  assert(isValidVapidConfig('public', '') === false);
  assert(isValidVapidConfig(null, null) === false);
});

test('isValidVapidConfig: קצרים מדי → false', () => {
  assert(isValidVapidConfig('abc', 'def') === false);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-35 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
