// bot65.test.mjs — בדיקות יחידה ל-BOT-65 Personalized Email Digest
// הרץ: node bot65.test.mjs
// ════════════════════════════════════════════════════════════

import {
  matchDealsToUser,
  rankDealsForUser,
  buildPersonalizedDigest,
  generateDigestSubject,
  formatDigestHtml,
  segmentUsers,
  shouldSendDigest,
} from './bot65.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`\u2705 ${name}`); }
  catch (e) { FAILED.push(name); console.error(`\u274c ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ── Mock data ────────────────────────────────────────────────

const DEALS = [
  { id: 'd1', title: 'Nike Air Max', category: 'fashion',     score: 85, discount: 40, price: 60,  original_price: 100, currency: 'USD', store_name: 'Nike', seo_slug: 'nike-air-max', created_at: new Date().toISOString() },
  { id: 'd2', title: 'Sony TV 55"',  category: 'electronics', score: 90, discount: 35, price: 650, original_price: 999, currency: 'USD', store_name: 'Sony', seo_slug: 'sony-tv-55',  created_at: new Date().toISOString() },
  { id: 'd3', title: 'Adidas Tee',   category: 'fashion',     score: 70, discount: 25, price: 15,  original_price: 20,  currency: 'USD', store_name: 'Adidas', seo_slug: 'adidas-tee', created_at: new Date().toISOString() },
  { id: 'd4', title: 'IKEA Chair',   category: 'home',        score: 75, discount: 30, price: 70,  original_price: 100, currency: 'USD', store_name: 'IKEA', seo_slug: 'ikea-chair',  created_at: new Date().toISOString() },
  { id: 'd5', title: 'Old Deal',     category: 'fashion',     score: 65, discount: 20, price: 20,  original_price: 25,  currency: 'USD', store_name: 'H&M',  seo_slug: 'old-deal',    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
];

const USER_FASHION = {
  id: 'u1', email: 'a@test.com', name: 'Avi',
  preferred_categories: ['fashion'],
  min_discount: 0,
};
const USER_NO_PREFS = {
  id: 'u2', email: 'b@test.com', name: 'Bob',
  preferred_categories: [],
  min_discount: 0,
};
const USER_ELECTRONICS = {
  id: 'u3', email: 'c@test.com', name: 'Carl',
  preferred_categories: ['electronics'],
  min_discount: 0,
};

// ════════════════════════════════════════════════════════════
// 1. matchDealsToUser
// ════════════════════════════════════════════════════════════

test('matchDealsToUser: fashion user — only fashion deals', () => {
  const matched = matchDealsToUser(DEALS, USER_FASHION);
  assert(matched.every(d => d.category === 'fashion'), `got: ${matched.map(d => d.category)}`);
  assert(matched.length > 0, 'no matches');
});

test('matchDealsToUser: electronics user — only electronics', () => {
  const matched = matchDealsToUser(DEALS, USER_ELECTRONICS);
  assert(matched.every(d => d.category === 'electronics'), `categories: ${matched.map(d => d.category)}`);
});

test('matchDealsToUser: no preferences — all deals', () => {
  const matched = matchDealsToUser(DEALS, USER_NO_PREFS);
  assert(matched.length === DEALS.length, `got: ${matched.length}, expected: ${DEALS.length}`);
});

// ════════════════════════════════════════════════════════════
// 2. rankDealsForUser
// ════════════════════════════════════════════════════════════

test('rankDealsForUser: higher score ranks higher (no category preference)', () => {
  const ranked = rankDealsForUser(DEALS, USER_NO_PREFS);
  assert(ranked[0].score >= ranked[1].score, `first: ${ranked[0].score}, second: ${ranked[1].score}`);
});

test('rankDealsForUser: category match boosts rank', () => {
  const ranked = rankDealsForUser(DEALS, USER_FASHION);
  // First result should be from fashion
  assert(ranked[0].category === 'fashion', `first category: ${ranked[0].category}`);
});

test('rankDealsForUser: empty deals → []', () => {
  const ranked = rankDealsForUser([], USER_FASHION);
  assert(ranked.length === 0);
});

// ════════════════════════════════════════════════════════════
// 3. buildPersonalizedDigest
// ════════════════════════════════════════════════════════════

test('buildPersonalizedDigest: returns max topN deals', () => {
  const digest = buildPersonalizedDigest(USER_NO_PREFS, DEALS, 3);
  assert(digest.length <= 3, `got: ${digest.length}`);
});

test('buildPersonalizedDigest: empty deals → []', () => {
  const digest = buildPersonalizedDigest(USER_FASHION, [], 10);
  assert(digest.length === 0);
});

test('buildPersonalizedDigest: filters by user category', () => {
  const digest = buildPersonalizedDigest(USER_ELECTRONICS, DEALS, 10);
  assert(digest.every(d => d.category === 'electronics'), `categories: ${digest.map(d => d.category)}`);
});

// ════════════════════════════════════════════════════════════
// 4. generateDigestSubject
// ════════════════════════════════════════════════════════════

test('generateDigestSubject: includes top deal title', () => {
  const subject = generateDigestSubject(USER_FASHION, DEALS[0]);
  assert(subject.includes('Nike'), `subject: ${subject}`);
});

test('generateDigestSubject: includes discount percentage', () => {
  const subject = generateDigestSubject(USER_FASHION, DEALS[0]);
  assert(subject.includes('40'), `subject: ${subject}`);
});

test('generateDigestSubject: no deals → default subject', () => {
  const subject = generateDigestSubject(USER_FASHION, null);
  assert(subject.length > 0, 'empty subject');
  assert(typeof subject === 'string');
});

// ════════════════════════════════════════════════════════════
// 5. shouldSendDigest
// ════════════════════════════════════════════════════════════

test('shouldSendDigest: no lastSentAt → true', () => {
  assert(shouldSendDigest(USER_FASHION, null, new Date()) === true);
});

test('shouldSendDigest: sent 3 days ago → false (same week)', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  assert(shouldSendDigest(USER_FASHION, threeDaysAgo, new Date()) === false);
});

test('shouldSendDigest: sent 8 days ago → true (new week)', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert(shouldSendDigest(USER_FASHION, eightDaysAgo, new Date()) === true);
});

// ════════════════════════════════════════════════════════════
// 6. segmentUsers
// ════════════════════════════════════════════════════════════

test('segmentUsers: groups by primary category', () => {
  const users = [
    { id: 'u1', preferred_categories: ['fashion'] },
    { id: 'u2', preferred_categories: ['fashion', 'electronics'] },
    { id: 'u3', preferred_categories: ['electronics'] },
    { id: 'u4', preferred_categories: [] },
  ];
  const segments = segmentUsers(users);
  assert(segments['fashion']?.length === 2,     `fashion: ${segments['fashion']?.length}`);
  assert(segments['electronics']?.length === 1, `electronics: ${segments['electronics']?.length}`);
  assert(segments['general']?.length === 1,     `general: ${segments['general']?.length}`);
});

test('segmentUsers: empty → {}', () => {
  const segments = segmentUsers([]);
  assert(Object.keys(segments).length === 0);
});

// ════════════════════════════════════════════════════════════
// 7. formatDigestHtml
// ════════════════════════════════════════════════════════════

test('formatDigestHtml: returns string containing deal titles', () => {
  const html = formatDigestHtml(USER_FASHION, DEALS.slice(0, 2), 'https://sallysale.com');
  assert(typeof html === 'string', 'not a string');
  assert(html.includes('Nike'), `missing Nike: ${html.substring(0, 300)}`);
  assert(html.includes('Sony'), `missing Sony: ${html.substring(0, 300)}`);
});

test('formatDigestHtml: contains unsubscribe link', () => {
  const html = formatDigestHtml(USER_FASHION, DEALS.slice(0, 1));
  assert(html.includes('unsubscribe'), `missing unsubscribe`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(55)}`);
console.log(`BOT-65 Tests: ${PASSED.length} עברו \u2705, ${FAILED.length} נכשלו \u274c`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
