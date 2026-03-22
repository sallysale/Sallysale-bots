// bot44.test.mjs — בדיקות יחידה ל-BOT-44 Alert Sender
// הרץ: node bot44.test.mjs
// ════════════════════════════════════════════════════════════

import {
  buildAlertSubject,
  getCurrencySymbol,
  formatSavings,
  buildAlertEmailHtml,
  buildAlertEmailText,
  shouldSendEmail,
  buildEmailRecipient,
} from './bot44.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// ── Mock data ────────────────────────────────────────────────
const MOCK_DEAL = {
  id:            'deal-uuid-1',
  title:         'Sony WH-1000XM5 Wireless Headphones',
  price:         199.99,
  original_price: 349.99,
  currency:      'USD',
  score:         88,
  seo_slug:      'sony-wh-1000xm5-abc123',
  store_name:    'Amazon',
  image_url:     'https://example.com/sony.jpg',
};

const MOCK_ALERT = {
  id:           'alert-uuid-1',
  wishlist_id:  'wl-uuid-1',
  user_id:      'user-uuid-1',
  deal_id:      'deal-uuid-1',
  alert_type:   'price_drop',
  old_price:    349.99,
  new_price:    199.99,
  savings_pct:  43,
  status:       'pending',
  created_at:   '2026-03-17T10:00:00.000Z',
};

// ════════════════════════════════════════════════════════════
// 1. buildAlertSubject
// ════════════════════════════════════════════════════════════

test('buildAlertSubject: מכיל כותרת הדיל', () => {
  const subj = buildAlertSubject(MOCK_DEAL, 43);
  assert(subj.includes('Sony'), `subject missing title: ${subj}`);
});

test('buildAlertSubject: מכיל אחוז חיסכון', () => {
  const subj = buildAlertSubject(MOCK_DEAL, 43);
  assert(subj.includes('43'), `subject missing pct: ${subj}`);
});

// ════════════════════════════════════════════════════════════
// 2. getCurrencySymbol
// ════════════════════════════════════════════════════════════

test('getCurrencySymbol: USD → $', () => {
  assert(getCurrencySymbol('USD') === '$', `got: ${getCurrencySymbol('USD')}`);
});

test('getCurrencySymbol: ILS → ₪', () => {
  assert(getCurrencySymbol('ILS') === '₪', `got: ${getCurrencySymbol('ILS')}`);
});

test('getCurrencySymbol: unknown → currency code', () => {
  const sym = getCurrencySymbol('XYZ');
  assert(sym === 'XYZ', `got: ${sym}`);
});

// ════════════════════════════════════════════════════════════
// 3. formatSavings
// ════════════════════════════════════════════════════════════

test('formatSavings: פורמט נכון עם סמל', () => {
  const s = formatSavings(100, 75, 'USD');
  assert(s.includes('$'),   `missing symbol: ${s}`);
  assert(s.includes('25'),  `missing amount: ${s}`);
  assert(s.includes('%'),   `missing pct: ${s}`);
  assert(s.includes('off'), `missing off: ${s}`);
});

test('formatSavings: zero savings edge case', () => {
  const s = formatSavings(100, 100, 'USD');
  assert(s.includes('0'), `expected 0 savings: ${s}`);
});

// ════════════════════════════════════════════════════════════
// 4. buildAlertEmailHtml
// ════════════════════════════════════════════════════════════

test('buildAlertEmailHtml: מכיל כותרת הדיל', () => {
  const html = buildAlertEmailHtml(MOCK_ALERT, MOCK_DEAL);
  assert(html.includes('Sony'), `missing title: ${html.substring(0, 200)}`);
});

test('buildAlertEmailHtml: מכיל מחיר ישן מחוק', () => {
  const html = buildAlertEmailHtml(MOCK_ALERT, MOCK_DEAL);
  // מחיר ישן מוצג עם text-decoration:line-through
  assert(html.includes('line-through'), `missing strikethrough: ${html.substring(0, 400)}`);
  assert(html.includes('349'), `missing old price: ${html.substring(0, 400)}`);
});

test('buildAlertEmailHtml: מכיל CTA button', () => {
  const html = buildAlertEmailHtml(MOCK_ALERT, MOCK_DEAL);
  assert(html.includes('View Deal'), `missing CTA: ${html.substring(0, 400)}`);
  assert(html.includes('href='),     `missing link: ${html.substring(0, 400)}`);
});

// ════════════════════════════════════════════════════════════
// 5. buildAlertEmailText
// ════════════════════════════════════════════════════════════

test('buildAlertEmailText: plain text, ללא HTML tags', () => {
  const text = buildAlertEmailText(MOCK_ALERT, MOCK_DEAL);
  assert(!text.includes('<'), `has HTML tags: ${text.substring(0, 100)}`);
  assert(text.includes('Sony'), `missing title: ${text.substring(0, 100)}`);
});

// ════════════════════════════════════════════════════════════
// 6. shouldSendEmail
// ════════════════════════════════════════════════════════════

test('shouldSendEmail: מחזיר false עבור status לא pending', () => {
  assert(shouldSendEmail({ status: 'sent' })    === false, 'sent should be false');
  assert(shouldSendEmail({ status: 'failed' })  === false, 'failed should be false');
  assert(shouldSendEmail({ status: 'pending' }) === true,  'pending should be true');
});

// ════════════════════════════════════════════════════════════
// 7. buildEmailRecipient
// ════════════════════════════════════════════════════════════

test('buildEmailRecipient: עם שם', () => {
  const r = buildEmailRecipient('user@example.com', 'Aviel');
  assert(r === 'Aviel <user@example.com>', `got: ${r}`);
});

test('buildEmailRecipient: ללא שם', () => {
  const r = buildEmailRecipient('user@example.com', null);
  assert(r === 'user@example.com', `got: ${r}`);
  const r2 = buildEmailRecipient('user@example.com', '');
  assert(r2 === 'user@example.com', `got: ${r2}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-44 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
