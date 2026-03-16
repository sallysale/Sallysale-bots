// bot25.test.mjs — בדיקות ל-BOT-25 Auto Translator
// הרץ: node bot25.test.mjs
//
// כל הבדיקות הן unit בלבד — אין קריאות ל-DeepL/Supabase.
// מיובאים רק הפונקציות הטהורות מ-bot25.mjs.

import {
  getDeepLCode,
  needsTranslation,
  buildUpdatePayload,
  truncateTitle,
} from './bot25.mjs';

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
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr !== eStr) {
    throw new Error(`${label ? label + ': ' : ''}קיבלנו ${aStr}, ציפינו ${eStr}`);
  }
}

// ── getDeepLCode ───────────────────────────────────────────

test('getDeepLCode: HE → "HE"', () => {
  assertEqual(getDeepLCode('HE'), 'HE');
});

test('getDeepLCode: DE → "DE"', () => {
  assertEqual(getDeepLCode('DE'), 'DE');
});

test('getDeepLCode: FR → "FR"', () => {
  assertEqual(getDeepLCode('FR'), 'FR');
});

test('getDeepLCode: ES → "ES"', () => {
  assertEqual(getDeepLCode('ES'), 'ES');
});

test('getDeepLCode: JA → "JA"', () => {
  assertEqual(getDeepLCode('JA'), 'JA');
});

test('getDeepLCode: invalid → null', () => {
  assertEqual(getDeepLCode('invalid'), null);
});

// ── needsTranslation ──────────────────────────────────────

test('needsTranslation: כל שדות DE/FR/ES ריקים → true', () => {
  const result = needsTranslation({ title_de: null, title_fr: null, title_es: null });
  if (!result) throw new Error('ציפינו true — חסרות כל השפות');
});

test('needsTranslation: כל שדות DE/FR/ES מלאים → false', () => {
  const result = needsTranslation({ title_de: 'Hallo', title_fr: 'Bonjour', title_es: 'Hola' });
  if (result) throw new Error('ציפינו false — הכל מתורגם');
});

test('needsTranslation: תרגום חלקי (רק DE) → true', () => {
  const result = needsTranslation({ title_de: 'Hallo', title_fr: null, title_es: null });
  if (!result) throw new Error('ציפינו true — FR ו-ES חסרים');
});

// ── buildUpdatePayload ─────────────────────────────────────

test('buildUpdatePayload: DE + FR → { title_de, title_fr }', () => {
  const result = buildUpdatePayload(['DE', 'FR'], ['Hallo', 'Bonjour']);
  assertEqual(result, { title_de: 'Hallo', title_fr: 'Bonjour' });
});

// ── truncateTitle ──────────────────────────────────────────

test('truncateTitle: כותרת ארוכה (>200) → נחתכת', () => {
  const longTitle = 'A very long product title that exceeds the maximum allowed characters for a translation API call and it just keeps going on and on and on and on until it reaches well over two hundred characters in total length and even more!!!';
  const result    = truncateTitle(longTitle, 200);
  if (result.length > 201) { // 200 + '…'
    throw new Error(`לא נחתך — אורך: ${result.length}`);
  }
  if (result === longTitle) {
    throw new Error('הכותרת לא נחתכה');
  }
});

test('truncateTitle: כותרת קצרה (<200) → ללא שינוי', () => {
  const shortTitle = 'Short title';
  const result     = truncateTitle(shortTitle, 200);
  assertEqual(result, shortTitle);
});

// ── תוצאות ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${PASSED.length} עברו, ${FAILED.length} נכשלו`);

if (FAILED.length > 0) {
  console.error('❌ הבדיקות הבאות נכשלו:');
  FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-25 מוכן להרצה!');
  console.log('   זכור: הרץ migration-bot25.sql ב-Supabase לפני deploy!');
  process.exit(0);
}
