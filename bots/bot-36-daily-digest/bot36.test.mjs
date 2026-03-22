// bot36.test.mjs — בדיקות יחידה ל-BOT-36 Daily Digest
// הרץ: node bot36.test.mjs
// ════════════════════════════════════════════════════════════

import {
  formatDealRow,
  buildEmailHtml,
  buildEmailText,
  buildEmailSubject,
} from './bot36.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'failed'); }

const DEALS = [
  { id: 'd1', title: 'Sony WH-1000XM5 Headphones', price: 249.99, original_price: 399.99, currency: 'USD', discount: 37, score: 92, store_name: 'Amazon',   seo_slug: 'sony-wh5-abc' },
  { id: 'd2', title: 'Samsung 65" 4K QLED TV',      price: 799,    original_price: 1299,   currency: 'USD', discount: 38, score: 89, store_name: 'BestBuy',   seo_slug: 'samsung-tv-def' },
  { id: 'd3', title: 'IKEA KALLAX Shelf Unit',       price: 79.99,  original_price: 129.99, currency: 'USD', discount: 38, score: 81, store_name: 'IKEA',      seo_slug: 'kallax-ghi' },
  { id: 'd4', title: 'Nike Air Max 270',             price: 89,     original_price: 150,    currency: 'USD', discount: 41, score: 80, store_name: 'Nike',      seo_slug: null },
  { id: 'd5', title: 'LEGO Star Wars Millennium Falcon', price: 149, original_price: 199,  currency: 'USD', discount: 25, score: 78, store_name: 'Walmart',   seo_slug: 'lego-mf-jkl' },
];

// ════════════════════════════════════════════════════════════
// 1. formatDealRow
// ════════════════════════════════════════════════════════════

test('formatDealRow: מחזיר HTML', () => {
  const html = formatDealRow(DEALS[0], 1);
  assert(html.includes('<tr>') || html.includes('<td>'), 'not HTML');
});

test('formatDealRow: מכיל כותרת', () => {
  const html = formatDealRow(DEALS[0], 1);
  assert(html.includes('Sony'), `missing title: ${html.substring(0, 100)}`);
});

test('formatDealRow: מכיל rank', () => {
  const html = formatDealRow(DEALS[1], 2);
  assert(html.includes('#2'), `missing rank: ${html.substring(0, 100)}`);
});

test('formatDealRow: מכיל מחיר', () => {
  const html = formatDealRow(DEALS[0], 1);
  assert(html.includes('249'), `missing price: ${html.substring(0, 200)}`);
});

test('formatDealRow: מכיל קישור', () => {
  const html = formatDealRow(DEALS[0], 1);
  assert(html.includes('href='), `missing link`);
  assert(html.includes('sony-wh5-abc'), `missing slug`);
});

// ════════════════════════════════════════════════════════════
// 2. buildEmailHtml
// ════════════════════════════════════════════════════════════

test('buildEmailHtml: HTML תקין', () => {
  const html = buildEmailHtml(DEALS, 'Aviel', 'Monday, March 17, 2026');
  assert(html.startsWith('<!DOCTYPE html>'), 'bad doctype');
  assert(html.includes('</html>'), 'missing closing html');
});

test('buildEmailHtml: מכיל שם נמען', () => {
  const html = buildEmailHtml(DEALS, 'Aviel');
  assert(html.includes('Aviel'), `missing name`);
});

test('buildEmailHtml: מכיל SallySale brand', () => {
  const html = buildEmailHtml(DEALS);
  assert(html.includes('SallySale'), `missing brand`);
});

test('buildEmailHtml: מכיל כל הדילים', () => {
  const html = buildEmailHtml(DEALS);
  assert(html.includes('Sony'), 'missing deal 1');
  assert(html.includes('Samsung'), 'missing deal 2');
  assert(html.includes('IKEA'), 'missing deal 3');
});

test('buildEmailHtml: deals ריק — עדיין HTML תקין', () => {
  const html = buildEmailHtml([]);
  assert(html.startsWith('<!DOCTYPE html>'));
  assert(html.includes('SallySale'));
});

// ════════════════════════════════════════════════════════════
// 3. buildEmailText
// ════════════════════════════════════════════════════════════

test('buildEmailText: plain text, ללא HTML', () => {
  const text = buildEmailText(DEALS);
  assert(!text.includes('<'), `has HTML: ${text.substring(0, 50)}`);
});

test('buildEmailText: מכיל כל הדילים ממוספרים', () => {
  const text = buildEmailText(DEALS);
  assert(text.includes('1.'), 'missing #1');
  assert(text.includes('2.'), 'missing #2');
  assert(text.includes('Sony'), 'missing sony');
});

test('buildEmailText: מכיל link לאתר', () => {
  const text = buildEmailText(DEALS);
  assert(text.includes('sallysale.com'), `missing link`);
});

// ════════════════════════════════════════════════════════════
// 4. buildEmailSubject
// ════════════════════════════════════════════════════════════

test('buildEmailSubject: מכיל הנחה', () => {
  const subj = buildEmailSubject(DEALS);
  assert(subj.includes('37%') || subj.includes('off'), `subject: ${subj}`);
});

test('buildEmailSubject: מכיל כותרת הדיל', () => {
  const subj = buildEmailSubject(DEALS);
  assert(subj.includes('Sony') || subj.includes('sony'), `subject: ${subj}`);
});

test('buildEmailSubject: deals ריק → default subject', () => {
  const subj = buildEmailSubject([]);
  assert(typeof subj === 'string' && subj.length > 0, `empty subject`);
  assert(subj.includes('SallySale') || subj.includes('Digest'), `subject: ${subj}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-36 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
