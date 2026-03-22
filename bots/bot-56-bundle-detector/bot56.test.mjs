// ════════════════════════════════════════════════════════════
// BOT-56 Tests — Bundle Detector
// הרצה: node bot56.test.mjs
// ════════════════════════════════════════════════════════════

import {
  isBundleDeal,
  parseBundleType,
  extractBundleQuantity,
  computeBundleValue,
  formatBundleDisplay,
  scoreBundleDeal,
} from './bot56.mjs';

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
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ════════════════════════════════════════════════════════════
// isBundleDeal
// ════════════════════════════════════════════════════════════

test('isBundleDeal: "Buy One Get One Free" → true', () => {
  assert(isBundleDeal('Buy One Get One Free') === true, 'BOGO text');
});

test('isBundleDeal: "BOGO Sale Today!" → true', () => {
  assert(isBundleDeal('BOGO Sale Today!') === true, 'BOGO keyword');
});

test('isBundleDeal: "Bundle of 3 T-shirts" → true', () => {
  assert(isBundleDeal('Bundle of 3 T-shirts') === true, 'bundle keyword');
});

test('isBundleDeal: "30% OFF Nike Shoes" → false', () => {
  assert(isBundleDeal('30% OFF Nike Shoes') === false, 'regular discount not bundle');
});

test('isBundleDeal: "Combo Pack - Shampoo + Conditioner" → true', () => {
  assert(isBundleDeal('Combo Pack - Shampoo + Conditioner') === true, 'combo pack');
});

test('isBundleDeal: "Multipack of 6 socks" → true', () => {
  assert(isBundleDeal('Multipack of 6 socks') === true, 'multipack');
});

test('isBundleDeal: "2 for 1 deal on all shirts" → true', () => {
  assert(isBundleDeal('2 for 1 deal on all shirts') === true, '2 for 1');
});

test('isBundleDeal: "Set of 4 kitchen tools" → true', () => {
  assert(isBundleDeal('Set of 4 kitchen tools') === true, 'set of N');
});

test('isBundleDeal: "Flash sale — limited time" → false', () => {
  assert(isBundleDeal('Flash sale — limited time') === false, 'flash sale not bundle');
});

test('isBundleDeal: empty string → false', () => {
  assert(isBundleDeal('') === false, 'empty string');
});

// ════════════════════════════════════════════════════════════
// parseBundleType
// ════════════════════════════════════════════════════════════

test('parseBundleType: "buy one get one" → bogo', () => {
  assertEqual(parseBundleType('buy one get one free'), 'bogo', 'buy one get one');
});

test('parseBundleType: "BOGO" → bogo', () => {
  assertEqual(parseBundleType('BOGO deal today'), 'bogo', 'BOGO');
});

test('parseBundleType: "pack of 3" → combo_pack', () => {
  assertEqual(parseBundleType('pack of 3 items included'), 'combo_pack', 'pack of N');
});

test('parseBundleType: "2 for 1 deal" → multi_buy', () => {
  assertEqual(parseBundleType('2 for 1 deal'), 'multi_buy', '2 for 1');
});

test('parseBundleType: "3 for 2" → multi_buy', () => {
  assertEqual(parseBundleType('3 for 2 offer'), 'multi_buy', '3 for 2');
});

test('parseBundleType: "gift with purchase" → gift_with_purchase', () => {
  assertEqual(parseBundleType('free gift with purchase over $50'), 'gift_with_purchase', 'gift with purchase');
});

test('parseBundleType: "value bundle" → value_set', () => {
  assertEqual(parseBundleType('exclusive value bundle for summer'), 'value_set', 'value bundle');
});

test('parseBundleType: unknown text → unknown', () => {
  assertEqual(parseBundleType('mystery deal'), 'unknown', 'unknown type');
});

// ════════════════════════════════════════════════════════════
// extractBundleQuantity
// ════════════════════════════════════════════════════════════

test('extractBundleQuantity: "pack of 6" → 6', () => {
  assertEqual(extractBundleQuantity('pack of 6'), 6, 'pack of 6');
});

test('extractBundleQuantity: "set of 3 items" → 3', () => {
  assertEqual(extractBundleQuantity('set of 3 items'), 3, 'set of 3');
});

test('extractBundleQuantity: "BOGO deal" → null', () => {
  assertEqual(extractBundleQuantity('BOGO deal'), null, 'BOGO has no quantity');
});

test('extractBundleQuantity: "3 for 2 offer" → 3', () => {
  assertEqual(extractBundleQuantity('3 for 2 offer'), 3, '3 for 2');
});

test('extractBundleQuantity: "6 pack of beer" → 6', () => {
  assertEqual(extractBundleQuantity('6 pack of beer'), 6, '6 pack');
});

test('extractBundleQuantity: "twin pack" → 2', () => {
  assertEqual(extractBundleQuantity('twin pack shampoo'), 2, 'twin pack');
});

test('extractBundleQuantity: "dual pack" → 2', () => {
  assertEqual(extractBundleQuantity('dual pack charging cables'), 2, 'dual pack');
});

test('extractBundleQuantity: empty string → null', () => {
  assertEqual(extractBundleQuantity(''), null, 'empty string');
});

// ════════════════════════════════════════════════════════════
// computeBundleValue
// ════════════════════════════════════════════════════════════

test('computeBundleValue: unit 10, qty 2, bundle 15 → saves 5 total, 2.5 per unit', () => {
  const result = computeBundleValue(10, 2, 15);
  assertEqual(result.totalSavings, 5, 'total savings');
  assertEqual(result.savingsPerUnit, 2.5, 'savings per unit');
});

test('computeBundleValue: unit 5, qty 3, bundle 12 → saves 3 total, 1 per unit', () => {
  const result = computeBundleValue(5, 3, 12);
  assertEqual(result.totalSavings, 3, 'total savings');
  assertEqual(result.savingsPerUnit, 1, 'savings per unit');
});

test('computeBundleValue: bundle price equals full price → 0 savings', () => {
  const result = computeBundleValue(10, 3, 30);
  assertEqual(result.totalSavings, 0, 'no savings');
  assertEqual(result.savingsPerUnit, 0, 'no savings per unit');
});

test('computeBundleValue: invalid inputs → zeros', () => {
  const result = computeBundleValue(null, 2, 10);
  assertEqual(result.totalSavings, 0, 'null unit price');
});

// ════════════════════════════════════════════════════════════
// formatBundleDisplay
// ════════════════════════════════════════════════════════════

test('formatBundleDisplay: "bogo" → contains BOGO', () => {
  const display = formatBundleDisplay('bogo', null);
  assert(display.includes('BOGO'), `should include BOGO, got: ${display}`);
});

test('formatBundleDisplay: "combo_pack" with qty 3 → contains 3', () => {
  const display = formatBundleDisplay('combo_pack', 3);
  assert(display.includes('3'), `should include quantity 3, got: ${display}`);
});

test('formatBundleDisplay: "multi_buy" → contains Buy or Multi', () => {
  const display = formatBundleDisplay('multi_buy', null);
  assert(display.includes('Buy') || display.includes('Multi'), `should contain multi-buy text, got: ${display}`);
});

test('formatBundleDisplay: "gift_with_purchase" → contains Gift', () => {
  const display = formatBundleDisplay('gift_with_purchase', null);
  assert(display.includes('Gift'), `should include Gift, got: ${display}`);
});

test('formatBundleDisplay: "value_set" with qty 5 → contains 5', () => {
  const display = formatBundleDisplay('value_set', 5);
  assert(display.includes('5'), `should include quantity, got: ${display}`);
});

// ════════════════════════════════════════════════════════════
// scoreBundleDeal
// ════════════════════════════════════════════════════════════

test('scoreBundleDeal: bogo type → bonus > 0', () => {
  const bonus = scoreBundleDeal({}, 'bogo');
  assert(bonus > 0, `bogo should have positive bonus, got ${bonus}`);
});

test('scoreBundleDeal: multi_buy → bonus > 0', () => {
  const bonus = scoreBundleDeal({}, 'multi_buy');
  assert(bonus > 0, `multi_buy should have positive bonus, got ${bonus}`);
});

test('scoreBundleDeal: gift_with_purchase → high bonus', () => {
  const bonus = scoreBundleDeal({}, 'gift_with_purchase');
  assert(bonus >= 15, `gift_with_purchase should have high bonus, got ${bonus}`);
});

test('scoreBundleDeal: unknown type → 0 bonus', () => {
  const bonus = scoreBundleDeal({}, 'unknown');
  assertEqual(bonus, 0, 'unknown type bonus');
});

test('scoreBundleDeal: bogo > multi_buy (higher value)', () => {
  const bogoBon = scoreBundleDeal({}, 'bogo');
  const multiBon = scoreBundleDeal({}, 'multi_buy');
  assert(bogoBon >= multiBon, `bogo (${bogoBon}) should be >= multi_buy (${multiBon})`);
});

// ════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-56 Tests: ${PASSED.length} passed, ${FAILED.length} failed`);
if (FAILED.length > 0) {
  console.error(`\nFailed tests:\n${FAILED.map(t => `  - ${t}`).join('\n')}`);
  process.exit(1);
} else {
  console.log('All tests passed! ✅');
}
