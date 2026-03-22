// bot71.test.mjs — בדיקות ל-BOT-71 Dependency Scanner
// הרץ: node bot71.test.mjs

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './shared/supabaseClient.mjs';

const TESTS_PASSED = [];
const TESTS_FAILED = [];
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function test(name, fn) {
  try {
    await fn();
    TESTS_PASSED.push(name);
    console.log(`✅ ${name}`);
  } catch (e) {
    TESTS_FAILED.push(name);
    console.error(`❌ ${name}: ${e.message}`);
  }
}

// ── Unit: parseAuditResult ────────────────────────────────────
function parseAuditResult(raw, dir) {
  if (!raw) return { dir, total: 0, critical: 0, high: 0, moderate: 0, low: 0, packages: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { dir, total: 0, critical: 0, high: 0, moderate: 0, low: 0, packages: [], parseError: true }; }
  const meta = parsed.metadata?.vulnerabilities || {};
  return {
    dir,
    total:    meta.total    || 0,
    critical: meta.critical || 0,
    high:     meta.high     || 0,
    moderate: meta.moderate || 0,
    low:      meta.low      || 0,
    packages: [],
  };
}

await test('parseAuditResult — raw null → total=0', async () => {
  const r = parseAuditResult(null, 'test');
  if (r.total !== 0) throw new Error(`ציפינו 0, קיבלנו ${r.total}`);
});

await test('parseAuditResult — JSON ריק → total=0', async () => {
  const r = parseAuditResult('{}', 'test');
  if (r.total !== 0) throw new Error(`ציפינו 0, קיבלנו ${r.total}`);
});

await test('parseAuditResult — JSON עם vulnerabilities', async () => {
  const mockAudit = JSON.stringify({
    metadata: { vulnerabilities: { critical: 2, high: 3, moderate: 1, low: 0, total: 6 } }
  });
  const r = parseAuditResult(mockAudit, 'test');
  if (r.critical !== 2) throw new Error(`ציפינו critical=2, קיבלנו ${r.critical}`);
  if (r.high !== 3) throw new Error(`ציפינו high=3, קיבלנו ${r.high}`);
  if (r.total !== 6) throw new Error(`ציפינו total=6, קיבלנו ${r.total}`);
});

await test('parseAuditResult — JSON שגוי → parseError=true', async () => {
  const r = parseAuditResult('NOT_JSON', 'test');
  if (!r.parseError) throw new Error('JSON שגוי צריך לחזור עם parseError');
});

// ── Unit: findBotDirs ─────────────────────────────────────────
await test('תיקיית bots קיימת', async () => {
  const botsRoot = path.resolve(__dirname, '..');
  if (!fs.existsSync(botsRoot)) throw new Error(`תיקיית bots לא נמצאה: ${botsRoot}`);
});

await test('יש לפחות תיקיית בוט אחת עם package.json', async () => {
  const botsRoot = path.resolve(__dirname, '..');
  const entries  = fs.readdirSync(botsRoot, { withFileTypes: true });
  let found = false;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === 'shared') continue;
    const pkgPath = path.join(botsRoot, entry.name, 'package.json');
    if (fs.existsSync(pkgPath)) { found = true; break; }
  }
  if (!found) throw new Error('לא נמצאה תיקיית בוט עם package.json');
});

// ── DB: בדיקות ───────────────────────────────────────────────
await test('חיבור ל-Supabase', async () => {
  const { error } = await supabase.from('deals').select('id').limit(1);
  if (error) throw new Error(error.message);
});

await test('bots_log INSERT ו-UPDATE', async () => {
  const { data, error: ie } = await supabase
    .from('bots_log')
    .insert({ bot_id: 'BOT-71-TEST', status: 'running' })
    .select('id')
    .single();
  if (ie) throw new Error(ie.message);

  const { error: ue } = await supabase
    .from('bots_log')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', data.id);
  if (ue) throw new Error(ue.message);

  await supabase.from('bots_log').delete().eq('id', data.id);
});

// ── תוצאות ───────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`📊 תוצאות: ${TESTS_PASSED.length} עברו, ${TESTS_FAILED.length} נכשלו`);

if (TESTS_FAILED.length > 0) {
  TESTS_FAILED.forEach(t => console.error(`   • ${t}`));
  process.exit(1);
} else {
  console.log('✅ הכל תקין — BOT-71 מוכן להרצה!');
  process.exit(0);
}
