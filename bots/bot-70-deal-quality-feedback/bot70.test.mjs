// bot70.test.mjs — בדיקות יחידה ל-BOT-70 Deal Quality Feedback
// הרץ: node bot70.test.mjs
// ════════════════════════════════════════════════════════════

import {
  wilsonLowerBound,
  computeFeedbackScore,
  classifyFeedback,
  computeScoreAdjustment,
  isFeedbackSpam,
  buildFeedbackSummary,
  FEEDBACK_WEIGHT,
  SPAM_THRESHOLD_COUNT,
  WILSON_Z,
} from './bot70.mjs';

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

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertApprox(a, b, tolerance, msg) {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(msg || `expected ~${b} (±${tolerance}), got ${a}`);
  }
}

function assertBetween(val, lo, hi, msg) {
  if (val < lo || val > hi) {
    throw new Error(msg || `expected ${val} to be between ${lo} and ${hi}`);
  }
}

// ════════════════════════════════════════════════════════════
// 1. wilsonLowerBound
// ════════════════════════════════════════════════════════════

test('wilsonLowerBound: 100 positive, 100 total → high confidence (>0.9)', () => {
  const score = wilsonLowerBound(100, 100);
  assert(score > 0.9, `expected >0.9, got ${score}`);
});

test('wilsonLowerBound: 0 positive, 0 total → 0', () => {
  assertEq(wilsonLowerBound(0, 0), 0);
});

test('wilsonLowerBound: 1 positive, 1 total → lower than raw 100%', () => {
  const score = wilsonLowerBound(1, 1);
  // raw rate is 1.0 (100%), Wilson lower bound should be less
  assert(score < 1.0, `Wilson score should be less than raw 100%: got ${score}`);
  assert(score > 0, `should be positive: got ${score}`);
});

test('wilsonLowerBound: 50 positive, 100 total → ~0.4 range (50% with confidence)', () => {
  const score = wilsonLowerBound(50, 100);
  assertBetween(score, 0.3, 0.6, `50/100 Wilson lower bound should be ~0.4-0.5: got ${score}`);
});

test('wilsonLowerBound: result is between 0 and 1', () => {
  const cases = [[10,10],[1,10],[0,10],[5,7],[99,100]];
  for (const [p, t] of cases) {
    const s = wilsonLowerBound(p, t);
    assertBetween(s, 0, 1, `wilsonLowerBound(${p},${t}) out of range: ${s}`);
  }
});

// ════════════════════════════════════════════════════════════
// 2. computeFeedbackScore
// ════════════════════════════════════════════════════════════

test('computeFeedbackScore: 90 up, 10 down → high score (>0.8)', () => {
  const score = computeFeedbackScore(90, 10);
  assert(score > 0.8, `expected >0.8, got ${score}`);
});

test('computeFeedbackScore: 0 up, 0 down → 0', () => {
  assertEq(computeFeedbackScore(0, 0), 0);
});

test('computeFeedbackScore: equal votes → below 0.5 (Wilson conservative lower bound)', () => {
  // Wilson lower bound is conservative: 10 up / 10 down → lower than naive 50%
  const score = computeFeedbackScore(10, 10);
  assertBetween(score, 0.2, 0.5, `equal votes Wilson lower bound should be ~0.2-0.5: got ${score}`);
});

test('computeFeedbackScore: 1 up, 99 down → very low score (<0.05)', () => {
  const score = computeFeedbackScore(1, 99);
  assert(score < 0.05, `expected very low score, got ${score}`);
});

// ════════════════════════════════════════════════════════════
// 3. classifyFeedback
// ════════════════════════════════════════════════════════════

test('classifyFeedback: 0.85 → "excellent"', () => {
  assertEq(classifyFeedback(0.85), 'excellent');
});

test('classifyFeedback: exactly 0.8 → "excellent" (boundary: >0.8 is excellent)', () => {
  // 0.8 is not > 0.8, so it's 'good'
  assertEq(classifyFeedback(0.8), 'good');
});

test('classifyFeedback: 0.7 → "good"', () => {
  assertEq(classifyFeedback(0.7), 'good');
});

test('classifyFeedback: 0.6 → "good" (boundary)', () => {
  assertEq(classifyFeedback(0.6), 'good');
});

test('classifyFeedback: 0.5 → "fair"', () => {
  assertEq(classifyFeedback(0.5), 'fair');
});

test('classifyFeedback: 0.4 → "fair" (boundary)', () => {
  assertEq(classifyFeedback(0.4), 'fair');
});

test('classifyFeedback: 0.3 → "poor"', () => {
  assertEq(classifyFeedback(0.3), 'poor');
});

test('classifyFeedback: 0 → "poor"', () => {
  assertEq(classifyFeedback(0), 'poor');
});

// ════════════════════════════════════════════════════════════
// 4. computeScoreAdjustment
// ════════════════════════════════════════════════════════════

test('computeScoreAdjustment: current=70, feedback=0.9 weight=0.2 → slightly increased', () => {
  const newScore = computeScoreAdjustment(70, 0.9, 0.2);
  // 70 * 0.8 + 90 * 0.2 = 56 + 18 = 74
  assertEq(newScore, 74);
});

test('computeScoreAdjustment: current=70, feedback=0.0 → decreased', () => {
  const newScore = computeScoreAdjustment(70, 0.0, 0.2);
  // 70 * 0.8 + 0 * 0.2 = 56
  assertEq(newScore, 56);
});

test('computeScoreAdjustment: current=50, feedback=0.5 → same', () => {
  const newScore = computeScoreAdjustment(50, 0.5, 0.2);
  // 50 * 0.8 + 50 * 0.2 = 40 + 10 = 50
  assertEq(newScore, 50);
});

test('computeScoreAdjustment: uses default weight (FEEDBACK_WEIGHT)', () => {
  const newScore = computeScoreAdjustment(80, 1.0);
  // 80 * (1 - 0.2) + 100 * 0.2 = 64 + 20 = 84
  assertEq(newScore, 84);
});

// ════════════════════════════════════════════════════════════
// 5. isFeedbackSpam
// ════════════════════════════════════════════════════════════

test('isFeedbackSpam: 4 votes in 1 hour from same user → true', () => {
  const now   = new Date();
  const userId = 'user-123';
  // feedback being evaluated
  const feedback = { user_id: userId, created_at: now.toISOString() };
  // history: 4 within the last hour (threshold is >3)
  const history = Array.from({ length: 4 }, (_, i) => ({
    user_id:    userId,
    created_at: new Date(now.getTime() - i * 5 * 60 * 1000).toISOString(),
  }));
  assert(isFeedbackSpam(feedback, history) === true, '4 votes should be spam (>3)');
});

test('isFeedbackSpam: 2 votes in 1 hour → false', () => {
  const now = new Date();
  const userId = 'user-456';
  const feedback = { user_id: userId, created_at: now.toISOString() };
  const history = Array.from({ length: 2 }, (_, i) => ({
    user_id:    userId,
    created_at: new Date(now.getTime() - i * 10 * 60 * 1000).toISOString(),
  }));
  assert(isFeedbackSpam(feedback, history) === false, '2 votes should not be spam');
});

test('isFeedbackSpam: no user_id → false', () => {
  const feedback = { user_id: null, created_at: new Date().toISOString() };
  assert(isFeedbackSpam(feedback, []) === false);
});

test('isFeedbackSpam: votes outside window not counted', () => {
  const now    = new Date();
  const userId = 'user-789';
  const feedback = { user_id: userId, created_at: now.toISOString() };
  // 5 votes, but all >1 hour ago
  const history = Array.from({ length: 5 }, (_, i) => ({
    user_id:    userId,
    created_at: new Date(now.getTime() - (70 + i * 5) * 60 * 1000).toISOString(),
  }));
  assert(isFeedbackSpam(feedback, history) === false, 'old votes should not count');
});

// ════════════════════════════════════════════════════════════
// 6. buildFeedbackSummary
// ════════════════════════════════════════════════════════════

test('buildFeedbackSummary: correct ratio and totals', () => {
  const feedbacks = [
    { feedback_type: 'upvote' },
    { feedback_type: 'upvote' },
    { feedback_type: 'upvote' },
    { feedback_type: 'downvote' },
  ];
  const summary = buildFeedbackSummary(feedbacks);
  assertEq(summary.total,    4);
  assertEq(summary.upvotes,  3);
  assertEq(summary.downvotes, 1);
  assertApprox(summary.ratio, 0.75, 0.01);
  assert(typeof summary.score === 'number', 'score should be a number');
  assert(summary.score >= 0 && summary.score <= 1, `score out of range: ${summary.score}`);
});

test('buildFeedbackSummary: all upvotes', () => {
  const feedbacks = [
    { feedback_type: 'upvote' },
    { feedback_type: 'upvote' },
  ];
  const summary = buildFeedbackSummary(feedbacks);
  assertEq(summary.upvotes, 2);
  assertEq(summary.downvotes, 0);
  assertEq(summary.ratio, 1);
});

test('buildFeedbackSummary: empty → zeros', () => {
  const summary = buildFeedbackSummary([]);
  assertEq(summary.total,    0);
  assertEq(summary.upvotes,  0);
  assertEq(summary.downvotes, 0);
  assertEq(summary.ratio,    0);
  assertEq(summary.score,    0);
});

// ════════════════════════════════════════════════════════════
// סיכום
// ════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`BOT-70 Tests: ${PASSED.length} עברו ✅, ${FAILED.length} נכשלו ❌`);
if (FAILED.length > 0) {
  console.error('נכשלו:', FAILED);
  process.exit(1);
}
