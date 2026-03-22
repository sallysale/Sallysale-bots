// bot34.test.mjs — בדיקות יחידה ל-BOT-34 SEO Bot
// הרץ: node bot34.test.mjs
// ════════════════════════════════════════════════════════════

import {
  generateSlug,
  generateSeoTitle,
  generateSeoDescription,
  generateOgTitle,
  generateOgDescription,
  buildDealSeoPayload,
  generateSitemapXml,
} from './bot34.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'failed'); }

// ── מוצר דוגמה ───────────────────────────────────────────────

const DEAL = {
  id:             'abc12345-0000-0000-0000-000000000000',
  title:          'Sony WH-1000XM5 Wireless Noise-Cancelling Headphones',
  price:          249.99,
  original_price: 399.99,
  currency:       'USD',
  discount:       37,
  store_name:     'Amazon',
  category:       'electronics',
  image_url:      'https://m.media-amazon.com/images/I/test.jpg',
  updated_at:     '2026-03-17T10:00:00Z',
};

// ════════════════════════════════════════════════════════════
// 1. generateSlug
// ════════════════════════════════════════════════════════════

test('generateSlug: ממיר לאותיות קטנות + מקפים', () => {
  const slug = generateSlug('Sony WH-1000XM5 Headphones', 'abc12345');
  assert(slug === slug.toLowerCase(), `not lowercase: ${slug}`);
  assert(!slug.includes(' '), `has spaces: ${slug}`);
});

test('generateSlug: מסיר תווים מיוחדים', () => {
  const slug = generateSlug('Product (50% OFF) — Amazing!', 'abc123');
  assert(!/[()%!—]/.test(slug), `special chars remain: ${slug}`);
});

test('generateSlug: מקסימום אורך', () => {
  const long = 'a'.repeat(200);
  const slug = generateSlug(long, 'abc123');
  assert(slug.length <= 90, `too long: ${slug.length}`);
});

test('generateSlug: null title → slug תקין', () => {
  const slug = generateSlug(null, 'abc123');
  assert(typeof slug === 'string' && slug.length > 0);
});

test('generateSlug: suffix ייחודי מ-ID', () => {
  const s1 = generateSlug('Same Title', 'aaaa1111-0000-0000-0000-000000000000');
  const s2 = generateSlug('Same Title', 'bbbb2222-0000-0000-0000-000000000000');
  assert(s1 !== s2, `slugs identical: ${s1}`);
});

// ════════════════════════════════════════════════════════════
// 2. generateSeoTitle
// ════════════════════════════════════════════════════════════

test('generateSeoTitle: מקסימום 70 תווים', () => {
  const t = generateSeoTitle(DEAL);
  assert(t.length <= 70, `too long: ${t.length} — "${t}"`);
});

test('generateSeoTitle: מכיל % הנחה', () => {
  const t = generateSeoTitle(DEAL);
  assert(t.includes('37'), `missing discount: "${t}"`);
});

test('generateSeoTitle: מכיל שם חנות', () => {
  const t = generateSeoTitle(DEAL);
  assert(t.includes('Amazon'), `missing store: "${t}"`);
});

test('generateSeoTitle: ללא הנחה — עדיין תקין', () => {
  const t = generateSeoTitle({ ...DEAL, discount: 0 });
  assert(typeof t === 'string' && t.length > 0);
  assert(!t.includes('OFF'), `should not have OFF: "${t}"`);
});

// ════════════════════════════════════════════════════════════
// 3. generateSeoDescription
// ════════════════════════════════════════════════════════════

test('generateSeoDescription: מקסימום 160 תווים', () => {
  const d = generateSeoDescription(DEAL);
  assert(d.length <= 160, `too long: ${d.length}`);
});

test('generateSeoDescription: מכיל מחיר', () => {
  const d = generateSeoDescription(DEAL);
  assert(d.includes('249'), `missing price: "${d}"`);
});

test('generateSeoDescription: מכיל "Save"', () => {
  const d = generateSeoDescription(DEAL);
  assert(d.includes('Save') || d.includes('%'), `missing save/discount: "${d}"`);
});

// ════════════════════════════════════════════════════════════
// 4. generateOgTitle
// ════════════════════════════════════════════════════════════

test('generateOgTitle: מקסימום 70 תווים', () => {
  const t = generateOgTitle(DEAL);
  assert(t.length <= 70, `too long: ${t.length}`);
});

test('generateOgTitle: ציון גבוה — emoji 🔥', () => {
  const t = generateOgTitle({ ...DEAL, discount: 50 });
  assert(t.includes('🔥') || t.includes('%'), `missing fire/pct: "${t}"`);
});

// ════════════════════════════════════════════════════════════
// 5. generateOgDescription
// ════════════════════════════════════════════════════════════

test('generateOgDescription: מקסימום 200 תווים', () => {
  const d = generateOgDescription(DEAL);
  assert(d.length <= 200, `too long: ${d.length}`);
});

test('generateOgDescription: מכיל SallySale brand', () => {
  const d = generateOgDescription(DEAL);
  assert(d.includes('SallySale'), `missing brand: "${d}"`);
});

// ════════════════════════════════════════════════════════════
// 6. buildDealSeoPayload
// ════════════════════════════════════════════════════════════

test('buildDealSeoPayload: מחזיר את כל השדות', () => {
  const p = buildDealSeoPayload(DEAL);
  assert(p !== null);
  assert(p.seo_title,       'missing seo_title');
  assert(p.seo_description, 'missing seo_description');
  assert(p.seo_slug,        'missing seo_slug');
  assert(p.og_title,        'missing og_title');
  assert(p.og_description,  'missing og_description');
  assert(p.seo_updated_at,  'missing seo_updated_at');
});

test('buildDealSeoPayload: null deal → null', () => {
  assert(buildDealSeoPayload(null) === null);
  assert(buildDealSeoPayload({}) === null);
});

test('buildDealSeoPayload: og_image מה-deal', () => {
  const p = buildDealSeoPayload(DEAL);
  assert(p.og_image === DEAL.image_url, `og_image: ${p.og_image}`);
});

// ════════════════════════════════════════════════════════════
// 7. generateSitemapXml
// ════════════════════════════════════════════════════════════

const SITEMAP_DEALS = [
  { seo_slug: 'sony-headphones-abc123', updated_at: '2026-03-17T10:00:00Z' },
  { seo_slug: 'ikea-desk-lamp-def456', updated_at: '2026-03-16T08:00:00Z' },
  { seo_slug: null, updated_at: '2026-03-15T00:00:00Z' }, // יסונן
];

test('generateSitemapXml: XML תקין עם header', () => {
  const xml = generateSitemapXml(SITEMAP_DEALS, 'https://sallysale.com');
  assert(xml.startsWith('<?xml'), `bad header: ${xml.substring(0, 50)}`);
  assert(xml.includes('<urlset'), 'missing urlset');
});

test('generateSitemapXml: מסנן slugs ריקים', () => {
  const xml = generateSitemapXml(SITEMAP_DEALS, 'https://sallysale.com');
  const matches = xml.match(/<url>/g) || [];
  // 2 deals + 2 static pages (/ and /deals)
  assert(matches.length === 4, `expected 4 urls, got ${matches.length}`);
});

test('generateSitemapXml: URL נכון', () => {
  const xml = generateSitemapXml(SITEMAP_DEALS, 'https://sallysale.com');
  assert(xml.includes('https://sallysale.com/deals/sony-headphones-abc123'));
});

test('generateSitemapXml: כולל דפי בית + דילים', () => {
  const xml = generateSitemapXml([], 'https://sallysale.com');
  assert(xml.includes('https://sallysale.com/'), 'missing home');
  assert(xml.includes('https://sallysale.com/deals'), 'missing /deals');
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-34 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
