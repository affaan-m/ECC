# Compass

A personal **schedule, goals, and people** planner — a progressive web app (PWA)
inspired by the structure of the LDS *Preach My Gospel* planner, reworked for
everyday personal use.

It keeps the same three-part shape as the original app, with two deliberate
changes:

- The first tab is **Goals** (weekly targets with progress) instead of Key
  Indicators.
- The **People** tab is a general relationship tracker with your own custom
  status labels, rather than a missionary teaching record.

## Tabs

| Tab | What it does |
|-----|--------------|
| **Goals** | Weekly targets (e.g. *Workouts 2/4*) grouped by category, with a week selector, progress ring, and quick +/− steppers. Progress is tracked per week. |
| **Planner** | A **Day** timeline (tap anywhere to add an event) and a **Week** agenda. Events can be linked to a person, given a location, notes, and marked done. |
| **People** | Searchable contact list filtered by custom statuses. Each person has a detail page with call / text / email / "log today" quick actions, tags, notes, and upcoming linked events. |
| **More** | Light/dark/system theme, manage your custom people-statuses (label + color), and export / import / reset your data. |

## Data & privacy

All data is stored **locally in your browser** (`localStorage`). There is no
account, no server, and it works fully offline. Use **More → Export backup** to
save a `.json` copy, and **Import backup** to restore it (handy when moving
between devices).

## Running locally

```bash
cd schedule-app
npm install
npm run dev      # start the dev server (Vite)
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Then open the printed URL. On a phone, use your browser's **Add to Home
Screen** to install it as a standalone app.

## Tech

- React 18 + Vite
- React Router (hash routing, so it works from any static host)
- No UI framework — plain CSS with light/dark theming via CSS variables
- A small service worker (`public/sw.js`) caches the app shell for offline use

## Project layout

```
schedule-app/
├── index.html
├── public/            # manifest, icon, service worker
└── src/
    ├── main.jsx       # entry + SW registration
    ├── App.jsx        # routes + theme handling
    ├── styles.css     # full design system
    ├── data/          # store (reducer + localStorage), helpers, seed data
    ├── components/    # TabBar, Modal
    └── pages/         # Goals, Planner, Contacts, ContactDetail, More
```
