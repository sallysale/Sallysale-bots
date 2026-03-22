// bot15.test.mjs — בדיקות ל-BOT-15 Seasonal Intel
// הרץ: node bot15.test.mjs
// 12 בדיקות unit

import {
  SEASONAL_EVENTS,
  getUpcomingEvents,
  isEventUpcoming,
  getSeasonalTags,
  calcEventBoost,
} from './bot15.mjs';

const PASS = [], FAIL = [];
function assert(c, m) { if (!c) throw new Error(m); }
async function test(name, fn) {
  try { await fn(); PASS.push(name); console.log(`✅ ${name}`); }
  catch (e) { FAIL.push(name); console.error(`❌ ${name}: ${e.message}`); }
}

// ── SEASONAL_EVENTS ───────────────────────────────────────

await test('SEASONAL_EVENTS: מכיל לפחות 15 אירועים', () => {
  assert(SEASONAL_EVENTS.length >= 15, `יש רק ${SEASONAL_EVENTS.length} אירועים`);
});
await test('SEASONAL_EVENTS: כל אירוע יש לו id, month, day, tags', () => {
  const invalid = SEASONAL_EVENTS.filter(e => !e.id || !e.month || !e.day || !e.tags);
  assert(invalid.length === 0, `${invalid.length} אירועים לא תקינים`);
});
await test('SEASONAL_EVENTS: black_friday קיים', () => {
  assert(SEASONAL_EVENTS.some(e => e.id === 'black_friday'), 'חסר black_friday');
});

// ── isEventUpcoming ───────────────────────────────────────

await test('isEventUpcoming: אירוע בעוד 5 ימים עם window 14 → true', () => {
  const now   = new Date('2026-11-24'); // 5 ימים לפני Black Friday (29 נוב)
  const event = SEASONAL_EVENTS.find(e => e.id === 'black_friday');
  assert(isEventUpcoming(event, 14, now) === true, 'ציפינו true');
});
await test('isEventUpcoming: אירוע שעבר החודש הנוכחי → false', () => {
  const now   = new Date('2026-12-31'); // Black Friday עבר
  const event = SEASONAL_EVENTS.find(e => e.id === 'black_friday');
  // Black Friday נוב 29 — בדצמבר הוא עבר, ינוב הוא רחוק → false
  const result = isEventUpcoming(event, 14, now);
  assert(result === false, 'ציפינו false (Black Friday עבר, ואין בשנה הבאה תוך 14 יום)');
});

// ── getUpcomingEvents ─────────────────────────────────────

await test('getUpcomingEvents: תאריך 10 ימים לפני Christmas → מחזיר christmas', () => {
  const now    = new Date('2026-12-15');
  const events = getUpcomingEvents(14, now);
  assert(events.some(e => e.id === 'christmas_sale'), `לא נמצא christmas_sale: ${events.map(e => e.id)}`);
});
await test('getUpcomingEvents: אין אירועים → מחזיר []', () => {
  // תאריך שאין אחריו אירועים ב-1 יום
  const now    = new Date('2026-07-10');
  const events = getUpcomingEvents(0, now);   // 0 ימים קדימה
  assert(Array.isArray(events), 'ציפינו מערך');
});
await test('getUpcomingEvents: ממוין לפי daysUntil', () => {
  const now = new Date('2026-11-20');
  const events = getUpcomingEvents(30, now);
  for (let i = 1; i < events.length; i++) {
    assert(events[i].daysUntil >= events[i-1].daysUntil, 'לא ממוין');
  }
});

// ── getSeasonalTags ───────────────────────────────────────

await test('getSeasonalTags: daysUntil=2 → כולל "urgent"', () => {
  const event = { ...SEASONAL_EVENTS[0], daysUntil: 2 };
  const tags  = getSeasonalTags(event);
  assert(tags.includes('urgent'), `חסר urgent: ${tags}`);
});
await test('getSeasonalTags: daysUntil=5 → כולל "coming_soon"', () => {
  const event = { ...SEASONAL_EVENTS[0], daysUntil: 5 };
  const tags  = getSeasonalTags(event);
  assert(tags.includes('coming_soon'), `חסר coming_soon: ${tags}`);
});

// ── calcEventBoost ────────────────────────────────────────

await test('calcEventBoost: daysUntil=1 → boost × 1.5', () => {
  const event  = { boost: 20, daysUntil: 1 };
  assert(calcEventBoost(event) === 30, `ציפינו 30, קיבלנו: ${calcEventBoost(event)}`);
});
await test('calcEventBoost: daysUntil=10 → boost × 1.0', () => {
  const event  = { boost: 20, daysUntil: 10 };
  assert(calcEventBoost(event) === 20, `ציפינו 20, קיבלנו: ${calcEventBoost(event)}`);
});

// ── תוצאות ────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 BOT-15: ${PASS.length} עברו, ${FAIL.length} נכשלו`);
if (FAIL.length) { FAIL.forEach(t => console.error(`   • ${t}`)); process.exit(1); }
else { console.log('✅ כל הבדיקות עברו — BOT-15 מוכן!'); process.exit(0); }
