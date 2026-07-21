# Stewardly

A personal **schedule, goals, and people** planner — a progressive web app (PWA)
inspired by the structure of the LDS *Preach My Gospel* planner, reworked for
everyday personal use.

## Tabs

| Tab | What it does |
|-----|--------------|
| **Home** | A dashboard: mini daily/weekly goal-progress rings, an **important reminders** list (goals, tasks, and events with something due today), a checkable **Tasks** list, a Google-Keep-style **Notes** grid (free text or checklist, color, pin-to-top), and a quick-add **+** for a new event, person, task, or note. Non-Pro users see a **Pro** bubble top-right. |
| **Goals** | **Daily** and **weekly** goals (Today / This week toggle), grouped by category, with a date/week selector, progress ring, and quick +/− steppers. Each goal can carry a **reminder** time. New goals are added from a floating **+**, opened as a full-page editor. |
| **Planner** | **Day**, **Week**, and **Month** views. Tap an event for a read-only **detail view**; a pencil button opens the full editor. On the day timeline, **press and hold** a block (~500ms, with a grip indicator) to arm it for dragging — a plain tap always opens the detail view instead. Events support color-coded **types** plus a per-event color override, **reminders**, and **repeat** rules (daily/weekly/biweekly/monthly, or **custom weekdays**). Editing a single occurrence of a recurring event detaches it as an exception (✎) without touching the rest of the series. Location can be free text and/or a **dropped pin** on an embedded mini-map. A **Select** mode lets you multi-select occurrences and shift them together by a day/week. Events schedule arbitrarily far out (verified 4+ months). |
| **People** *(Pro)* | Searchable contact list filtered by custom statuses, with **photos** (camera or library). Each person has a detail page with call/text/email/"log today" actions, tags, notes, linked map places, and upcoming events. **Reconnect nudges** flag anyone you haven't been in touch with for a while. A floating **+** starts a calendar event linked to them. |
| **Map** | Drop pins with an emoji + label. **Tap** to place one via the "+" button; **press and hold** anywhere drops a temporary pin with a one-tap choice to save it permanently or just get directions. Pins link to a person and support a "my location" button. |
| **More** | Profile (local name/photo), appearance (light/dark/system + **8 color themes**, Pro), notifications, reconnect-reminder threshold, custom people-statuses and event types, account & sync stubs (cloud sync, Google sign-in — Pro, not yet connected to a backend), **.ics calendar import/export** (Pro), feedback, a donation button, and full data export/import/reset. |
| **Pricing** | Monthly ($4) / annual ($35) plans with a feature comparison and a **demo** "Try Pro" toggle — see the Pro section below. |

## "Pro" — what's real and what's a demo

Several requested features (contacts/People, sharing events with others, Google
sign-in, cloud sync, cross-device backup, calendar import/export, color themes)
are gated behind a **Pro** flag. Since this app has **no backend and no
payment processor connected**, "Pro" here is a **local demo toggle**
(`settings.isPro`, flipped from the Pricing page) that unlocks the gated UI so
you can see and use those features — it does not charge a card. Real
subscriptions, real Google OAuth, real multi-device sync, and real
collaborative sharing all need a server (auth, a database, and something like
Stripe) that doesn't exist yet. Every stub in the app says so explicitly where
you'd hit it, rather than pretending to work.

The **`.ics` calendar export/import is real** — it's a client-side file format,
so it works with no backend and interoperates with Google Calendar, Apple
Calendar, Outlook, etc.

## Data & privacy

All data is stored **locally in your browser** (`localStorage`). There is no
account, no server, and it works fully offline. Use **More → Export backup** to
save a `.json` copy, and **Import backup** to restore it (handy when moving
between devices). Contact/profile photos are downscaled client-side before
storage to keep the backup file small.

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
- No UI framework — plain CSS with light/dark theming + 8 accent color
  schemes, all via CSS custom properties
- A small service worker (`public/sw.js`) caches the app shell for offline use
- Haptic feedback via the Vibration API where the browser supports it
  (Android Chrome/Firefox; iOS Safari has no Vibration API, so it's a silent
  no-op there — a native wrapper would be needed for iOS haptics)

> The map needs a network connection to load its tiles. Everything else
> (goals, planner, people, tasks, notes, and your pins) works fully offline.

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
    ├── main.jsx        # entry + SW registration
    ├── App.jsx         # routes, theme + color-scheme application, haptics wiring
    ├── styles.css       # full design system (themes, schemes, components)
    ├── data/
    │   ├── store.jsx    # reducer + localStorage persistence
    │   ├── helpers.js   # dates, recurrence rules, formatting
    │   ├── notifications.js  # permission + best-effort reminder scanner
    │   ├── haptics.js   # Vibration API wrapper
    │   ├── image.js     # client-side photo downscaling
    │   └── ics.js        # .ics export/import
    ├── components/      # TabBar, EditorSheet, Modal, Select, Avatar, MiniMapPicker, Logo
    └── pages/            # Home, Goals, Planner, Contacts, ContactDetail, Map, More, Pricing
```
