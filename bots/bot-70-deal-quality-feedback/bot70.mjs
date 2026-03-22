// ════════════════════════════════════════════════════════════
// BOT-70 — Deal Quality Feedback
// תפקיד: מעבד feedback ממשתמשים ומעדכן ציוני דילים.
//
// לוגיקה:
//   • מביא feedback לא מעובד מ-deal_feedback
//   • מחשב Wilson score lower bound per deal
//   • מעדכן deals.score עם ציון משולב
//   • מסמן feedback כ-processed
//   • מזהה spam
//
// תדירות: כל 2 שעות (Railway cron: 0 */2 * * *)
//
// Env vars:
//   SUPABASE_URL + SUPABASE_SERVICE_KEY — ב-.env
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import supabase from './shared/supabaseClient.mjs';
import { createLogger } from './shared/logger.mjs';

const BOT_ID = 'BOT-70';
const log     = createLogger(BOT_ID);

export const FEEDBACK_WEIGHT        = 0.2;  // blend weight for feedback score
export const SPAM_THRESHOLD_COUNT   = 3;    // >3 feedbacks in 1h = spam
export const SPAM_WINDOW_MS         = 60 * 60 * 1000; // 1 hour
export const WILSON_Z               = 1.96; // 95% confidence

// ════════════════════════════════════════════════════════════
// פונקציות טהורות
// ════════════════════════════════════════════════════════════

/**
 * wilsonLowerBound — חישוב Wilson score lower bound.
 * נוסחה: lower bound של Wilson score confidence interval.
 * @param {number} positive — מספר תגובות חיוביות
 * @param {number} total    — סך הכל תגובות
 * @param {number} z        — z-score (1.96 = 95%)
 * @returns {number} 0-1
 */
export function wilsonLowerBound(positive, total, z = WILSON_Z) {
  if (total === 0) return 0;
  const phat = positive / total;
  const z2   = z * z;

  const numerator   = phat + z2 / (2 * total) - z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  const denominator = 1 + z2 / total;

  const result = numerator / denominator;
  return Math.max(0, Math.min(1, result));
}

/**
 * computeFeedbackScore — ציון feedback משולב (Wilson lower bound).
 * @param {number} upvotes
 * @param {number} downvotes
 * @returns {number} 0-1
 */
export function computeFeedbackScore(upvotes, downvotes) {
  const total = upvotes + downvotes;
  if (total === 0) return 0;
  return wilsonLowerBound(upvotes, total);
}

/**
 * classifyFeedback — מסווג ציון feedback.
 * @param {number} score — 0-1
 * @returns {'excellent'|'good'|'fair'|'poor'}
 */
export function classifyFeedback(score) {
  if (score > 0.8)  return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.4) return 'fair';
  return 'poor';
}

/**
 * computeScoreAdjustment — מחשב ציון משולב.
 * @param {number} currentScore — ציון נוכחי (0-100)
 * @param {number} feedbackScore — ציון feedback (0-1)
 * @param {number} weight — משקל של feedback (ברירת מחדל: 0.2)
 * @returns {number} ציון חדש (0-100)
 */
export function computeScoreAdjustment(currentScore, feedbackScore, weight = FEEDBACK_WEIGHT) {
  // feedbackScore is 0-1, scale to 0-100
  const feedbackScaled = feedbackScore * 100;
  return Math.round(currentScore * (1 - weight) + feedbackScaled * weight);
}

/**
 * isFeedbackSpam — האם feedback הוא spam.
 * @param {{ user_id:string, created_at:string }} feedback
 * @param {Array<{ user_id:string, created_at:string }>} userHistory
 * @returns {boolean}
 */
export function isFeedbackSpam(feedback, userHistory) {
  if (!feedback.user_id) return false;
  const windowStart = new Date(new Date(feedback.created_at).getTime() - SPAM_WINDOW_MS);

  const recentCount = userHistory.filter(h =>
    h.user_id === feedback.user_id &&
    new Date(h.created_at) >= windowStart
  ).length;

  return recentCount > SPAM_THRESHOLD_COUNT;
}

/**
 * buildFeedbackSummary — סיכום feedback לדיל.
 * @param {Array<{ feedback_type:string }>} feedbacks
 * @returns {{ total:number, upvotes:number, downvotes:number, ratio:number, score:number }}
 */
export function buildFeedbackSummary(feedbacks) {
  const upvotes   = feedbacks.filter(f => f.feedback_type === 'upvote').length;
  const downvotes = feedbacks.filter(f => f.feedback_type === 'downvote').length;
  const total     = upvotes + downvotes;
  const ratio     = total > 0 ? Math.round((upvotes / total) * 100) / 100 : 0;
  const score     = computeFeedbackScore(upvotes, downvotes);

  return {
    total,
    upvotes,
    downvotes,
    ratio,
    score: Math.round(score * 1000) / 1000, // 3 decimal places
  };
}

// ════════════════════════════════════════════════════════════
// DB operations
// ════════════════════════════════════════════════════════════

async function fetchUnprocessedFeedback() {
  const { data, error } = await supabase
    .from('deal_feedback')
    .select('id, deal_id, user_id, feedback_type, created_at, is_spam')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw new Error(`fetchUnprocessedFeedback: ${error.message}`);
  return data || [];
}

async function fetchUserFeedbackHistory(userId, since) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('deal_feedback')
    .select('user_id, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return [];
  return data || [];
}

async function fetchDealFeedbackCounts(dealId) {
  const { data, error } = await supabase
    .from('deal_feedback')
    .select('feedback_type')
    .eq('deal_id', dealId)
    .eq('is_spam', false);

  if (error) return { upvotes: 0, downvotes: 0 };

  const upvotes   = (data || []).filter(f => f.feedback_type === 'upvote').length;
  const downvotes = (data || []).filter(f => f.feedback_type === 'downvote').length;
  return { upvotes, downvotes };
}

async function fetchDealScore(dealId) {
  const { data, error } = await supabase
    .from('deals')
    .select('score')
    .eq('id', dealId)
    .maybeSingle();

  if (error || !data) return 50;
  return data.score || 50;
}

async function updateDealScore(dealId, newScore, feedbackScore, upvotes, downvotes) {
  const { error } = await supabase
    .from('deals')
    .update({
      score:          newScore,
      feedback_score: Math.round(feedbackScore * 1000) / 1000,
      upvotes,
      downvotes,
    })
    .eq('id', dealId);

  if (error) log.warn(`updateDealScore(${dealId}): ${error.message}`);
}

async function markFeedbackProcessed(ids, isSpam = false) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('deal_feedback')
    .update({ processed: true, is_spam: isSpam })
    .in('id', ids);

  if (error) log.warn(`markFeedbackProcessed: ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// bots_log helpers
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
    errors:        stats.errors || [],
  }).eq('id', id);
}

// ════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════

export async function main() {
  log.log(`BOT-70 — Deal Quality Feedback starting`);

  let logId;
  const stats = { updated: 0, spam: 0, errors: [] };

  try { logId = await logStart(); } catch (e) { log.warn(`bots_log start: ${e.message}`); }

  try {
    const feedbacks = await fetchUnprocessedFeedback();
    log.log(`Fetched ${feedbacks.length} unprocessed feedbacks`);

    if (feedbacks.length === 0) {
      log.log('Nothing to process');
      if (logId) await logFinish(logId, stats);
      return stats;
    }

    // Group by deal_id
    const byDeal = {};
    const spamIds   = [];
    const normalIds = [];

    // Spam detection pass — use window from oldest feedback
    const spamWindowStart = new Date(Date.now() - SPAM_WINDOW_MS).toISOString();

    for (const fb of feedbacks) {
      // Spam check
      const history = await fetchUserFeedbackHistory(fb.user_id, spamWindowStart);
      if (isFeedbackSpam(fb, history)) {
        spamIds.push(fb.id);
        stats.spam++;
        log.warn(`Spam detected: feedback ${fb.id} from user ${fb.user_id}`);
        continue;
      }

      normalIds.push(fb.id);
      if (!byDeal[fb.deal_id]) byDeal[fb.deal_id] = [];
      byDeal[fb.deal_id].push(fb);
    }

    // Mark spam
    if (spamIds.length > 0) {
      await markFeedbackProcessed(spamIds, true);
    }

    // Process per deal
    for (const [dealId, dealFeedbacks] of Object.entries(byDeal)) {
      // Get full counts including already-processed (for accurate Wilson score)
      const { upvotes, downvotes } = await fetchDealFeedbackCounts(dealId);
      const feedbackScore = computeFeedbackScore(upvotes, downvotes);
      const currentScore  = await fetchDealScore(dealId);
      const newScore      = computeScoreAdjustment(currentScore, feedbackScore);

      await updateDealScore(dealId, newScore, feedbackScore, upvotes, downvotes);
      stats.updated++;

      const summary = buildFeedbackSummary(dealFeedbacks);
      log.ok(`Deal ${dealId}: score ${currentScore} → ${newScore} (feedback ${Math.round(feedbackScore * 100)}%, ${summary.upvotes}↑ ${summary.downvotes}↓)`);
    }

    // Mark all non-spam as processed
    if (normalIds.length > 0) {
      await markFeedbackProcessed(normalIds, false);
    }

    log.ok(`Done — processed ${feedbacks.length} feedbacks, updated ${stats.updated} deals, flagged ${stats.spam} spam`);

  } catch (err) {
    log.err(`Fatal: ${err.message}`);
    stats.errors.push(err.message);
  }

  if (logId) await logFinish(logId, stats);
  return stats;
}

const isMain = process.argv[1]?.endsWith('bot70.mjs');
if (isMain) {
  main().catch(err => { console.error('BOT-70 crashed:', err); process.exit(1); });
}
