// ════════════════════════════════════════════════════════════
// BOT-61 — Legal Validator
// תפקיד: מאמת שהדילים עומדים בדרישות חוקיות / FTC.
//         בודק גילוי אפיליאציה, דיוק מחיר, הגבלות גיאוגרפיות.
//
// לוגיקה:
//   1. שולף דילים פעילים (batch 200)
//   2. מפעיל validateDealCompliance על כל דיל
//   3. מעדכן deals.compliance_status = 'ok'|'warning'|'flagged'
//   4. שומר בעיות ב-compliance_log
//   5. כותב ל-bots_log
//
// תדירות: פעם ביום 04:00 UTC (Railway cron: 0 4 * * *)
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// ════════════════════════════════════════════════════════════

import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID       = 'BOT-61';
const BATCH_SIZE   = 200;

const log = createLogger(BOT_ID);

// ════════════════════════════════════════════════════════════
// פונקציות טהורות — exported
// ════════════════════════════════════════════════════════════

/**
 * DISCLOSURE_TERMS — מילות מפתח לגילוי אפיליאציה בכותרת/תיאור.
 */
const DISCLOSURE_TERMS = [
  'affiliate', 'sponsored', 'ad', 'paid', 'commission',
  'partner', '#ad', '#sponsored', 'disclosure',
];

/**
 * hasAffiliateDisclosure — בודק אם לדיל יש גילוי אפיליאציה.
 * מחזיר true אם affiliate_network מוגדר, או אם title/description
 * מכיל אחת ממילות הגילוי.
 * @param {object} deal
 * @returns {boolean}
 */
export function hasAffiliateDisclosure(deal) {
  if (!deal) return false;

  // אם יש רשת אפיליאציה — הדיל מגיע מרשת ולכן גילוי קיים
  if (deal.affiliate_network && deal.affiliate_network.trim() !== '') return true;

  // בדוק טקסט ב-title ו-description
  const textToCheck = [
    deal.title || '',
    deal.description || '',
  ].join(' ').toLowerCase();

  return DISCLOSURE_TERMS.some(term => textToCheck.includes(term.toLowerCase()));
}

/**
 * isPriceAccurate — מאמת שהמחיר המוזל תואם את האחוז המצוין.
 * לוגיקה: discountedPrice = originalPrice * (1 - discount/100) ± 2%
 * @param {number} originalPrice
 * @param {number} discountedPrice
 * @param {number} discount  — אחוז הנחה (0-100)
 * @returns {boolean}
 */
export function isPriceAccurate(originalPrice, discountedPrice, discount) {
  if (
    typeof originalPrice  !== 'number' || originalPrice  <= 0 ||
    typeof discountedPrice !== 'number' || discountedPrice < 0 ||
    typeof discount       !== 'number' || discount < 0 || discount > 100
  ) return false;

  const expected      = originalPrice * (1 - discount / 100);
  const tolerance     = originalPrice * 0.02; // 2% tolerance
  const diff          = Math.abs(discountedPrice - expected);

  return diff <= tolerance;
}

/**
 * validateDealCompliance — מחזיר { valid, issues[] } לדיל נתון.
 * @param {object} deal
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateDealCompliance(deal) {
  const issues = [];

  if (!deal) return { valid: false, issues: ['deal is null'] };

  // בדיקת גילוי אפיליאציה
  if (!hasAffiliateDisclosure(deal)) {
    issues.push('missing_affiliate_disclosure');
  }

  // בדיקת דיוק מחיר (רק אם יש מספיק נתונים)
  if (
    deal.original_price != null &&
    deal.price         != null &&
    deal.discount      != null
  ) {
    if (!isPriceAccurate(
      Number(deal.original_price),
      Number(deal.price),
      Number(deal.discount)
    )) {
      issues.push('inaccurate_price_claim');
    }
  }

  // בדיקת כותרת לאחר sanitize
  if (deal.title) {
    const sanitized = sanitizeDealTitle(deal.title);
    if (sanitized !== deal.title) {
      issues.push('misleading_title_terms');
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * isCountryRestricted — בודק אם הדיל מוגבל למדינה מסוימת.
 * @param {object} deal  — deal.geo_restrictions: string[] | null
 * @param {string} country  — קוד מדינה, למשל 'US'
 * @returns {boolean}
 */
export function isCountryRestricted(deal, country) {
  if (!deal || !deal.geo_restrictions) return false;
  if (!Array.isArray(deal.geo_restrictions)) return false;
  if (deal.geo_restrictions.length === 0) return false;

  return deal.geo_restrictions
    .map(c => c.toUpperCase())
    .includes(country.toUpperCase());
}

/**
 * buildComplianceReport — בונה דוח סיכום עבור רשימת דילים.
 * @param {object[]} deals
 * @returns {{ total: number, compliant: number, issues: { dealId: string, issue: string }[] }}
 */
export function buildComplianceReport(deals) {
  if (!Array.isArray(deals)) return { total: 0, compliant: 0, issues: [] };

  const allIssues = [];
  let compliant = 0;

  for (const deal of deals) {
    const result = validateDealCompliance(deal);
    if (result.valid) {
      compliant++;
    } else {
      for (const issue of result.issues) {
        allIssues.push({ dealId: deal.id, issue });
      }
    }
  }

  return {
    total:     deals.length,
    compliant,
    issues:    allIssues,
  };
}

/**
 * MISLEADING_PATTERNS — תבניות regex למונחים מטעים.
 */
const MISLEADING_PATTERNS = [
  /free\*/gi,            // 'free*' עם כוכבית (כלומר לא ממש חינם)
  /guaranteed\b/gi,      // 'guaranteed' — לא מדויק בסיילים
  /unlimited\*/gi,       // 'unlimited*' עם כוכבית
];

/**
 * sanitizeDealTitle — מסיר מונחים מטעים מכותרת הדיל.
 * @param {string} title
 * @returns {string}
 */
export function sanitizeDealTitle(title) {
  if (!title || typeof title !== 'string') return title;

  let sanitized = title;
  for (const pattern of MISLEADING_PATTERNS) {
    sanitized = sanitized.replace(pattern, '').replace(/\s{2,}/g, ' ').trim();
  }

  return sanitized;
}

// ════════════════════════════════════════════════════════════
// helpers לסיווג severity
// ════════════════════════════════════════════════════════════

function issueToSeverity(issueType) {
  const critical = ['inaccurate_price_claim'];
  const warning  = ['missing_affiliate_disclosure', 'misleading_title_terms'];
  if (critical.includes(issueType)) return 'critical';
  if (warning.includes(issueType))  return 'warning';
  return 'warning';
}

function issuesToStatus(issues) {
  if (issues.length === 0) return 'ok';
  const hasCritical = issues.some(i => issueToSeverity(i) === 'critical');
  return hasCritical ? 'flagged' : 'warning';
}

// ════════════════════════════════════════════════════════════
// bots_log
// ════════════════════════════════════════════════════════════

async function logStart() {
  const { data } = await supabase
    .from('bots_log')
    .insert({ bot_id: BOT_ID, status: 'running' })
    .select('id').single();
  return data?.id;
}

async function logFinish(id, stats) {
  await supabase.from('bots_log').update({
    finished_at:   new Date().toISOString(),
    status:        stats.errors?.length > 0 ? 'error' : 'done',
    deals_updated: stats.updated || 0,
    errors:        stats.errors  || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// DB helpers
// ════════════════════════════════════════════════════════════

async function fetchActiveDeals(offset = 0) {
  const { data, error } = await supabase
    .from('deals')
    .select(`
      id,
      title,
      description,
      price,
      original_price,
      discount,
      affiliate_network,
      store_name,
      geo_restrictions,
      status
    `)
    .eq('status', 'active')
    .range(offset, offset + BATCH_SIZE - 1)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`fetchActiveDeals: ${error.message}`);
  return data || [];
}

async function updateDealCompliance(dealId, status) {
  const { error } = await supabase
    .from('deals')
    .update({
      compliance_status:      status,
      compliance_checked_at:  new Date().toISOString(),
    })
    .eq('id', dealId);

  if (error) throw new Error(`updateDealCompliance(${dealId}): ${error.message}`);
}

async function insertComplianceLogs(entries) {
  if (!entries.length) return;

  const { error } = await supabase
    .from('compliance_log')
    .insert(entries);

  if (error) throw new Error(`insertComplianceLogs: ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`🚀 ${BOT_ID} — Legal Validator`);

  let logId;
  const stats = { updated: 0, flagged: 0, warned: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log: ${e.message}`); }

  try {
    let offset  = 0;
    let fetched = 0;

    do {
      const deals = await fetchActiveDeals(offset);
      fetched = deals.length;
      log.log(`📦 Batch offset=${offset}: ${fetched} דילים`);

      for (const deal of deals) {
        try {
          const { valid, issues } = validateDealCompliance(deal);
          const status = issuesToStatus(issues);

          await updateDealCompliance(deal.id, status);

          if (issues.length > 0) {
            const logEntries = issues.map(issueType => ({
              deal_id:      deal.id,
              issue_type:   issueType,
              issue_detail: `Detected by ${BOT_ID}`,
              severity:     issueToSeverity(issueType),
              resolved:     false,
            }));
            await insertComplianceLogs(logEntries);

            if (status === 'flagged') stats.flagged++;
            else                      stats.warned++;
          }

          stats.updated++;
        } catch (err) {
          log.warn(`⚠️ Deal ${deal.id}: ${err.message}`);
          stats.errors.push(`deal ${deal.id}: ${err.message}`);
        }
      }

      offset += BATCH_SIZE;
    } while (fetched === BATCH_SIZE);

    log.log(`✅ סיום: ${stats.updated} נבדקו, ${stats.flagged} flagged, ${stats.warned} warning`);

  } catch (err) {
    log.err(`שגיאה: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot61.mjs');
if (isMain) {
  main().catch(err => { console.error('❌ BOT-61 crashed:', err); process.exit(1); });
}
