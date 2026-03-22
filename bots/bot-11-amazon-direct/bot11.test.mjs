// bot11.test.mjs — בדיקות יחידה ל-BOT-11 Amazon Direct
// הרץ: node bot11.test.mjs
//
// בדיקות פונקציות טהורות בלבד — ללא HTTP או Supabase.
// ════════════════════════════════════════════════════════════

import {
  parseAmazonPrice,
  calcAmazonDiscount,
  extractAsin,
  buildAffiliateUrl,
  mapAmazonCategory,
  parseScraperApiProduct,
  parseProductListPage,
  buildScraperUrl,
} from './bot11.mjs';

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

function assertClose(a, b, tol = 0.01, msg) {
  if (Math.abs(a - b) > tol) throw new Error(msg || `expected ${b}, got ${a}`);
}

// ════════════════════════════════════════════════════════════
// 1. parseAmazonPrice
// ════════════════════════════════════════════════════════════

test('parseAmazonPrice: $49.99', () => {
  assertClose(parseAmazonPrice('$49.99'), 49.99);
});

test('parseAmazonPrice: "$1,299.00" — אלפים', () => {
  assertClose(parseAmazonPrice('$1,299.00'), 1299);
});

test('parseAmazonPrice: number passthrough', () => {
  assertClose(parseAmazonPrice(299.99), 299.99);
});

test('parseAmazonPrice: null → null', () => {
  assert(parseAmazonPrice(null) === null);
});

test('parseAmazonPrice: מחרוזת ריקה → null', () => {
  assert(parseAmazonPrice('') === null);
});

// ════════════════════════════════════════════════════════════
// 2. calcAmazonDiscount
// ════════════════════════════════════════════════════════════

test('calcAmazonDiscount: 50% off', () => {
  assert(calcAmazonDiscount(50, 100) === 50);
});

test('calcAmazonDiscount: 37.5% → rounded', () => {
  assert(calcAmazonDiscount(249.99, 399.99) === 37 || calcAmazonDiscount(249.99, 399.99) === 38);
});

test('calcAmazonDiscount: no discount → null', () => {
  assert(calcAmazonDiscount(100, 100) === null);
  assert(calcAmazonDiscount(120, 100) === null);
});

test('calcAmazonDiscount: missing original → null', () => {
  assert(calcAmazonDiscount(50, null) === null);
  assert(calcAmazonDiscount(null, 100) === null);
});

// ════════════════════════════════════════════════════════════
// 3. extractAsin
// ════════════════════════════════════════════════════════════

test('extractAsin: /dp/ASIN format', () => {
  assert(extractAsin('https://www.amazon.com/dp/B08N5WRWNW/ref=...') === 'B08N5WRWNW');
});

test('extractAsin: /gp/product/ASIN', () => {
  assert(extractAsin('https://www.amazon.com/gp/product/B07XJ8C8F5') === 'B07XJ8C8F5');
});

test('extractAsin: ללא ASIN → null', () => {
  assert(extractAsin('https://www.amazon.com/s?k=headphones') === null);
});

test('extractAsin: null → null', () => {
  assert(extractAsin(null) === null);
});

// ════════════════════════════════════════════════════════════
// 4. buildAffiliateUrl
// ════════════════════════════════════════════════════════════

test('buildAffiliateUrl: ASIN → affiliate URL', () => {
  const url = buildAffiliateUrl('B08N5WRWNW');
  assert(url.includes('amazon.com/dp/B08N5WRWNW'), `got: ${url}`);
  assert(url.includes('sallysale-20'), `missing tag: ${url}`);
});

test('buildAffiliateUrl: null ASIN → null', () => {
  assert(buildAffiliateUrl(null) === null);
});

test('buildAffiliateUrl: custom tag', () => {
  const url = buildAffiliateUrl('B00001', 'mytag-10');
  assert(url.includes('mytag-10'));
});

// ════════════════════════════════════════════════════════════
// 5. mapAmazonCategory
// ════════════════════════════════════════════════════════════

test('mapAmazonCategory: electronics', () => {
  assert(mapAmazonCategory('Electronics') === 'electronics');
  assert(mapAmazonCategory('Computers & Laptops') === 'electronics');
});

test('mapAmazonCategory: fashion', () => {
  assert(mapAmazonCategory("Women's Clothing") === 'fashion');
  assert(mapAmazonCategory('Shoes & Bags') === 'fashion');
});

test('mapAmazonCategory: home', () => {
  assert(mapAmazonCategory('Home & Kitchen') === 'home');
});

test('mapAmazonCategory: toys', () => {
  assert(mapAmazonCategory('Toys & Games') === 'toys');
  assert(mapAmazonCategory('Baby Products') === 'toys');
});

test('mapAmazonCategory: unknown → general', () => {
  assert(mapAmazonCategory('') === 'general');
  assert(mapAmazonCategory(null) === 'general');
});

// ════════════════════════════════════════════════════════════
// 6. parseScraperApiProduct
// ════════════════════════════════════════════════════════════

const MOCK_PRODUCT = {
  name:           'Sony WH-1000XM5 Wireless Headphones',
  price:          '$249.99',
  original_price: '$399.99',
  asin:           'B09XS7JWHH',
  url:            'https://www.amazon.com/dp/B09XS7JWHH',
  image:          'https://m.media-amazon.com/images/I/test.jpg',
  department:     'Electronics',
};

test('parseScraperApiProduct: מוצר תקין', () => {
  const p = parseScraperApiProduct(MOCK_PRODUCT, 'electronics');
  assert(p !== null);
  assertClose(p.price, 249.99);
  assertClose(p.original_price, 399.99);
  assert(p.asin === 'B09XS7JWHH');
  assert(p.category === 'electronics');
  assert(p.source === 'amazon_direct');
  assert(p.discount > 0, `discount: ${p.discount}`);
});

test('parseScraperApiProduct: ללא title → null', () => {
  const p = parseScraperApiProduct({ price: '$49.99', asin: 'B0001' }, 'electronics');
  assert(p === null);
});

test('parseScraperApiProduct: הנחה קטנה מסף → null', () => {
  const p = parseScraperApiProduct({
    name:           'Widget',
    price:          '$98',
    original_price: '$100',  // 2% הנחה — מתחת לסף 15%
    asin:           'B0000001',
  }, 'general');
  assert(p === null, 'should be filtered');
});

test('parseScraperApiProduct: ללא מחיר → null', () => {
  const p = parseScraperApiProduct({
    name: 'Product Without Price',
    asin: 'B0000002',
  }, 'general');
  assert(p === null);
});

test('parseScraperApiProduct: department מנצח category param', () => {
  const p = parseScraperApiProduct({
    name:           'KitchenAid Mixer',
    price:          '$299',
    original_price: '$449',
    asin:           'B0000003',
    department:     'Home & Kitchen',
  }, 'general');
  assert(p?.category === 'home', `got ${p?.category}`);
});

// ════════════════════════════════════════════════════════════
// 7. parseProductListPage
// ════════════════════════════════════════════════════════════

const MOCK_LIST = {
  results: [
    { name: 'Sony Headphones', price: '$249', original_price: '$399', asin: 'B00001', url: 'https://amazon.com/dp/B00001' },
    { name: 'Samsung TV', price: '$499', original_price: '$799', asin: 'B00002', url: 'https://amazon.com/dp/B00002', department: 'Electronics' },
    { name: 'No Price Item', asin: 'B00003' }, // יסונן
    { name: 'Cheap item', price: '$99', original_price: '$100', asin: 'B00004' }, // 1% → יסונן
  ],
};

test('parseProductListPage: מסנן תקין', () => {
  const results = parseProductListPage(MOCK_LIST, 'electronics');
  // הפריט ללא מחיר ופריט עם הנחה קטנה מסוננים
  assert(results.length === 2, `expected 2, got ${results.length}`);
});

test('parseProductListPage: JSON string', () => {
  const results = parseProductListPage(JSON.stringify(MOCK_LIST), 'electronics');
  assert(results.length === 2);
});

test('parseProductListPage: array ישיר', () => {
  const arr = [
    { name: 'Test', price: '$50', original_price: '$100', asin: 'B99901', url: 'https://amazon.com/dp/B99901' },
  ];
  const results = parseProductListPage(arr, 'electronics');
  assert(results.length === 1);
});

test('parseProductListPage: null → []', () => {
  assert(parseProductListPage(null).length === 0);
  assert(parseProductListPage('invalid json!!').length === 0);
});

// ════════════════════════════════════════════════════════════
// 8. buildScraperUrl
// ════════════════════════════════════════════════════════════

test('buildScraperUrl: בונה URL תקין', () => {
  const url = buildScraperUrl('https://www.amazon.com/deals', 'my-api-key');
  assert(url.includes('api.scraperapi.com'), `got: ${url}`);
  assert(url.includes('my-api-key'));
  assert(url.includes('autoparse=true'));
});

test('buildScraperUrl: חסר API key → null', () => {
  assert(buildScraperUrl('https://amazon.com', '') === null);
  assert(buildScraperUrl('https://amazon.com', null) === null);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-11 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
