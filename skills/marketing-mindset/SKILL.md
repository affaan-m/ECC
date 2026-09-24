---
name: marketing-mindset
description: Use when a marketing, growth, or client-acquisition decision has to be judged rather than produced — whether to do X to get Y, which channel to keep or kill, how much traffic a test needs before its result counts, where to get the first customers, how to read competitors, how to price or position an offer, or how to argue for paid work honestly. This is the decision layer that governs marketing work, not an artifact producer; reach for `marketing-campaign` when the deliverable is actual copy, sequences, or a launch plan.
metadata:
  origin: ECC
---

# Marketing Mindset

The operating layer that decides what marketing work is worth doing, what a result is allowed to
mean, and when to stop. It produces judgments — keep or kill, now or later, ship or wait, yes or no —
rather than copy, layouts, or campaigns.

**This skill is the decision layer, not the artifact layer.** Adjacent ECC skills produce the
artifacts: `market-research` gathers competitor and market evidence, `marketing-campaign`
orchestrates multi-channel execution, `content-engine` produces platform-native content,
`article-writing` and `brand-voice` shape prose, `seo` handles on-page structure, `growth-log`
captures what was learned. This skill answers the question those skills assume is already answered:
*should this happen at all, and what would prove it right or wrong?* Load it before them, and keep
it loaded while their output is being weighed.

## When to Activate

- The user asks whether doing X will get them Y — evaluate the hypothesis, not just the task.
- The user has a test running and wants to know if the result means anything yet.
- The user wants to kill a channel, cut a campaign, or decide what to scale.
- The user is choosing between channels, budgets, or outreach tactics for a product with few or
  zero customers.
- The user asks where to get the first customers, or asks for an offer, positioning, or pricing
  judgment.
- The user asks for honest feedback on a marketing plan, pitch, or claim before it ships.
- Any applied work on finding and winning clients on the internet — mostly B2B, some SaaS.
- The user is about to spend money on marketing and has not yet proven any channel by hand.

## Core Stance

- **Result over process.** The only thing that counts is movement toward the outcome on the horizon.
- **Be useful in months, not years.** Resources are limited; advice that pays off in two years is
  not advice, it is a wish.
- **Honest feedback over agreeable feedback.** Tell the user the straight answer, including when the
  answer is that nothing worked.

## The Client Is Client #0

The product's first user has to be the person who built it. The cheapest way to see the future and
predict whether a product wins is for the founder to run their own product on their own problem.
Until that has happened, every downstream metric is measuring an untested assumption.

Before proposing any acquisition plan, establish the answer to one gate question: *are you using
this yourself yet?* If the answer is no, the highest-yield marketing task is not outreach — it is
getting the founder through their own product once, because that produces the raw material
(positioning, objections, wording) that outreach needs.

## Principle 1 — Marketing Is an Exchange

Marketing is an exchange. Every action must trade for something: money, qualified prospects, a
realistic chance to earn, or a capability that is usable immediately. An action that trades for
nothing is not marketing, it is a donation.

Where this bites in practice:

- "Do it for the portfolio" is zero exchange. Name the portfolio payoff, or decline.
- Undocumented learning is unpaid labour. Time spent acquiring a skill is working time — record it
  and price it at the real rate before agreeing to it.
- If the user asks for an asset or a channel that the exchange check fails, say so out loud, with
  the arithmetic. The user already agrees with the exchange logic; they usually have not converted
  it into a number yet. Hand them the number.

When an exchange is thin but real, keep the work and renegotiate the scope — do not silently absorb
the cost.

## Principle 2 — The Three-Month Horizon

Evaluate every idea on a three-month window. Anyone proposing a two-year marketing cycle is either
selling something or has never shipped one. Planning cycles are three months:

- Month 1 — the by-hand channel proves or fails.
- Month 2 — the channel that showed signal gets the same treatment at volume.
- Month 3 — decide: scale, replace, or stop.

An idea that cannot produce a readable signal inside that window is out of scope for this skill.
That does not always mean discard it — it means it does not belong in the current plan.

## Principle 3 — No Hypothesis Without a Test It Can Fail

Every marketing hypothesis must ship with the test attached, and that test must be runnable by
anyone on the team — a developer who is doing marketing, or a marketer who wants things to work —
without a specialist and without weeks of setup.

Three rules make a test readable:

1. One variable changes. One.
2. The test action is executable today, by one person, with tools already connected.
3. The volume was declared *before* the test ran, not after the result came in.

### Pre-declared Test Volume Floors

Judge a test only at or above these floors. Below them, the result is noise dressed as a verdict.

| Test | Minimum per variant | Judge after | Notes |
|------|--------------------|-------------|-------|
| Cold email reply test | ~1,500–2,000 sends per variant | The floor is met, not a date | Sends, not opens. Opens are a deliverability artefact. |
| Subject-line test | 100–500 per version | The floor is met | Reply or click decides it; open rate alone does not. |
| Landing page smoke test | 100–200 visitors | The floor is met | Measure the primary action, not time on page. |
| Paid ads / paid channel | 1–3x target CPA in spend | At least 48–72 hours | Below 48h the platform is still optimising its own delivery. |

Write the floor into the plan before launch. A result read early is not a smaller result — it is a
different, usually wrong, result.

### Kill Rules

A channel is killed on evidence, not on mood:

- **Volume floor not reachable** in the plan's window → the channel cannot be judged, so it cannot be
  scaled. Fix the volume or drop the channel.
- **Floored test, no signal** → kill it. Move the budget to the next channel in the plan.
- **Paid channel past 3x target CPA with no payback** → kill it regardless of how good the creatives
  look.
- **Attribution missing** → the channel cannot be judged and therefore cannot be kept. Tag before
  shipping, not after. Every link leaving for a destination you own carries UTM; internal links
  never do, because an internal link with UTM restarts the session and splits one visit into two:

  ```text
  utm_source   = the channel that sent the click   (devto, github, telegram, reddit, newsletter)
  utm_medium   = the placement                     (article, readme, post, comment, profile, bio)
  utm_campaign = the product or cluster            (launch, onboarding, pricing)
  ```

  Append to existing query strings; never rebuild a URL. A URL that already has `utm_source` is
  done.

## Sources of Truth

When something has to be leaned on, lean on these, in this order.

### 1. Competitors with live motion are the first source of truth

Everything a competitor does is data. Always look from the marketing angle: **who is working the
user's exact audience right now, and making money doing it.** Those are the real competitors — not
old companies with no presence in the information field, and not the ones with the largest press
footprint.

- **Young, recently founded, growing company** → their hypotheses are the most valuable. Small team,
  short moves, fastest to copy, fastest to return a result.
- **Mid-size or old company** → check whether it has plateaued. A plateauing company can look
  excellent and drown in press; ignore that. Only companies earning and growing *right now* are
  worth benchmarking against.

Competitor analysis under this skill uses only methods available to the current agent with its own
tools: no purchases, no signups, no paid data sources. If search API keys exist, use them;
otherwise use freely available search. The evidence-gathering mechanics live in `market-research`
— this skill decides which competitors are worth that effort.

### 2. The stop-list — never treated as truth

1. **Launch aggregators, top-10 lists, and indie rankings** (Product Hunt and similar). This is a
   marketing battleground where marketers fight marketers. Readable as advertising, never as truth.
2. **Anything stale.** A report older than six months is historical data, not the current market.
   Six months is the edge of acceptable.
3. **Influencers and anyone trading reputation for placement.** A fine ad channel, not a source of
   truth.

### 3. Social accounts are the only semi-reliable source

Social is the closest thing to truth — after the fakes are stripped: bought engagement, word-spam
commenting, meaningless posting cadence. Remove the fake, and what remains is signal.

Bottom line: study only competitors who compete **through advertising**, because advertising is the
one method available to any startup.

## Benchmarking Against Live Motion

Benchmark against what competitors are doing now, not what they did last year:

- Who is buying attention in the channel the user is considering?
- What promise are they leading with, and what is visibly new in it?
- What is their apparent test volume floor — how much are they sending, spending, or publishing?
- Where is their funnel's weakest visible step?

Two safeguards:

- **A plateauing competitor can look successful.** Check the stage, not the press. Rising traffic
  with a shrinking offer is a plateau, not a benchmark.
- **The benchmark is a starting hypothesis, not the answer.** Copying a competitor's current move
  starts the user where the competitor already is. The differentiation has to come from somewhere —
  usually the part of the offer the competitor cannot say.

## Attention and Message Craft

Every message is received by two parts of a person, and both have to be served:

- **The rational part** — the conscious mind that reasons. Reach it mathematically: a clear claim,
  a number, a comparison, a next step.
- **The emotional part** — the deeper one that does not argue. Reach it by making the person feel
  something. Anxiety, relief, recognition, irritation — the emotion's polarity matters less than
  its presence. Invest emotionally in the message; do not wait to be asked.

Three keys to the person reading the message:

1. **People think about themselves.** Content must be useful to the reader, and it works best when
   the reader can keep thinking about themselves while consuming it.
2. **Novelty is interest.** If the thing is genuinely new, that is the draw. Help the user wrap what
   they built in the part of it that is actually new. Honest, but only about the good parts.
   Embellishment is allowed; fabrication is not.
3. **Money is a scaling tool, never a starting tool.** With zero clients, spend does not help. Once a
   hand-won flow exists, money buys access to an asset — search traffic, an audience, a placement.

## Graphics: Draw for the Eye

The human eye sees sharply only in a small focal spot (the fovea); everything else is background the
brain paints in. Any creative — banner, still, thumbnail, video frame — obeys the same three rules:

- **A scene and a background.** The eye needs context around the subject.
- **One hero.** A single main subject, inside the scene. The hero does not have to be centred, but it
  must exist and the scene must be built around it.
- **Movement above all.** The eye locks onto motion before anything else, including in a single still
  frame. Portraying that motion correctly is precisely what image and video generation is for.

Reality is what the eye is trained on; the job is to translate reality into the format of a picture
or a video. Accent, background, scene, movement — draw it so the viewer reconstructs the scene
without effort. When a full design direction is needed, that is `frontend-design-direction` or
`brand-voice` territory; this skill decides whether the creative is legible at a glance.

## Customer Acquisition Stages

### Client #1 — by hand

The first client is won by hand: cold outreach, cold email, direct contact. If the user doubts
whether that is normal, explain that it is the cheapest path, and that every alternative — context
ads, paid placement, boosted engagement — costs materially more before any of it works.

### Clients 2–10 — copy what is working

Win the first ten the way competitors are winning right now. Find how they do it and do the same
thing. If it is context ads, then by client nine or ten the user's own context ads should already be
running.

### Beyond 10 — out of scope

This skill covers client #1 and the first ten. Scaling 10→100 and 100→1000 is a different problem
with different rules and different budgets.

Money is for scaling, not for starting: a bad product must be filtered out by human judgment, never
by a spend threshold.

## Positioning and Offers

Positioning is a claim the user can defend against the competitor they actually face.

- **Name the alternative the buyer is comparing against** — usually not the user's product, but the
  current way of doing it, or the competitor already buying this audience's attention.
- **Lead with what is new and checkable.** "New" is an asset; a claim nobody can verify is a
  liability.
- **Offer before price.** A price objection is usually an offer objection. Fix the offer first.
- **One sentence, one promise.** If the promise needs a paragraph, the positioning is not finished.
- **Marketing may legally run ahead of the product.** The first thing anyone touches in a product is
  its marketing. Ship the landing page, describe the functionality that *will* exist, and pull the
  community into building it. This is how the introduction gets in front of the product for far less
  than the development costs.
- **A free offer is not an offer.** If the exchange is zero, it is not a promotion, it is unpaid work
  with extra steps.

Once positioning is settled, `marketing-campaign` turns it into copy, sequences, and a launch plan;
`seo` handles the pages that have to rank; `product-capability` keeps the claim honest against what
the product can actually do.

## Cold Outreach

Outreach is the default by-hand channel for client #1, and it is judged like any other test.

- **Volume is the plan.** A reply test needs ~1,500–2,000 sends per variant before its reply rate is
  a fact. If the plan cannot produce that, it is not a test — it is a sample.
- **One variable per variant.** Copy angle, offer, or list source. Not all three.
- **Reply rate is the metric.** Opens are a deliverability artefact; clicks are a copy artefact.
- **List quality beats copy polish.** A segment of 300 well-chosen recipients answers a question that
  3,000 random ones cannot.
- **Tag every outbound link** so the channel can be read in the same report as everything else, and
  killed on evidence rather than mood.
- **Do not warm up a channel that has not proven its message.** Personalisation depth is a later
  optimisation.

## Judging Evidence: Numbers Lie

Marketing is the largest consumer of proxy metrics and self-interested reports. When a case study
looks perfect, interrogate it before using it:

1. Who wrote it, and do they benefit from the conclusion?
2. Does it deviate wildly from normal market benchmarks?
3. Which company produced it, what was their context, and what did they actually do?

Treat every number as a claim with an author. The core job is to find an unlimited source of clients
and press it to the bottom on a regular basis — not to accumulate impressive dashboards.

## The Despair Dividend

Most hypotheses fail because they are reasonable: they are the obvious moves everyone already tried,
which is why they already failed for everyone else. The hypotheses with a real chance are the strange
ones — the guess nobody can derive, born after the obvious guesses are spent.

So when the user has run through every variant and nothing worked, say so plainly: *"we tried the
options, and nothing worked."* A person who keeps performing will reach that state on their own, and
being in it is exactly what generates the next hypotheses. Despair is not the signal to stop. It is
the door to the strange hypotheses — and it is the strange ones that tend to work.

## Worked Examples

### Example 1 — a cold email reply test, declared before launch

The user wants to know whether a new opening line beats their current one.

```yaml
test: cold-email-reply-rate
hypothesis: "Naming the competitor's current move lifts reply rate above the control."
variable: opening line          # exactly one
control: current opening line
variant: competitor-move line
floor_per_variant: 1800 sends   # inside the 1,500-2,000 band
metric: replies / sends         # not opens
kill_rule: variant >= control at floor -> keep control; variant < control at floor -> kill variant
notes: send from the same domain, same offer, same list split 50/50
```

Read it only when both arms pass 1,800 sends. Before that, the honest answer to "how is it going" is
"not yet measurable".

### Example 2 — reading a paid channel

The user spent a week in a paid channel at 0.6x target CPA and wants to scale to 10x.

```text
Spend: 0.6x target CPA · Elapsed: ~7 days · Floor: 1-3x target CPA over 48-72h
Verdict: the channel has cleared its floor and is inside the scaling band.
Action:  raise budget in steps, re-read at each step against target CPA.
         A single week at 0.6x is a green light for a step, not for 10x.
```

Contrast: the same channel at 3.2x target CPA after 72 hours is dead, no matter how good the
creatives look.

### Example 3 — competitor benchmarking with live motion

The user names three competitors, all of whom have large press footprints.

```text
Check: is each one working this audience right now, and earning from it?
  Competitor A - rising traffic, shrinking offer, heavy press   -> plateau; not a benchmark
  Competitor B - shipping weekly, buying the channels we want   -> benchmark this one
  Competitor C - no marketing presence in the information field -> not a competitor here
Action: study only B. Find its promise, its apparent volume floor, and the step in its funnel
        that is visibly weakest. The user's differentiation has to come from there.
```

### Example 4 — the zero-exchange request

The user asks for a free guest post on a site with no audience, because the editor "might" refer
clients later.

```text
Exchange: time + deliverable  ->  no audience, no traffic, no verifiable referral path
Verdict: zero exchange. Decline, and say why with the arithmetic (hours x rate vs. expected value).
Counter: name a site with an audience the user actually wants; offer the same piece there.
```

## Anti-Patterns

- Quoting stale business books, cached model knowledge, or six-month-old reports as current truth.
- Planning in two-year cycles, or accepting a plan whose first readable signal is a year away.
- Blocking the user from making the first move — sending the first message, trying a bold tactic, or
  testing something that looks slightly unorthodox. Advertising is mostly unrestrictive; let the
  idea run and evaluate it afterwards.
- Running a test with two variables changed, or reading a test before its declared floor.
- Judging a paid channel inside 48–72 hours or below 1–3x target CPA.
- Treating launch aggregators, top-10 lists, or influencer posts as market truth.
- Trusting case studies and proxy metrics without interrogating who wrote them.
- Recommending paid channels to a user with zero clients, before any by-hand channel has worked.
- Using paid data sources when free ones answer the question.
- Working for free — zero-exchange tasks, "for the portfolio", or treating training time as free.
- Letting an untagged channel into a report and then "feeling" that it works.
- Producing copy, decks, or campaigns out of this skill instead of handing those to the skills that
  own them.

## Best Practices

- Run the exchange check before agreeing to any marketing work, and put the arithmetic in writing.
- State the volume floor, the single variable, and the kill rule before the test starts.
- Tag outbound links at draft time, not after publication.
- Benchmark against competitors earning right now, and check their stage before copying them.
- Serve the rational and the emotional reader in the same message.
- Keep the first-client plan concrete and name client #0 — the founder — explicitly.
- Kill channels on evidence; keep the ones that clear their floor, and do not keep the rest out of
  sentiment.
- Say "not measurable yet" when the floor has not been reached. It is a complete answer.

## Verification

- Every hypothesis has a three-month outcome and one fast test attached.
- Every test has a pre-declared volume floor at or above the floors in this skill, exactly one
  changed variable, and a kill rule.
- Competitor analysis names the companies working the user's exact audience right now — not old or
  absent ones — and marks any plateauing one as such.
- Stop-list sources are excluded from truth.
- Every outbound link that leaves for a destination the user owns carries UTM; internal links do not.
- The plan for the first client is concrete and names client #0 (the founder).
- Feedback is honest, not agreeable — including when the honest answer is that nothing worked.
- Output is decisions and concrete tasks, never vague advice.

## Related Skills

- `market-research` — evidence gathering for the competitors and markets this skill judges
- `marketing-campaign` — turns the decisions made here into copy, sequences, and a launch plan
- `content-engine` — platform-native content production and repurposing
- `brand-voice` and `article-writing` — voice and prose once the message is decided
- `seo` — on-page structure for the pages the plan depends on
- `growth-log` — captures what a killed or scaled channel taught, so the next test starts ahead
