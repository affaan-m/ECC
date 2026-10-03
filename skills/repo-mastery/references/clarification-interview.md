# Clarification Interview — Value Brief + Decision-Clarifying Confirmation (absorbed from the grilling skill)

> **Read in**: Phase 2. This protocol turns the open confirmation steps (Mission + course-map sign-off) into a decision-tree clarification: every implicit assumption made explicit, until you and the learner share the same understanding. Absorbed from mattpocock's `grilling` skill (user entry `grill-me`); see `ADOPTION.md` §5.

## 1. Purpose

Phase 2 confirmation is a decision, not a formality. The goal is not to reach agreement quickly; it is to surface every implicit choice and make it explicit, so nothing important is silently assumed. The output is a confirmed `MISSION.md` + `course-map.json` the learner actually owns.

## 0. Value brief first (what this repo can teach, and why it stands out)

Before any decision question, give the learner the **value brief** — the raw
material the whole interview reacts to (learner field feedback: clarify what a
project offers and what makes it better than peers *before* deciding what to
study). Two parts, both grounded in the Phase 1 pre-scan:

1. **Teaching-capability inventory (what this repo can teach)** — list the
   capability dimensions the course can cover: build/usage, architecture
   mental model, key implementations, design tradeoffs, transferable skills.
   Make it a menu the learner can pick from.
2. **Differentiation (what makes it stand out vs peers)** — read from
   `.learning/positioning.md` (the sourced comparison matrix produced by
   `positioning-brief.md`, Phase 2), **never improvised on the spot**. Pick
   2–3 matrix rows that fit the learner's direction (e.g. for DeepTutor vs
   other tutor platforms: agent-native single loop + multi-engine RAG +
   three-layer memory). Unsourced peer claims are marked "facts to verify", never presented
   as fact.

Present this as a proposal, then let the interview locate which dimension the
learner actually cares about. The settled value positioning is written into
`.learning/MISSION.md` (a "Value positioning" section) and drives how the
course map is pruned.

**Two-pass production (see `positioning-brief.md`)** — the matrix is drafted
*before* the Mission interview (generalized peer rows), then pruned/deepened
*after* the Mission is settled toward what it cares about. So the value brief's
differentiation can be sharpened between first draft and confirmed Mission; the
full matrix never leaves `positioning.md`, only 2–4 rows surface here.

## 2. Decision-tree walk — layered density

Treat the confirmation as a tree of decisions, resolving dependencies one by one. **Depth vs breadth is layered**: the Mission root keeps the one-at-a-time decision-tree interview (it grounds the whole course); the map-level branches are confirmed in **one batch** (see §3).

- Root (parent): **Value positioning + Mission** — from the value brief, which dimension matters to the learner, and why do they want to master this repo? (use it / modify it / explain it in interviews / borrow its design / …) **Asked one at a time** — the Mission shapes which module questions matter.
- Branch: **module-level decisions** — present the **full candidate list at once**, each module with the tutor's recommended keep/adjust/drop, and take the user's adjustments in **one reply**; follow up (one at a time) **only on modules the user adjusted**. Granularity tweaks ride along with the affected module.
- Leaf: **parameter decisions** — `pass_threshold` **defaults to 0.7 for all modules**; only asked/adjusted on explicit request (e.g. "make everything harder / this module easier"). Optional hands-on labs are offered, not interrogated.

An early answer reshapes which questions come next. Do not fire the Mission tree in parallel; descend in dependency order.

## 3. Layered density: one at a time vs batch

- **Mission decision tree: one question at a time.** Ask, wait, continue. Firing the whole Mission tree at once is bewildering and the learner cannot converge.
- **Course-map confirmation: one batch.** Present the full module list with recommendations and take all adjustments in a single reply ("keep m1 m2 m3, drop m4, add a hands-on point to m2"). Only the modules the user touched get follow-up questions (one at a time). Thresholds stay at the 0.7 default unless the user asks to change them.

The learner chooses the density, not the tutor: a user who wants depth can react module by module; a user who wants speed replies once. Never force the slow path on a user who is converging fast, and never batch the Mission root — it is the one question whose answer reshapes everything.

## 4. Facts vs decisions (information retrieval)

If a *fact* can be found by exploring the environment (source code, README, call chains, `course-map.json` evidence paths), look it up rather than asking. The *decisions* are the learner's — put each one to them and wait.

## 5. Recommended answers (decision questions only)

Every decision question comes with the tutor's own recommended answer, grounded in repo evidence — so the learner reacts to a proposal, not a blank prompt.

**Boundary — recommended answers stay with decision questions.** The
recommended-answer habit of *this interview* applies only to decision questions
(Mission, module choices, thresholds, "what next"). Phase 3's reference answer
is a different thing: in learning it is the material the learner *reacts to* —
shown right after explaining a point (concept/design), or right after answering
a graded procedure question (self-check). The one place the answer is still
withheld *before* the learner acts is a **graded procedure question**:
`progress.json.pending_question.expected_answer` stays server-side until the
user answers, then is shown for self-check (see `session-flow.md` §2–4 and
`mastery-policy.md` §7).

## 6. Shared-understanding gate

When the confirmation is complete, summarize the settled decisions back and confirm before proceeding — then write them to `MISSION.md` and `course-map.json`. Learning starts only after the learner approves. If the Mission changes mid-course, update `MISSION.md` and write a learning record.

## Difference from grilling

`grilling` is stateless — it writes nothing and leaves no artifact. Repo-Mastery's clarification is stateful by design: the settled decisions land in `.learning/MISSION.md` and `course-map.json`, because they ground every later teaching decision.
