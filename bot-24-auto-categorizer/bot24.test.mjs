// bot24.test.mjs — בדיקות ל-BOT-24 Auto Categorizer
// הרץ: node bot24.test.mjs
//
// כל הבדיקות הן unit בלבד — אין קריאות ל-API אמיתיות.
// מיובאים רק הפונקציות הטהורות מ-bot24.mjs.

import { keywordFallback, isValidCategory, sanitizeGptResponse } from './bot24.mjs';

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

function assertEqual(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label ? label + ': ' : ''}קיבלנו "${actual}", ציפינו "${expected}"`);
  }
}

// ── keywordFallback ────────────────────────────────────────

test('keywordFallback: Nike Air Max → fashion', () => {
  assertEqual(keywordFallback('Nike Air Max 90', 'Nike'), 'fashion');
});

test('keywordFallback: iPhone 15 Pro → electronics', () => {
  assertEqual(keywordFallback('iPhone 15 Pro', 'Apple'), 'electronics');
});

test('keywordFallback: IKEA Sofa → home', () => {
  assertEqual(keywordFallback('IKEA Sofa', 'IKEA'), 'home');
});

test('keywordFallback: LA Roche-Posay face cream → beauty', () => {
  assertEqual(keywordFallback('LA Roche-Posay face cream', 'Boots'), 'beauty');
});

test('keywordFallback: Yoga mat → sports', () => {
  assertEqual(keywordFallback('Yoga mat', 'Decathlon'), 'sports');
});

test('keywordFallback: Harry Potter book → books', () => {
  assertEqual(keywordFallback('Harry Potter book', 'Amazon'), 'books');
});

// ── isValidCategory ────────────────────────────────────────

test('isValidCategory: fashion → true', () => {
  if (!isValidCategory('fashion')) throw new Error('fashion צריך להיות תקין');
});

test('isValidCategory: electronics → true', () => {
  if (!isValidCategory('electronics')) throw new Error('electronics צריך להיות תקין');
});

test('isValidCategory: invalid-cat → false', () => {
  if (isValidCategory('invalid-cat')) throw new Error('invalid-cat לא אמור להיות תקין');
});

test('isValidCategory: ריק → false', () => {
  if (isValidCategory('')) throw new Error('מחרוזת ריקה לא אמורה להיות תקינה');
});

// ── sanitizeGptResponse ────────────────────────────────────

test('sanitizeGptResponse: "  FASHION  " → "fashion"', () => {
  assertEqual(sanitizeGptResponse('  FASHION  '), 'fashion');
});

test('sanitizeGptResponse: "electronics." → "electronics"', () => {
  assertEqual(sanitizeGptResponse('electronics.'), 'electronics');
});

// ── תוצאות ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${PASSED.length} עברו, ${FAILED.length} נכשלו`);

if (FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-24 מוכן להרצה!');
  process.exit(0);
}
