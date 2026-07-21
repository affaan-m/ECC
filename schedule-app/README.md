# Stewardly

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
| **Goals** | **Daily** and **weekly** goals (Today / This week toggle), grouped by category, with a date/week selector, progress ring, and quick +/− steppers. Daily progress resets each day, weekly each week. Each goal can carry a **reminder** time, and new goals are added from a floating **+** button. |
| **Planner** | A **Day** timeline (tap anywhere to add an event) and a **Week** agenda. Events can be linked to a person, given a location, notes, and marked done. Events can **repeat** (daily / weekly / every 2 weeks / monthly, with an optional end date); a recurring event shows a ↻ glyph. Opening an occurrence lets you edit **just this event** or **all events** — a single-occurrence edit (new time, title, even a different day) detaches into an exception marked ✎, while the rest of the series is untouched. You can also mark or delete one occurrence on its own. Events have color-coded **types** (plus a per-event color override), optional **reminders**, and you can **drag a block on the day timeline to reschedule it**. The editor opens as a sheet you can **swipe down to dismiss**. |
| **People** | Searchable contact list filtered by custom statuses. Each person has a detail page with call / text / email / "log today" quick actions, tags, notes, linked places, and upcoming events. **Reconnect nudges** flag anyone you haven't been in touch with for a while — a banner at the top, an amber filter chip, and a per-row tag — with a one-tap "Log" to reset the timer. The threshold is set in More and can be overridden per person. Each person's page has a floating **+** to start a calendar event linked to them. |
| **Map** | Drop pins with an emoji + text label anywhere on the map. Tap a pin for its info card and a **Get directions** button (opens Google Maps navigation), plus a corner directions button. Pins can be linked to a person, a "my location" button re-centers the map, and you can add a place for someone straight from their People detail page. |
| **More** | Light/dark/system theme, a notifications toggle, manage custom people-statuses and **event types** (label + color), a **feedback / suggest-a-feature** button, and export / import / reset your data. |

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
- Leaflet + OpenStreetMap tiles for the map (no API key required); the
  "Get directions" button opens Google Maps navigation via a plain URL
- No UI framework — plain CSS with light/dark theming via CSS variables
- A small service worker (`public/sw.js`) caches the app shell for offline use

> The map needs a network connection to load its tiles. Everything else
> (goals, planner, people, and your pins) works fully offline.

> **About reminders:** because this is a serverless PWA, notifications fire
> only while Stewardly is open or recently backgrounded — a web app with no
> push server can't wake a fully-closed app the way a native app can. Turn
> them on in More → Notifications (or by setting a reminder on a goal/event).

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
