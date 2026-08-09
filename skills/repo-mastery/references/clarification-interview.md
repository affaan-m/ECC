# Clarification Interview — Decision-Clarifying Confirmation (absorbed from the grilling skill)

> **Read in**: Phase 2. This protocol turns the open confirmation steps (Mission + course-map sign-off) into a decision-tree clarification: every implicit assumption made explicit, until you and the learner share the same understanding. Absorbed from mattpocock's `grilling` skill (user entry `grill-me`); see `ADOPTION.md` §5.

## 1. Purpose

Phase 2 confirmation is a decision, not a formality. The goal is not to reach agreement quickly; it is to surface every implicit choice and make it explicit, so nothing important is silently assumed. The output is a confirmed `MISSION.md` + `course-map.json` the learner actually owns.

## 2. Decision-tree walk

Treat the confirmation as a tree of decisions, resolving dependencies one by one — a parent decision settled before the choices that hang off it:

- Root (parent): **Mission** — why does the learner want to master this repo? (use it / modify it / explain it in interviews / borrow its design / …)
- Branch: **module-level decisions** — keep / adjust / drop each candidate module; adjust granularity.
- Leaf: **parameter decisions** — each module's `pass_threshold` (default 0.7), optional hands-on labs.

An early answer reshapes which questions come next. Do not fire questions in parallel; descend in dependency order.

## 3. One question at a time

Ask one question, wait for the answer, then continue. Asking multiple questions at once is bewildering — the learner cannot converge on a decision tree if every branch is presented simultaneously.

## 4. Facts vs decisions (information retrieval)

If a *fact* can be found by exploring the environment (source code, README, call chains, `course-map.json` evidence paths), look it up rather than asking. The *decisions* are the learner's — put each one to them and wait.

## 5. Recommended answers (decision questions only)

Every decision question comes with the tutor's own recommended answer, grounded in repo evidence — so the learner reacts to a proposal, not a blank prompt.

**Boundary — never for assessment questions.** The recommended-answer habit applies only to decision questions (Mission, module choices, thresholds, "what next"). It must **never** leak into Phase 3 assessment (quiz / Feynman recital): `progress.json.pending_question.expected_answer` is the only place the answer lives, and it never round-trips to the learner (see `mastery-policy.md` §7 and `gotchas.md`).

## 6. Shared-understanding gate

When the confirmation is complete, summarize the settled decisions back and confirm before proceeding — then write them to `MISSION.md` and `course-map.json`. Learning starts only after the learner approves. If the Mission changes mid-course, update `MISSION.md` and write a learning record.

## Difference from grilling

`grilling` is stateless — it writes nothing and leaves no artifact. Repo-Mastery's clarification is stateful by design: the settled decisions land in `.learning/MISSION.md` and `course-map.json`, because they ground every later teaching decision.
