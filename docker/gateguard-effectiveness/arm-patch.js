'use strict';

// Copied next to each materialized hook tree; it must not require anything outside that tree.
// see docs/gateguard/question-effectiveness.md#arms

const PLACEBO_TEXT = Object.freeze({
  'placebo-goal': 'Restate in one sentence what this change is meant to achieve',
  'placebo-steps': 'Describe the steps you will take to make this change',
  'placebo-assumptions': 'State any assumptions you are making about this change',
  'placebo-done': 'Describe how you will know the change is complete'
});

const PLACEBO_PHRASES = Object.freeze({
  'placebo-goal': 'the goal of the change',
  'placebo-steps': 'your planned steps',
  'placebo-assumptions': 'your assumptions',
  'placebo-done': 'how you will know it is done'
});

const PLACEBO_IDS = Object.keys(PLACEBO_TEXT);
const KEPT_ID = 'quote-instruction';
const VERBATIM_PHRASE = "the user's verbatim instruction";

function joinPhrases(phrases) {
  if (phrases.length <= 2) return phrases.join(' and ');
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

/** Question ids for an arm, given the ids the unmodified gate would ask. */
function armQuestionIds(arm, ids) {
  if (arm.placebo) {
    let next = 0;
    return ids.map(id => (id === KEPT_ID ? id : PLACEBO_IDS[next++ % PLACEBO_IDS.length]));
  }
  const dropped = new Set(arm.drop || []);
  return ids.filter(id => !dropped.has(id));
}

/** Replaces the question table lookups of a loaded gateguard-target-class module for one arm. */
function applyArm(arm, targetClass) {
  if (!arm || (!arm.placebo && !(arm.drop && arm.drop.length))) return targetClass;
  const originalIds = targetClass.questionIdsFor;
  const originalText = targetClass.questionText;
  const originalPhrase = targetClass.condensedQuestionPhrase;
  const originalHint = targetClass.condensedHintFor;
  const questionIdsFor = (cls, isWrite, profile) => armQuestionIds(arm, originalIds(cls, isWrite, profile));
  const questionText = id => (Object.hasOwn(PLACEBO_TEXT, id) ? PLACEBO_TEXT[id] : originalText(id));
  const phraseFor = id => {
    if (Object.hasOwn(PLACEBO_PHRASES, id)) return PLACEBO_PHRASES[id];
    if (id === KEPT_ID) return VERBATIM_PHRASE;
    return originalPhrase(id) || originalText(id).replace(/ \(search the tree.*\)$/, '').replace(/^\w/, c => c.toLowerCase());
  };
  const condensedHintFor = (cls, isWrite, profile) => {
    const ids = questionIdsFor(cls, isWrite, profile);
    if (ids.join('\n') === originalIds(cls, isWrite, profile).join('\n')) return originalHint(cls, isWrite, profile);
    return `briefly state ${joinPhrases(ids.map(phraseFor).filter(Boolean))}, then retry.`;
  };
  Object.assign(targetClass, { questionIdsFor, questionText, condensedHintFor });
  return targetClass;
}

module.exports = { PLACEBO_TEXT, PLACEBO_PHRASES, armQuestionIds, applyArm };
