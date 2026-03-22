// bot39.test.mjs — בדיקות יחידה ל-BOT-39 Backup Bot
// הרץ: node bot39.test.mjs
// ════════════════════════════════════════════════════════════

import {
  buildBackupFilename,
  serializeDeals,
  calcFileSizeBytes,
  shouldRunBackup,
  parseBackupFilename,
  selectOldBackups,
  KEEP_BACKUPS,
  BACKUP_INTERVAL_MS,
} from './bot39.mjs';

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

// ════════════════════════════════════════════════════════════
// 1. buildBackupFilename
// ════════════════════════════════════════════════════════════

test('buildBackupFilename: פורמט נכון', () => {
  const name = buildBackupFilename(new Date('2026-03-17T00:00:00Z'));
  assert(name === 'deals-2026-03-17.json', `got: ${name}`);
});

test('buildBackupFilename: מסתיים ב-.json', () => {
  const name = buildBackupFilename();
  assert(name.endsWith('.json'), `got: ${name}`);
  assert(name.startsWith('deals-'), `got: ${name}`);
});

test('buildBackupFilename: תאריך מדויק', () => {
  const name = buildBackupFilename(new Date('2026-01-05T00:00:00Z'));
  assert(name === 'deals-2026-01-05.json', `got: ${name}`);
});

// ════════════════════════════════════════════════════════════
// 2. serializeDeals
// ════════════════════════════════════════════════════════════

test('serializeDeals: JSON תקין', () => {
  const json = serializeDeals([{ id: '1', title: 'Test' }]);
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed) && parsed.length === 1);
  assert(parsed[0].id === '1');
});

test('serializeDeals: מערך ריק → "[]"', () => {
  const json = serializeDeals([]);
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed) && parsed.length === 0);
});

test('serializeDeals: null safe', () => {
  const json = serializeDeals(null);
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed));
});

// ════════════════════════════════════════════════════════════
// 3. calcFileSizeBytes
// ════════════════════════════════════════════════════════════

test('calcFileSizeBytes: מחזיר bytes חיוביים', () => {
  const size = calcFileSizeBytes('{"hello":"world"}');
  assert(size > 0, `expected >0, got ${size}`);
});

test('calcFileSizeBytes: string ריק = 0', () => {
  assert(calcFileSizeBytes('') === 0);
});

// ════════════════════════════════════════════════════════════
// 4. shouldRunBackup
// ════════════════════════════════════════════════════════════

test('shouldRunBackup: true אם לא היה גיבוי', () => {
  assert(shouldRunBackup(null) === true);
  assert(shouldRunBackup(undefined) === true);
});

test('shouldRunBackup: false אם גיבוי עכשיו', () => {
  assert(shouldRunBackup(new Date()) === false);
});

test('shouldRunBackup: true אם עבר שבוע', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  assert(shouldRunBackup(eightDaysAgo) === true);
});

test('shouldRunBackup: false אם עבר 3 ימים (interval=7)', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  assert(shouldRunBackup(threeDaysAgo) === false);
});

// ════════════════════════════════════════════════════════════
// 5. parseBackupFilename
// ════════════════════════════════════════════════════════════

test('parseBackupFilename: מפענח נכון', () => {
  const r = parseBackupFilename('deals-2026-03-17.json');
  assert(r !== null, 'expected result, got null');
  assert(r.date instanceof Date);
  assert(r.date.getUTCFullYear() === 2026);
});

test('parseBackupFilename: שם לא תקין → null', () => {
  assert(parseBackupFilename('backup.json') === null);
  assert(parseBackupFilename('') === null);
  assert(parseBackupFilename('deals-invalid.json') === null);
});

// ════════════════════════════════════════════════════════════
// 6. selectOldBackups
// ════════════════════════════════════════════════════════════

function makeBackup(filename, daysAgo) {
  return {
    id:         `id-${filename}`,
    filename,
    created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  };
}

test('selectOldBackups: שומר רק KEEP_BACKUPS האחרונים', () => {
  const backups = [
    makeBackup('deals-2026-03-17.json', 0),
    makeBackup('deals-2026-03-10.json', 7),
    makeBackup('deals-2026-03-03.json', 14),
    makeBackup('deals-2026-02-24.json', 21),
    makeBackup('deals-2026-02-17.json', 28),
    makeBackup('deals-2026-02-10.json', 35),
  ];
  const toDelete = selectOldBackups(backups, 4);
  assert(toDelete.length === 2, `expected 2, got ${toDelete.length}`);
  // הישנים ביותר נמחקים
  assert(toDelete.some(b => b.filename === 'deals-2026-02-10.json'));
});

test('selectOldBackups: [] כשפחות מ-KEEP_BACKUPS', () => {
  const backups = [
    makeBackup('deals-2026-03-17.json', 0),
    makeBackup('deals-2026-03-10.json', 7),
  ];
  const toDelete = selectOldBackups(backups, 4);
  assert(toDelete.length === 0);
});

test('selectOldBackups: [] כשmassage ריק', () => {
  assert(selectOldBackups([]).length === 0);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-39 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
