# ⚔️ ChemQuest — Trials of the Periodic Realm

A turn-based, **medieval-fantasy study RPG** for revising **Year 1 IB
Chemistry**. You and your familiar ride hold to hold across the Periodic Realm,
freeing keeps from the blight of Entropy by recalling chemistry. Answer right and
you strike the beast; answer wrong and it strikes back — but you always get an
explanation, so every mistake becomes learning.

It's set in a candlelit-keep world (think Skyrim / Witcher holds), with its own
**generated medieval lute music**, themed foes (Bond Wyrms, Periodic Gargoyles,
Cinder Imps…), and **two ways to answer**: multiple choice or **written recall**
(type answers from memory).

Built on the official IB Chemistry guide (2023 syllabus, first exams 2025),
covering **Structure 1–3** and **Reactivity 1–2**.

> **🆕 Never opened it before?** See **[HOW-TO-OPEN-MAC.md](HOW-TO-OPEN-MAC.md)**
> for dead-simple, click-by-click instructions for macOS (no coding needed).

## ▶️ How to play

1. Open **`index.html`** in any modern browser (double-click it — no install,
   no internet needed). On a Mac, see the guide linked above.
2. Name your familiar, then hit **Adventure**.
3. Each turn, answer the riddle. Build a **combo** for bigger hits, answer fast
   for bonus damage, and **level up** as you go.
4. Clear every hold in a realm to unlock its **Warden** — a mixed trial of the
   whole theme.
5. Tap the **🎵 note** (bottom-left corner) anytime to toggle the lute music.

Your progress saves automatically in the browser.

> Tip: it works great on a phone too — add the page to your home screen and
> revise on the bus.

## 🧠 The learning science (this isn't just a game)

Every mechanic maps to a research-backed study method:

| In the game | The method | Why it works |
|-------------|------------|--------------|
| Every turn asks you to produce an answer | **Active recall / retrieval practice** | Retrieving beats re-reading for long-term memory |
| **Written recall** mode: type the answer from memory | **Free recall** (the strongest retrieval) | Generating without cues builds the most durable memory |
| Missed questions come back sooner | **Spaced repetition** (Leitner boxes) | Re-testing at the right time fights forgetting |
| Warden battles mix a whole theme together | **Interleaving** | Mixing topics improves discrimination and transfer |
| An explanation after **every** answer | **Elaborative feedback** | Turns errors into understanding immediately |
| XP is earned only by recalling correctly | **Testing effect + motivation** | Ties the dopamine to actual learning, not clicking |
| **Review Lab** drills your weakest cards | **Targeted spaced practice** | Spends your time where memory is weakest |

## 🎯 Matching it to *your* exam

Your sheet had some topics crossed out or highlighted as **not on the exam**.
To remove any of them:

- In the app: open **Lab & Stats → Exam scope** and toggle a topic **off**. It
  disappears from the map, battles and review instantly. (No code needed.)
- Or edit **`data.js`**: set `on: false` on any zone.

To add or fix questions, open `data.js` — each question is a small block with
the prompt (`q`), correct answer (`a`), three wrong options (`x`), and an
explanation (`e`). Instructions are at the top of the file.

## 🗂️ Files

| File | What it is |
|------|------------|
| `index.html` | The app shell — **open this to play** |
| `styles.css` | All styling (medieval candlelit-keep theme) |
| `engine.js` | Game engine: battles, leveling, spaced-repetition, lute music, effects |
| `data.js` | The question bank — **edit this to change content** |
| `HOW-TO-OPEN-MAC.md` | Click-by-click opening guide for macOS |

## 🎮 Modes & options

- **Adventure** — ride through the syllabus hold by hold, with Warden bosses.
- **Endless Siege** — survive escalating waves of mixed foes.
- **Review Lab** — a focused drill of the cards you most need to revise.
- **Written recall** *(toggle in Lab & Stats)* — type your answers from memory
  instead of picking from four options. Forgiving spell-check + a **🗝 Hint**
  button, and an honest "I had it / I missed it" check for longer answers.
- **Lute music** *(toggle the 🎵 corner button, or in Lab & Stats)* — generated
  medieval background music; chill-tavern vibes.

## ♿ Accessibility

- Keyboard play: keys **1–4** choose answers, **Enter** submits a typed answer,
  **Enter/Space** continues.
- **Relaxed mode**: turn the timer off in settings.
- **Reduced motion**: animations can be switched off (and respect the OS
  `prefers-reduced-motion` setting).
- Sound effects and music can each be muted independently.

## 🧪 Tech notes

Plain HTML/CSS/JavaScript — no build step, no dependencies, no network calls.
**All sound *and* the medieval music are generated live with the Web Audio API**
(no audio files), and graphics are inline SVG and `<canvas>`, so the whole thing
runs from a single folder, even fully offline.

Good luck, adventurer. ⚔️
