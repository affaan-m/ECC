'use strict';

/**
 * Decide when to ask a working install for feedback.
 *
 * ECC only asked for feedback when something broke or when someone left, so the
 * project heard from failures and churn but never from the sessions that went
 * well. This module picks a small number of success milestones and makes sure
 * each one is asked at most once per install.
 *
 * Pure logic only: no file access, no network, no output.
 */

const { FEEDBACK_ROUTES } = require('./feedback-links');

const STATE_VERSION = 'ecc.success-feedback.v1';
const OPT_OUT_ENV = 'ECC_NO_FEEDBACK_PROMPT';

/**
 * Session counts that earn one prompt. Early enough to catch a first
 * impression, late enough to catch a settled opinion.
 */
const MILESTONES = Object.freeze([3, 25]);

const MILESTONE_ASKS = Object.freeze({
  3: 'You have run three ECC sessions. What is working, and what is not?',
  25: 'Twenty-five sessions in. What would you change about ECC now?'
});

function emptyState() {
  return Object.freeze({ version: STATE_VERSION, prompted: [] });
}

/**
 * Normalise whatever was on disk into a state object we can reason about.
 * Anything unreadable or from another version restarts from empty rather than
 * throwing, because this never matters enough to interrupt a session.
 */
function normalizeState(value) {
  if (!value || typeof value !== 'object' || value.version !== STATE_VERSION) {
    return emptyState();
  }

  const prompted = Array.isArray(value.prompted) ? value.prompted.filter(entry => Number.isInteger(entry)) : [];

  return Object.freeze({ version: STATE_VERSION, prompted: Object.freeze([...prompted]) });
}

function isOptedOut(env = process.env) {
  const flag = env[OPT_OUT_ENV];
  return typeof flag === 'string' && flag.trim() !== '' && flag.trim() !== '0';
}

/**
 * The milestone this session should ask about, or null when it should stay
 * quiet.
 *
 * Only the highest reached milestone can fire, and anything at or below a
 * milestone already asked is dropped for good. Without that second rule an
 * install that starts counting late would ask the late question first and then
 * come back weeks later with the early one.
 */
function selectMilestone(sessionCount, state) {
  if (!Number.isInteger(sessionCount) || sessionCount < 1) {
    return null;
  }

  const { prompted } = normalizeState(state);
  const highestPrompted = prompted.length > 0 ? Math.max(...prompted) : 0;
  const pending = MILESTONES.filter(milestone => sessionCount >= milestone).filter(milestone => milestone > highestPrompted);

  return pending.length > 0 ? Math.max(...pending) : null;
}

function recordMilestone(state, milestone) {
  const { prompted } = normalizeState(state);
  if (prompted.includes(milestone)) {
    return normalizeState(state);
  }

  return Object.freeze({
    version: STATE_VERSION,
    prompted: Object.freeze([...prompted, milestone].sort((a, b) => a - b))
  });
}

/**
 * The lines shown to the user. Three lines, one link, no diagnostics, and a
 * visible way to turn it off.
 */
function successFeedbackLines(milestone) {
  return [
    `[ECC] ${MILESTONE_ASKS[milestone] || MILESTONE_ASKS[MILESTONES[0]]}`,
    `[ECC] 20-second form (public GitHub issue): ${FEEDBACK_ROUTES.feedback}`,
    `[ECC] Nothing is uploaded. Set ${OPT_OUT_ENV}=1 to never see this again.`
  ];
}

module.exports = {
  MILESTONES,
  OPT_OUT_ENV,
  STATE_VERSION,
  emptyState,
  isOptedOut,
  normalizeState,
  recordMilestone,
  selectMilestone,
  successFeedbackLines
};
