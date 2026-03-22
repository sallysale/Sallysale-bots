// bot28.test.mjs — בדיקות יחידה ל-BOT-28 Variant Matcher
// הרץ: node bot28.test.mjs
// ════════════════════════════════════════════════════════════

import {
  detectVariantType,
  extractVariants,
  normalizeVariantValue,
  groupVariantsByBase,
  scoreVariantSimilarity,
  COLOR_KEYWORDS,
  SIZE_KEYWORDS,
} from './bot28.mjs';

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

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ════════════════════════════════════════════════════════════
// 1. detectVariantType
// ════════════════════════════════════════════════════════════

test('detectVariantType: "black" → color', () => {
  assertEq(detectVariantType('black'), 'color');
});

test('detectVariantType: "XL" → size', () => {
  assertEq(detectVariantType('XL'), 'size');
});

test('detectVariantType: "500ml" → volume', () => {
  assertEq(detectVariantType('500ml'), 'volume');
});

test('detectVariantType: "250g" → volume', () => {
  assertEq(detectVariantType('250g'), 'volume');
});

test('detectVariantType: "42" (EU shoe) → size', () => {
  assertEq(detectVariantType('42'), 'size');
});

test('detectVariantType: "unknown-val" → other', () => {
  assertEq(detectVariantType('unknown-val'), 'other');
});

// ════════════════════════════════════════════════════════════
// 2. extractVariants
// ════════════════════════════════════════════════════════════

test('extractVariants: extracts color from title', () => {
  const variants = extractVariants('Nike T-Shirt in Black');
  const colors = variants.filter(v => v.type === 'color');
  assert(colors.length > 0, 'expected at least 1 color variant');
  assertEq(colors[0].value, 'black');
});

test('extractVariants: extracts size from "Size M"', () => {
  const variants = extractVariants('Adidas Hoodie Size M');
  const sizes = variants.filter(v => v.type === 'size');
  assert(sizes.length > 0, 'expected at least 1 size variant');
});

test('extractVariants: extracts volume "100ml"', () => {
  const variants = extractVariants('L\'Oreal Serum 100ml');
  const vols = variants.filter(v => v.type === 'volume');
  assert(vols.length > 0, 'expected volume variant');
  assert(vols[0].value.includes('100'), `expected 100ml, got ${vols[0].value}`);
});

test('extractVariants: no variants in plain title', () => {
  const variants = extractVariants('Leather Bag Sale 50% off');
  // May extract nothing — just check it doesn't crash
  assert(Array.isArray(variants), 'should return array');
});

test('extractVariants: multiple colors in description', () => {
  const variants = extractVariants('Sneakers', 'Available in Red, Blue and White');
  const colors = variants.filter(v => v.type === 'color');
  assert(colors.length >= 2, `expected ≥2 colors, got ${colors.length}`);
});

test('extractVariants: deduplicates repeated variants', () => {
  const variants = extractVariants('Black T-Shirt Black Cotton');
  const blacks = variants.filter(v => v.value === 'black');
  assertEq(blacks.length, 1, 'should deduplicate black');
});

// ════════════════════════════════════════════════════════════
// 3. normalizeVariantValue
// ════════════════════════════════════════════════════════════

test('normalizeVariantValue: size "small" → "S"', () => {
  assertEq(normalizeVariantValue('small', 'size'), 'S');
});

test('normalizeVariantValue: size "xl" → "XL"', () => {
  assertEq(normalizeVariantValue('xl', 'size'), 'XL');
});

test('normalizeVariantValue: color "black" → "Black"', () => {
  assertEq(normalizeVariantValue('black', 'color'), 'Black');
});

test('normalizeVariantValue: volume "500ml" stays lowercase', () => {
  assertEq(normalizeVariantValue('500ml', 'volume'), '500ml');
});

test('normalizeVariantValue: size "free size" → "one size"', () => {
  assertEq(normalizeVariantValue('free size', 'size'), 'one size');
});

// ════════════════════════════════════════════════════════════
// 4. groupVariantsByBase
// ════════════════════════════════════════════════════════════

test('groupVariantsByBase: groups same base together', () => {
  const items = [
    { deal_id: 'd1', title: 'Nike Shirt Black', variants: [{ type: 'color', value: 'black' }] },
    { deal_id: 'd2', title: 'Nike Shirt White', variants: [{ type: 'color', value: 'white' }] },
    { deal_id: 'd3', title: 'Adidas Shoes', variants: [] },
  ];
  const groups = groupVariantsByBase(items);
  assert(groups.size >= 2, `expected ≥2 groups, got ${groups.size}`);
});

test('groupVariantsByBase: returns Map', () => {
  const groups = groupVariantsByBase([]);
  assert(groups instanceof Map, 'should return Map');
});

// ════════════════════════════════════════════════════════════
// 5. scoreVariantSimilarity
// ════════════════════════════════════════════════════════════

test('scoreVariantSimilarity: identical titles → 1', () => {
  const score = scoreVariantSimilarity('Nike Air Max', 'Nike Air Max');
  assertEq(score, 1);
});

test('scoreVariantSimilarity: completely different → 0', () => {
  const score = scoreVariantSimilarity('Apple Watch Series 9', 'Sony PlayStation 5');
  assert(score < 0.2, `expected <0.2, got ${score}`);
});

test('scoreVariantSimilarity: similar titles → high score', () => {
  const score = scoreVariantSimilarity('Nike Air Max 270 Black', 'Nike Air Max 270 White');
  assert(score > 0.5, `expected >0.5, got ${score}`);
});

test('scoreVariantSimilarity: empty strings → 0', () => {
  assertEq(scoreVariantSimilarity('', ''), 0);
});

// ════════════════════════════════════════════════════════════
// 6. constants sanity
// ════════════════════════════════════════════════════════════

test('COLOR_KEYWORDS includes common colors', () => {
  assert(COLOR_KEYWORDS.includes('black'), 'missing black');
  assert(COLOR_KEYWORDS.includes('white'), 'missing white');
  assert(COLOR_KEYWORDS.includes('red'),   'missing red');
});

test('SIZE_KEYWORDS includes common sizes', () => {
  assert(SIZE_KEYWORDS.includes('s'),  'missing s');
  assert(SIZE_KEYWORDS.includes('xl'), 'missing xl');
  assert(SIZE_KEYWORDS.includes('m'),  'missing m');
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-28 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) process.exit(1);
