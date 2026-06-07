# ⚗️ ChemQuest — Trials of the Periodic Realm

A turn-based study **RPG** for revising **Year 1 IB Chemistry**. You and your
mole companion battle Entropy monsters across the Periodic Realm by recalling
chemistry. Get an answer right and you strike; get it wrong and the monster
strikes back — but you always get an explanation, so every mistake becomes
learning.

Built on the official IB Chemistry guide (2023 syllabus, first exams 2025),
covering **Structure 1–3** and **Reactivity 1–2**.

## ▶️ How to play

1. Open **`index.html`** in any modern browser (double-click it — no install,
   no internet needed).
2. Name your companion, then hit **Adventure**.
3. Each turn, pick the answer. Build a **combo** for bigger hits, answer fast
   for bonus damage, and **level up** as you go.
4. Clear every region in a theme to unlock its **Boss** — a mixed trial of the
   whole theme.

Your progress saves automatically in the browser.

> Tip: it works great on a phone too — add the page to your home screen and
> revise on the bus.

## 🧠 The learning science (this isn't just a game)

Every mechanic maps to a research-backed study method:

| In the game | The method | Why it works |
|-------------|------------|--------------|
| Every turn asks you to produce an answer | **Active recall / retrieval practice** | Retrieving beats re-reading for long-term memory |
| Missed questions come back sooner | **Spaced repetition** (Leitner boxes) | Re-testing at the right time fights forgetting |
| Boss battles mix a whole theme together | **Interleaving** | Mixing topics improves discrimination and transfer |
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
| `index.html` | The app shell — open this to play |
| `styles.css` | All styling (neon alchemy-lab theme) |
| `engine.js` | Game engine: battles, leveling, spaced-repetition scheduling, effects |
| `data.js` | The question bank — **edit this to change content** |

## 🎮 Modes

- **Adventure** — work through the syllabus region by region, with bosses.
- **Endless** — survive escalating waves of mixed questions.
- **Review Lab** — a focused drill of the cards you most need to revise.

## ♿ Accessibility

- Keyboard play: keys **1–4** choose answers, **Enter/Space** continues.
- **Relaxed mode**: turn the timer off in settings.
- **Reduced motion**: animations can be switched off (and respect the OS
  `prefers-reduced-motion` setting).
- Sound effects can be muted.

## 🧪 Tech notes

Plain HTML/CSS/JavaScript — no build step, no dependencies, no network calls.
Sound is generated with the Web Audio API and graphics are inline SVG and
`<canvas>`, so the whole thing runs from a single folder, even offline.

Good luck, alchemist. 🔬
