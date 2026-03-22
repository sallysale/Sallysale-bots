// bot49.test.mjs — בדיקות יחידה ל-BOT-49 Visual Search
// הרץ: node bot49.test.mjs
// ════════════════════════════════════════════════════════════

import {
  hammingDistance,
  countBits,
  isVisualDuplicate,
  hexToBits,
  bitsToHex,
  computeDHashFromPixels,
  simulateImageHash,
  classifyHashSimilarity,
  findDuplicatesInBatch,
  DUPLICATE_THRESHOLD,
  HASH_LENGTH,
} from './bot49.mjs';

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
// 1. countBits
// ════════════════════════════════════════════════════════════

test('countBits: 0 → 0', () => {
  assertEq(countBits(0), 0);
});

test('countBits: 15 (1111) → 4', () => {
  assertEq(countBits(15), 4);
});

test('countBits: 8 (1000) → 1', () => {
  assertEq(countBits(8), 1);
});

test('countBits: 7 (0111) → 3', () => {
  assertEq(countBits(7), 3);
});

// ════════════════════════════════════════════════════════════
// 2. hammingDistance
// ════════════════════════════════════════════════════════════

test('hammingDistance: identical hashes → 0', () => {
  assertEq(hammingDistance('abcdef1234567890', 'abcdef1234567890'), 0);
});

test('hammingDistance: completely different → high distance', () => {
  const dist = hammingDistance('0000000000000000', 'ffffffffffffffff');
  assert(dist > 50, `expected high distance, got ${dist}`);
});

test('hammingDistance: mismatched lengths → Infinity', () => {
  assert(hammingDistance('abc', 'abcd') === Infinity);
});

test('hammingDistance: null inputs → Infinity', () => {
  assert(hammingDistance(null, 'abc') === Infinity);
});

test('hammingDistance: 1-bit difference → 1', () => {
  // '0' = 0000, '1' = 0001 → XOR = 0001 → 1 bit
  const dist = hammingDistance('0000000000000000', '0000000000000001');
  assertEq(dist, 1);
});

// ════════════════════════════════════════════════════════════
// 3. isVisualDuplicate
// ════════════════════════════════════════════════════════════

test('isVisualDuplicate: identical → true', () => {
  assert(isVisualDuplicate('abcdef1234567890', 'abcdef1234567890'));
});

test('isVisualDuplicate: 1-bit diff → true (within threshold)', () => {
  assert(isVisualDuplicate('0000000000000000', '0000000000000001'));
});

test('isVisualDuplicate: completely different → false', () => {
  assert(!isVisualDuplicate('0000000000000000', 'ffffffffffffffff'));
});

// ════════════════════════════════════════════════════════════
// 4. hexToBits / bitsToHex round-trip
// ════════════════════════════════════════════════════════════

test('hexToBits: "f" → "1111"', () => {
  assertEq(hexToBits('f'), '1111');
});

test('hexToBits: "0" → "0000"', () => {
  assertEq(hexToBits('0'), '0000');
});

test('bitsToHex → hexToBits round-trip', () => {
  const original = 'a3f7b2e9';
  const bits = hexToBits(original);
  const back = bitsToHex(bits);
  assertEq(back, original);
});

// ════════════════════════════════════════════════════════════
// 5. computeDHashFromPixels
// ════════════════════════════════════════════════════════════

test('computeDHashFromPixels: all increasing → all 1s hash', () => {
  // 8x9 = 72 pixels, increasing values → each left < right → bit=1
  const pixels = Array.from({ length: 72 }, (_, i) => i * 3);
  const hash = computeDHashFromPixels(pixels);
  assert(hash.length === 16, `hash should be 16 chars, got ${hash.length}`);
});

test('computeDHashFromPixels: all same → all 0s hash', () => {
  const pixels = new Array(72).fill(128);
  const hash = computeDHashFromPixels(pixels);
  assertEq(hash, '0000000000000000');
});

test('computeDHashFromPixels: wrong pixel count → throws', () => {
  try {
    computeDHashFromPixels(new Array(64).fill(0));
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('72'), `error should mention 72: ${e.message}`);
  }
});

// ════════════════════════════════════════════════════════════
// 6. simulateImageHash
// ════════════════════════════════════════════════════════════

test('simulateImageHash: returns 16-char hex', () => {
  const hash = simulateImageHash('https://example.com/image.jpg');
  assertEq(hash.length, 16);
  assert(/^[0-9a-f]+$/i.test(hash), 'should be hex');
});

test('simulateImageHash: deterministic for same URL', () => {
  const url = 'https://cdn.example.com/product.jpg';
  assertEq(simulateImageHash(url), simulateImageHash(url));
});

test('simulateImageHash: null URL → all zeros', () => {
  assertEq(simulateImageHash(null), '0000000000000000');
});

test('simulateImageHash: different URLs → different hashes', () => {
  const h1 = simulateImageHash('https://example.com/a.jpg');
  const h2 = simulateImageHash('https://example.com/b.jpg');
  assert(h1 !== h2, 'different URLs should give different hashes');
});

// ════════════════════════════════════════════════════════════
// 7. classifyHashSimilarity
// ════════════════════════════════════════════════════════════

test('classifyHashSimilarity: 0 → identical', () => {
  assertEq(classifyHashSimilarity(0), 'identical');
});

test('classifyHashSimilarity: 5 → duplicate', () => {
  assertEq(classifyHashSimilarity(5), 'duplicate');
});

test('classifyHashSimilarity: 12 → similar', () => {
  assertEq(classifyHashSimilarity(12), 'similar');
});

test('classifyHashSimilarity: 20 → different', () => {
  assertEq(classifyHashSimilarity(20), 'different');
});

// ════════════════════════════════════════════════════════════
// 8. findDuplicatesInBatch
// ════════════════════════════════════════════════════════════

test('findDuplicatesInBatch: identical hashes detected', () => {
  const deals = [
    { id: 'd1', image_hash: 'abcdef1234567890' },
    { id: 'd2', image_hash: 'abcdef1234567890' },
    { id: 'd3', image_hash: 'ffffffffffffffff' },
  ];
  const dups = findDuplicatesInBatch(deals);
  assert(dups.length >= 1, `expected ≥1 duplicate, got ${dups.length}`);
  assertEq(dups[0].deal_a, 'd1');
  assertEq(dups[0].deal_b, 'd2');
  assertEq(dups[0].distance, 0);
});

test('findDuplicatesInBatch: no duplicates → empty array', () => {
  const deals = [
    { id: 'd1', image_hash: '0000000000000000' },
    { id: 'd2', image_hash: 'ffffffffffffffff' },
  ];
  const dups = findDuplicatesInBatch(deals);
  assertEq(dups.length, 0);
});

test('findDuplicatesInBatch: empty array → empty result', () => {
  assertEq(findDuplicatesInBatch([]).length, 0);
});

// ════════════════════════════════════════════════════════════
// 9. constants
// ════════════════════════════════════════════════════════════

test('DUPLICATE_THRESHOLD is 8', () => {
  assertEq(DUPLICATE_THRESHOLD, 8);
});

test('HASH_LENGTH is 64', () => {
  assertEq(HASH_LENGTH, 64);
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-49 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) process.exit(1);
