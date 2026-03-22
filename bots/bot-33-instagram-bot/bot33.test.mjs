// bot33.test.mjs — בדיקות יחידה ל-BOT-33 Instagram Bot
// הרץ: node bot33.test.mjs
// ════════════════════════════════════════════════════════════

import {
  pickHashtags,
  formatPostText,
  buildCaption,
  buildInstagramQueueItem,
  isCaptionValid,
  HASHTAG_BANKS,
  GLOBAL_HASHTAGS,
} from './bot33.mjs';

const PASSED = [];
const FAILED = [];

function test(name, fn) {
  try { fn(); PASSED.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAILED.push(name); console.error(`❌ ${name}: ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'failed'); }

const DEAL = {
  id:             'deal-abc-123',
  title:          'Sony WH-1000XM5 Noise-Cancelling Headphones',
  price:          249.99,
  original_price: 399.99,
  currency:       'USD',
  discount:       37,
  score:          88,
  category:       'electronics',
  store_name:     'Amazon',
  image_url:      'https://m.media-amazon.com/images/I/test.jpg',
  seo_slug:       'sony-wh-1000xm5-abc123',
  status:         'active',
};

// ════════════════════════════════════════════════════════════
// 1. pickHashtags
// ════════════════════════════════════════════════════════════

test('pickHashtags: מכיל global hashtags', () => {
  const tags = pickHashtags('electronics');
  assert(tags.includes('#SallySale'), `missing #SallySale: ${tags}`);
  assert(tags.includes('#Deals'), `missing #Deals: ${tags}`);
});

test('pickHashtags: מכיל category hashtags', () => {
  const tags = pickHashtags('electronics');
  assert(tags.some(t => t.includes('Tech') || t.includes('Electronics')), `no tech tag: ${tags}`);
});

test('pickHashtags: מקסימום 15 hashtags', () => {
  const tags = pickHashtags('fashion', 15);
  assert(tags.length <= 15, `too many: ${tags.length}`);
});

test('pickHashtags: קטגוריה לא קיימת → general hashtags', () => {
  const tags = pickHashtags('unknown_category');
  assert(tags.includes('#SallySale'));
  assert(tags.length > 0);
});

// ════════════════════════════════════════════════════════════
// 2. formatPostText
// ════════════════════════════════════════════════════════════

test('formatPostText: מכיל כותרת', () => {
  const text = formatPostText(DEAL);
  assert(text.includes('Sony'), `missing title: ${text.substring(0, 80)}`);
});

test('formatPostText: מכיל % הנחה', () => {
  const text = formatPostText(DEAL);
  assert(text.includes('37%'), `missing discount: ${text.substring(0, 80)}`);
});

test('formatPostText: מכיל מחיר', () => {
  const text = formatPostText(DEAL);
  assert(text.includes('249'), `missing price: ${text.substring(0, 100)}`);
});

test('formatPostText: מכיל URL', () => {
  const text = formatPostText(DEAL);
  assert(text.includes('sallysale.com'), `missing url: ${text}`);
});

test('formatPostText: ללא מחיר — עדיין תקין', () => {
  const text = formatPostText({ ...DEAL, price: null });
  assert(typeof text === 'string' && text.length > 0);
});

// ════════════════════════════════════════════════════════════
// 3. buildCaption
// ════════════════════════════════════════════════════════════

test('buildCaption: מאחד טקסט + hashtags', () => {
  const caption = buildCaption('Post text here\n', ['#Sale', '#Deals']);
  assert(caption.includes('Post text here'), `missing text`);
  assert(caption.includes('#Sale') && caption.includes('#Deals'), `missing tags`);
});

test('buildCaption: יש שורה ריקה בין טקסט ל-hashtags', () => {
  const caption = buildCaption('text\n', ['#tag']);
  assert(caption.includes('.\n'), `missing separator`);
});

// ════════════════════════════════════════════════════════════
// 4. buildInstagramQueueItem
// ════════════════════════════════════════════════════════════

test('buildInstagramQueueItem: כל שדות חובה', () => {
  const item = buildInstagramQueueItem(DEAL);
  assert(item !== null);
  assert(item.deal_id === 'deal-abc-123');
  assert(item.post_text.length > 0);
  assert(Array.isArray(item.hashtags));
  assert(item.caption.length > 0);
  assert(item.status === 'pending');
  assert(item.score === 88);
});

test('buildInstagramQueueItem: image_url מועבר', () => {
  const item = buildInstagramQueueItem(DEAL);
  assert(item.image_url === DEAL.image_url);
});

test('buildInstagramQueueItem: null deal → null', () => {
  assert(buildInstagramQueueItem(null) === null);
  assert(buildInstagramQueueItem({}) === null);
});

test('buildInstagramQueueItem: deal ללא image → image_url=null', () => {
  const item = buildInstagramQueueItem({ ...DEAL, image_url: null });
  assert(item.image_url === null);
});

// ════════════════════════════════════════════════════════════
// 5. isCaptionValid
// ════════════════════════════════════════════════════════════

test('isCaptionValid: caption תקין', () => {
  const item = buildInstagramQueueItem(DEAL);
  const { valid } = isCaptionValid(item.caption);
  assert(valid === true);
});

test('isCaptionValid: caption ארוך מ-2200 תווים → לא תקין', () => {
  const longCaption = 'a'.repeat(2201);
  const { valid, reason } = isCaptionValid(longCaption);
  assert(valid === false, 'should be invalid');
  assert(reason.includes('ארוך'), `reason: ${reason}`);
});

test('isCaptionValid: caption ריק → לא תקין', () => {
  assert(isCaptionValid('').valid === false);
  assert(isCaptionValid(null).valid === false);
});

test('isCaptionValid: יותר מ-30 hashtags → לא תקין', () => {
  const manyTags = Array.from({length: 31}, (_, i) => `#tag${i}`).join(' ');
  const { valid } = isCaptionValid(`text\n${manyTags}`);
  assert(valid === false, 'should reject 31 hashtags');
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-33 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) { console.error('נכשלו:', FAILED); process.exit(1); }
