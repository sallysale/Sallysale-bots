// bot08.test.mjs — בדיקות יחידה ל-BOT-08 RSS Aggregator
// הרץ: node bot08.test.mjs
//
// בדיקות פונקציות טהורות בלבד — ללא HTTP או Supabase.
// ════════════════════════════════════════════════════════════

import {
  parsePrice,
  extractPricesFromText,
  calcDiscount,
  mapRssCategory,
  extractAsin,
  buildRssDealPayload,
  parseRssXml,
} from './bot08.mjs';

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
// 1. parsePrice
// ════════════════════════════════════════════════════════════

test('parsePrice: $49.99', () => {
  assertClose(parsePrice('$49.99'), 49.99);
});

test('parsePrice: USD 29.00', () => {
  assertClose(parsePrice('USD 29.00'), 29);
});

test('parsePrice: מחרוזת ריקה → null', () => {
  assert(parsePrice('') === null, 'expected null');
});

test('parsePrice: null → null', () => {
  assert(parsePrice(null) === null, 'expected null');
});

test('parsePrice: 1,299.99 (אלפים עם פסיק)', () => {
  assertClose(parsePrice('1,299.99'), 1299.99, 0.01);
});

// ════════════════════════════════════════════════════════════
// 2. extractPricesFromText
// ════════════════════════════════════════════════════════════

test('extractPricesFromText: "$49.99 (was $99.99)"', () => {
  const r = extractPricesFromText('$49.99 (was $99.99)');
  assert(r !== null, 'expected object');
  assertClose(r.currentPrice, 49.99);
  assertClose(r.originalPrice, 99.99);
});

test('extractPricesFromText: "originally $120"', () => {
  const r = extractPricesFromText('$60.00, originally $120.00');
  assert(r !== null);
  assertClose(r.currentPrice, 60);
  assertClose(r.originalPrice, 120);
});

test('extractPricesFromText: "Save $50 — Now $49.99"', () => {
  const r = extractPricesFromText('Save $50 — Now $49.99');
  assert(r !== null);
  assertClose(r.currentPrice, 49.99);
  assertClose(r.originalPrice, 99.99);
});

test('extractPricesFromText: אין מחיר → null', () => {
  const r = extractPricesFromText('Great deal on headphones today!');
  assert(r === null || r.currentPrice === null);
});

// ════════════════════════════════════════════════════════════
// 3. calcDiscount
// ════════════════════════════════════════════════════════════

test('calcDiscount: 50% off', () => {
  assert(calcDiscount(50, 100) === 50, 'expected 50');
});

test('calcDiscount: 30% off', () => {
  assert(calcDiscount(70, 100) === 30, 'expected 30');
});

test('calcDiscount: current >= original → null', () => {
  assert(calcDiscount(100, 100) === null, 'expected null');
  assert(calcDiscount(120, 100) === null, 'expected null');
});

test('calcDiscount: null inputs → null', () => {
  assert(calcDiscount(null, 100) === null, 'expected null');
  assert(calcDiscount(50, null) === null, 'expected null');
});

// ════════════════════════════════════════════════════════════
// 4. mapRssCategory
// ════════════════════════════════════════════════════════════

test('mapRssCategory: laptop → electronics', () => {
  assert(mapRssCategory('MacBook laptop deal') === 'electronics');
});

test('mapRssCategory: dress → fashion', () => {
  assert(mapRssCategory('Summer dress 50% off') === 'fashion');
});

test('mapRssCategory: sofa → home', () => {
  assert(mapRssCategory('IKEA sofa sale') === 'home');
});

test('mapRssCategory: lego → toys', () => {
  assert(mapRssCategory('LEGO Star Wars set deal') === 'toys');
});

test('mapRssCategory: unknown → general', () => {
  assert(mapRssCategory('Big savings today!') === 'general');
});

// ════════════════════════════════════════════════════════════
// 5. extractAsin
// ════════════════════════════════════════════════════════════

test('extractAsin: URL רגיל', () => {
  const asin = extractAsin('https://www.amazon.com/dp/B08N5WRWNW/ref=...');
  assert(asin === 'B08N5WRWNW', `got ${asin}`);
});

test('extractAsin: URL עם /product/', () => {
  const asin = extractAsin('https://www.amazon.com/product/B07XJ8C8F5?pf=...');
  assert(asin === 'B07XJ8C8F5', `got ${asin}`);
});

test('extractAsin: URL ללא ASIN → null', () => {
  assert(extractAsin('https://www.bestbuy.com/site/deal') === null);
});

test('extractAsin: null → null', () => {
  assert(extractAsin(null) === null);
});

// ════════════════════════════════════════════════════════════
// 6. parseRssXml
// ════════════════════════════════════════════════════════════

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Test Feed</title>
  <item>
    <title><![CDATA[Sony Headphones $49.99 (was $99.99)]]></title>
    <link>https://www.amazon.com/dp/B08N5WRWNW</link>
    <description><![CDATA[Great noise cancelling headphones on sale.]]></description>
    <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>IKEA KALLAX Shelf $79, originally $129</title>
    <link>https://www.ikea.com/us/en/p/kallax</link>
    <description>Versatile shelving unit</description>
    <pubDate>Mon, 17 Mar 2026 09:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

test('parseRssXml: מחלץ 2 פריטים', () => {
  const items = parseRssXml(SAMPLE_XML);
  assert(items.length === 2, `expected 2, got ${items.length}`);
});

test('parseRssXml: CDATA title מחולץ נכון', () => {
  const items = parseRssXml(SAMPLE_XML);
  assert(items[0].title.includes('Sony Headphones'), `got: ${items[0].title}`);
});

test('parseRssXml: link מחולץ', () => {
  const items = parseRssXml(SAMPLE_XML);
  assert(items[0].link.includes('amazon.com'), `got: ${items[0].link}`);
});

test('parseRssXml: XML ריק → []', () => {
  assert(parseRssXml('').length === 0);
  assert(parseRssXml(null).length === 0);
});

// ════════════════════════════════════════════════════════════
// 7. buildRssDealPayload
// ════════════════════════════════════════════════════════════

const AMAZON_FEED = {
  id: 'amazon_deals', name: 'Amazon', url: 'http://...', store: 'Amazon', currency: 'USD', source: 'rss_amazon',
};

test('buildRssDealPayload: פריט תקין עם מחיר', () => {
  const item = {
    title:       'Sony WH-1000XM5 $249.99 (was $399.99)',
    link:        'https://www.amazon.com/dp/B09XS7JWHH',
    description: 'Best noise cancelling headphones',
    pubDate:     'Mon, 17 Mar 2026 10:00:00 GMT',
  };
  const p = buildRssDealPayload(item, AMAZON_FEED);
  assert(p !== null, 'expected payload');
  assertClose(p.price, 249.99);
  assertClose(p.original_price, 399.99);
  assert(p.discount === 37 || p.discount === 38, `discount: ${p.discount}`);
  assert(p.asin === 'B09XS7JWHH', `asin: ${p.asin}`);
  assert(p.category === 'electronics', `category: ${p.category}`);
  assert(p.source === 'rss_amazon');
});

test('buildRssDealPayload: פריט ללא title → null', () => {
  const p = buildRssDealPayload({ title: '', link: 'https://x.com' }, AMAZON_FEED);
  assert(p === null);
});

test('buildRssDealPayload: הנחה קטנה מסף → null', () => {
  const item = {
    title: 'Widget $98 (was $100)', // 2% הנחה — מתחת לסף
    link:  'https://amazon.com/dp/B00000001',
  };
  const p = buildRssDealPayload(item, AMAZON_FEED);
  assert(p === null, 'should be filtered out');
});

test('buildRssDealPayload: BestBuy feed — ללא ASIN', () => {
  const BESTBUY_FEED = { id: 'bestbuy_deals', name: 'BestBuy', url: '', store: 'BestBuy', currency: 'USD', source: 'rss_bestbuy' };
  const item = { title: 'Samsung TV $499 (was $799)', link: 'https://www.bestbuy.com/site/deal/123' };
  const p = buildRssDealPayload(item, BESTBUY_FEED);
  assert(p !== null);
  assert(p.asin === null, `expected null asin, got ${p.asin}`);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-08 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
