// ════════════════════════════════════════════════════════════
// BOT-25 — Auto Translator
// תפקיד: מתרגם title_en של דילים ל-5 שפות בעזרת DeepL API.
//
// שפות:
//   DE — גרמנית  (DeepL חינם + Pro)
//   FR — צרפתית  (DeepL חינם + Pro)
//   ES — ספרדית  (DeepL חינם + Pro)
//   JA — יפנית   (DeepL חינם + Pro)
//   HE — עברית   (DeepL Pro בלבד — דורש DEEPL_PRO=true)
//
// הערה: DeepL Free tier אינו תומך בעברית (HE).
//   אם DEEPL_PRO=true → משתמש ב-api.deepl.com (תומך HE)
//   אחרת             → משתמש ב-api-free.deepl.com (ללא HE)
//
// לוגיקה:
//   1. שולף 20 דילים שחסרים לפחות אחת מ-DE/FR/ES
//   2. לכל דיל — מתרגם את title_en לכל שפה חסרה
//   3. מעדכן deals עם כל התרגומים + translated_at + translation_langs
//   4. כותב סיכום ל-bots_log
//
// תדירות: כל 4 שעות (Railway cron: 0 */4 * * *)
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID     = 'BOT-25';
const BATCH_SIZE = 20;
const DELAY_MS   = 1000;  // השהייה בין דילים — כיבוד rate-limit של DeepL

// ── מיפוי שפות ────────────────────────────────────────────
// קוד שפה פנימי → קוד DeepL + שדה DB

const LANG_MAP = {
  HE: { deepl: 'HE', field: 'title_he', proOnly: true  },
  DE: { deepl: 'DE', field: 'title_de', proOnly: false },
  FR: { deepl: 'FR', field: 'title_fr', proOnly: false },
  ES: { deepl: 'ES', field: 'title_es', proOnly: false },
  JA: { deepl: 'JA', field: 'title_ja', proOnly: false },
};

// ── getDeepLCode ──────────────────────────────────────────
// מחזיר קוד DeepL לשפה נתונה, או null אם לא תקין

export function getDeepLCode(lang) {
  const entry = LANG_MAP[lang?.toUpperCase()];
  return entry ? entry.deepl : null;
}

// ── needsTranslation ──────────────────────────────────────
// מחזיר true אם לפחות אחת מ-DE/FR/ES חסרה (שלוש השפות העיקריות)
// JA ו-HE — אופציונליות, לא קובעות needsTranslation

export function needsTranslation(deal) {
  if (!deal || typeof deal !== 'object') return true;
  const de = deal.title_de;
  const fr = deal.title_fr;
  const es = deal.title_es;
  // true = לפחות אחת חסרה
  return !de || !fr || !es;
}

// ── buildUpdatePayload ─────────────────────────────────────
// בונה אובייקט עדכון ל-Supabase מרשימות langs + texts.
// לדוגמה: buildUpdatePayload(['DE','FR'], ['Hallo','Bonjour'])
//           → { title_de: 'Hallo', title_fr: 'Bonjour' }

export function buildUpdatePayload(langs, texts) {
  const payload = {};
  for (let i = 0; i < langs.length; i++) {
    const lang  = langs[i]?.toUpperCase();
    const entry = LANG_MAP[lang];
    if (entry && texts[i] != null) {
      payload[entry.field] = texts[i];
    }
  }
  return payload;
}

// ── truncateTitle ─────────────────────────────────────────
// חותך כותרת לאורך מקסימלי (DeepL מוגבל ל-5,000 תווים לקריאה)
// אבל לצרכי עלות — מגבילים ל-maxLen תווים

export function truncateTitle(title, maxLen = 200) {
  if (!title || typeof title !== 'string') return '';
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen).trimEnd() + '…';
}

// ── isProTier ─────────────────────────────────────────────
// מחזיר true אם מוגדר DEEPL_PRO=true (תומך בעברית)

function isProTier() {
  return process.env.DEEPL_PRO === 'true';
}

// ── getDeepLBaseUrl ────────────────────────────────────────
// Free tier: api-free.deepl.com / Pro tier: api.deepl.com

function getDeepLBaseUrl() {
  return isProTier()
    ? 'https://api.deepl.com/v2/translate'
    : 'https://api-free.deepl.com/v2/translate';
}

// ── translateText ─────────────────────────────────────────
// קריאה אחת ל-DeepL API. מחזיר טקסט מתורגם או null בכישלון.

async function translateText(text, targetLang, logger) {
  if (!process.env.DEEPL_API_KEY) {
    logger.err('חסר DEEPL_API_KEY — לא ניתן לתרגם');
    return null;
  }

  const url      = getDeepLBaseUrl();
  const trimmed  = truncateTitle(text, 200);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        text:        [trimmed],
        target_lang: targetLang,
        source_lang: 'EN',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.err(`DeepL שגיאת HTTP ${response.status} ל-${targetLang}: ${errText.slice(0, 120)}`);
      return null;
    }

    const data        = await response.json();
    const translated  = data?.translations?.[0]?.text;
    return translated || null;

  } catch (err) {
    logger.err(`translateText חריגה (${targetLang}): ${err.message}`);
    return null;
  }
}

// ── getLanguagesToTranslate ────────────────────────────────
// מחזיר רשימת שפות שעדיין חסרות לדיל.
// מסנן HE אם לא Pro tier.

function getLanguagesToTranslate(deal) {
  const pro    = isProTier();
  const langs  = [];

  for (const [langCode, entry] of Object.entries(LANG_MAP)) {
    // HE — רק ב-Pro
    if (entry.proOnly && !pro) {
      continue;
    }
    // בדוק אם השדה ריק
    const currentValue = deal[entry.field];
    if (!currentValue) {
      langs.push(langCode);
    }
  }

  return langs;
}

// ── translateDeal ─────────────────────────────────────────
// מתרגם דיל אחד לכל השפות החסרות.
// מחזיר { payload, translatedLangs } או null אם אין מה לתרגם.

async function translateDeal(deal, logger) {
  const title = deal.title_en;
  if (!title?.trim()) {
    logger.log(`דיל ${deal.id} ללא title_en — דולג`);
    return null;
  }

  const langsToTranslate = getLanguagesToTranslate(deal);
  if (langsToTranslate.length === 0) {
    return null; // כבר מתורגם לכל השפות הרלוונטיות
  }

  logger.log(`מתרגם דיל ${deal.id}: ${langsToTranslate.join(', ')} | "${title.slice(0, 50)}"`);

  const translatedTexts  = [];
  const successfulLangs  = [];

  for (const lang of langsToTranslate) {
    const deepLCode   = getDeepLCode(lang);
    const translated  = await translateText(title, deepLCode, logger);

    if (translated) {
      translatedTexts.push(translated);
      successfulLangs.push(lang);
      logger.ok(`  ${lang}: "${translated.slice(0, 50)}"`);
    } else {
      logger.err(`  נכשל תרגום ל-${lang} לדיל ${deal.id}`);
    }

    // השהייה קצרה בין שפות — מניעת burst
    if (langsToTranslate.indexOf(lang) < langsToTranslate.length - 1) {
      await sleep(200);
    }
  }

  if (successfulLangs.length === 0) return null;

  const payload = buildUpdatePayload(successfulLangs, translatedTexts);
  return { payload, translatedLangs: successfulLangs };
}

// ── bots_log ───────────────────────────────────────────────

async function logStart() {
  const { data, error } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(`logStart failed: ${error.message}`);
  return data.id;
}

async function logFinish(logId, stats, status = 'done') {
  await supabase
    .from('bots_log')
    .update({
      finished_at:   new Date().toISOString(),
      status,
      deals_updated: stats.updated,
      errors:        stats.errors,
    })
    .eq('id', logId);
}

// ── fetchUntranslated ─────────────────────────────────────
// שולף דילים שחסרים לפחות אחת מ-DE/FR/ES
// אם עמודות התרגום לא קיימות עדיין → מחזיר []

async function fetchUntranslated(logger) {
  // בדיקה: האם עמודות התרגום קיימות?
  const probe = await supabase
    .from('deals')
    .select('title_de')
    .limit(1);

  if (probe.error && probe.error.message.includes('column "title_de" does not exist')) {
    logger.err('עמודות תרגום לא קיימות — הרץ migration-bot25.sql ב-Supabase SQL Editor');
    return [];
  }

  const { data, error } = await supabase
    .from('deals')
    .select('id, title_en, title_he, title_de, title_fr, title_es, title_ja')
    .eq('status', 'published')
    .not('title_en', 'is', null)
    .neq('title_en', '')
    .or('title_de.is.null,title_fr.is.null,title_es.is.null')
    .limit(BATCH_SIZE);

  if (error) {
    logger.err(`fetchUntranslated נכשל: ${error.message}`);
    return [];
  }

  logger.log(`נמצאו ${data.length} דילים לתרגום`);
  return data;
}

// ── processBatch ──────────────────────────────────────────

async function processBatch(deals, stats, logger) {
  for (const deal of deals) {
    try {
      const result = await translateDeal(deal, logger);

      if (!result) {
        // אין מה לתרגם / כבר מתורגם
        continue;
      }

      const { payload, translatedLangs } = result;

      // הוסף timestamp ורשימת שפות שתורגמו
      payload.translated_at = new Date().toISOString();

      // מיזוג עם רשימת שפות קיימת (אם יש)
      const existingLangs = deal.translation_langs || [];
      const mergedLangs   = [...new Set([...existingLangs, ...translatedLangs])];
      payload.translation_langs = mergedLangs;

      const { error: updateErr } = await supabase
        .from('deals')
        .update(payload)
        .eq('id', deal.id);

      if (updateErr) {
        const msg = `עדכון נכשל לדיל ${deal.id}: ${updateErr.message}`;
        logger.err(msg);
        stats.errors.push(msg);
      } else {
        stats.updated++;
        logger.ok(`✅ דיל ${deal.id} — תורגם ל: ${translatedLangs.join(', ')}`);
      }

    } catch (err) {
      const msg = `שגיאה לדיל ${deal.id}: ${err.message}`;
      logger.err(msg);
      stats.errors.push(msg);
    }

    // השהייה בין דילים — חיסכון בעלות API
    await sleep(DELAY_MS);
  }
}

// ── printStats ─────────────────────────────────────────────

async function printStats(stats, logger) {
  const { count: totalPublished } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published');

  const { count: withDe } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('title_de', 'is', null);

  const { count: withFr } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('title_fr', 'is', null);

  logger.ok(`📊 סה"כ פעילים: ${totalPublished} | DE: ${withDe} | FR: ${withFr}`);
  logger.ok(`✅ עודכנו הרצה זו: ${stats.updated}`);

  if (!isProTier()) {
    logger.log('⚠️  עברית מושבתת (נדרש DEEPL_PRO=true) — https://www.deepl.com/pro');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── main ──────────────────────────────────────────────────

async function main() {
  const logger = createLogger(BOT_ID);
  logger.log('=== BOT-25 Auto Translator — מתחיל ===');
  logger.log(`מצב: DeepL ${isProTier() ? 'Pro (כולל עברית)' : 'Free (ללא עברית)'}`);

  if (!process.env.DEEPL_API_KEY) {
    logger.err('חסר DEEPL_API_KEY — לא ניתן לתרגם. הגדר במשתני הסביבה של Railway.');
    process.exit(1);
  }

  let logId;
  try {
    logId = await logStart();
  } catch (e) {
    logger.err(`לא הצליח ליצור bots_log: ${e.message}`);
  }

  const stats = { updated: 0, errors: [] };

  try {
    let totalFetched = 0;

    while (true) {
      const deals = await fetchUntranslated(logger);
      if (deals.length === 0) break;

      totalFetched += deals.length;
      await processBatch(deals, stats, logger);

      if (deals.length < BATCH_SIZE) break;

      logger.log(`המשך ל-batch הבא... (סה"כ עד כה: ${totalFetched})`);
    }

    await printStats(stats, logger);
    logger.ok(`=== BOT-25 סיים — עודכנו ${stats.updated} דילים | ${logger.elapsed()} ===`);

  } catch (err) {
    logger.err(`שגיאה כללית: ${err.message}`);
    stats.errors.push(err.message);
  } finally {
    stats.errors.push(...logger.errors);
    if (logId) {
      await logFinish(logId, stats, logger.errors.length > 0 ? 'error' : 'done');
    }
  }
}

// הרץ רק כשהקובץ הוא entry point (לא בייבוא מטסטים)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('bot25.mjs') || process.argv[1].endsWith('bot25')
);
if (isMain) main();
