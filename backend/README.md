# Keystone backend

Accounts + billing for Keystone. This service does **not** yet store your
calendar/contacts data — that still lives in the browser's `localStorage`,
same as before. This is just the foundation: who you are (Clerk) and
whether you're paying (Stripe). Syncing the actual app data to the server
is separate follow-up work.

## Stack

- Node.js + Express (ESM)
- Postgres via Prisma 7 (`@prisma/client` + `@prisma/adapter-pg`)
- [Clerk](https://clerk.com) for accounts/sessions
- [Stripe](https://stripe.com) for subscription billing

## 1. Local development

### Database

You need a local Postgres instance. Quickest path with Postgres already
installed:

```bash
sudo -u postgres psql -c "CREATE USER keystone WITH PASSWORD 'keystone_dev' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE keystone_dev OWNER keystone;"
```

Or use Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=keystone_dev -e POSTGRES_USER=keystone -e POSTGRES_DB=keystone_dev postgres:16`.

### Install + configure

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum to start
npm run db:migrate     # applies prisma/migrations, generates the client
npm run dev            # http://localhost:4000
```

`GET /api/health` should return `{"ok":true}` even before Clerk/Stripe are
configured — auth-gated routes will 500 until those env vars are real.

## 2. Set up Clerk

1. Create an app at [dashboard.clerk.com](https://dashboard.clerk.com).
2. **API Keys** page → copy the Publishable key and Secret key into `.env`
   (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) and into the frontend's
   `.env` as `VITE_CLERK_PUBLISHABLE_KEY` (see `../schedule-app/.env.example`).
3. **Webhooks** page → add an endpoint pointing at
   `https://<your-backend-domain>/api/webhooks/clerk` (for local dev, use a
   tunnel like `ngrok http 4000` and point it at the tunnel URL). Subscribe
   to at least `user.created` and `user.deleted`. Copy the **Signing
   Secret** into `CLERK_WEBHOOK_SIGNING_SECRET`.

This webhook keeps a `User` row in our database in sync with Clerk. (The
backend also lazily creates the row on first authenticated request, so
things still work if the webhook hasn't fired yet — but the webhook is
what keeps emails in sync and cleans up on account deletion.)

## 3. Set up Stripe

1. Create/use a [Stripe](https://dashboard.stripe.com) account. Use
   **test mode** until you're ready to charge real cards.
2. **Product catalog** → create a "Keystone Pro" product with a **one-time**
   price (Stripe calls this "One off" / non-recurring). Copy its Price ID
   into `STRIPE_PRICE_ID_LIFETIME`. It must not be a recurring price —
   checkout runs in `payment` mode and Stripe rejects recurring prices there.
3. **Developers → API keys** → copy the Secret key into `STRIPE_SECRET_KEY`.
4. **Developers → Webhooks** → add an endpoint at
   `https://<your-backend-domain>/api/webhooks/stripe`. Subscribe to
   `checkout.session.completed` — that is what grants Pro. If you have
   subscribers from before the switch, also keep
   `customer.subscription.created`, `customer.subscription.updated`, and
   `customer.subscription.deleted` so their access stays accurate. Copy the
   **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
5. **Customer portal** (Settings → Billing → Customer portal) → only needed
   if you have pre-switch subscribers; it is how they cancel. New buyers
   never see it, since a one-time purchase has nothing to manage.

Test the whole loop with Stripe's test card `4242 4242 4242 4242`, any
future expiry, any CVC.

## 4. Deploy (Render or Railway)

Both work the same way for this service:

1. Create a Postgres database on the platform; it gives you a
   `DATABASE_URL` — put that in the service's env vars.
2. Create a Node web service pointed at this `backend/` directory.
   - Build command: `npm install && npm run db:deploy` (applies migrations
     without the interactive prompts `migrate dev` uses).
   - Start command: `npm start`.
3. Set every var from `.env.example` in the platform's environment
   settings — `FRONTEND_URL` should be your deployed frontend's real URL
   (not localhost), which also feeds the Stripe redirect URLs.
4. Re-point the Clerk and Stripe webhook endpoints (steps 2.3 / 3.4 above)
   at the deployed URL once you have it.

## API surface

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /api/health` | none | liveness probe |
| `GET /api/me` | Clerk session | `{ id, email, isPro, subscriptionStatus, currentPeriodEnd }` |
| `GET /api/data` | Clerk session | `{ data, updatedAt }` — the whole synced app data blob, or `{ data: null }` if nothing's been pushed yet |
| `PUT /api/data` | Clerk session | body `{ data: <object> }`, upserts the whole blob, returns `{ updatedAt }` |
| `POST /api/billing/checkout` | Clerk session | body `{ plan: "monthly" \| "annual" }`, returns `{ url }` — redirect the browser there |
| `POST /api/billing/portal` | Clerk session | returns `{ url }` for Stripe's hosted subscription-management page |
| `POST /api/webhooks/clerk` | Clerk webhook signature | keeps `User.email` in sync |
| `POST /api/webhooks/stripe` | Stripe webhook signature | keeps subscription status in sync |
| `GET /api/calendars` | Clerk session | calendars you're a member of, with your role on each |
| `POST /api/calendars` | Clerk session | body `{ name, color? }`, creates a calendar with you as owner |
| `GET /api/calendars/:id` | Clerk session, member | `{ calendar, role, members, events }` |
| `PATCH /api/calendars/:id` | Clerk session, owner | body `{ name?, color? }` |
| `DELETE /api/calendars/:id` | Clerk session, owner | |
| `DELETE /api/calendars/:id/members/:memberId` | Clerk session, self or owner | can't remove the owner |
| `GET /api/calendars/:id/invites` | Clerk session, owner | pending invites |
| `POST /api/calendars/:id/invites` | Clerk session, owner/editor | body `{ email, role? }`, returns `{ invite }` (send the `token` yourself — no email is sent) |
| `DELETE /api/calendars/:id/invites/:inviteId` | Clerk session, owner | revoke a pending invite |
| `POST /api/calendars/invites/:token/accept` | Clerk session | joins the calendar the token was issued for |
| `POST /api/calendars/:id/events` | Clerk session, owner/editor | body `{ title, date, start, end, notes? }` |
| `PATCH /api/calendars/:id/events/:eventId` | Clerk session, owner/editor | |
| `DELETE /api/calendars/:id/events/:eventId` | Clerk session, owner/editor | |

Authenticated routes expect `Authorization: Bearer <clerk session token>` —
the frontend gets this from Clerk's `useAuth().getToken()`.

## Known gaps / next steps

- **The lifetime-purchase migration hasn't been run.** Pro switched from a
  subscription to a one-time purchase;
  `prisma/migrations/20260727010000_lifetime_purchase` adds the
  `lifetimePurchasedAt` / `lifetimeSessionId` columns that grant it. Until
  it's applied, `/api/me` will error on the missing columns. Run
  `npm run db:migrate` locally or `npm run db:deploy` in production. The
  migration is additive and leaves the old subscription columns alone, so
  anyone who subscribed before the switch keeps working — `isPro` is true
  for a lifetime purchase *or* an still-active legacy subscription, and the
  pricing page offers those users a "Manage billing" link to cancel. Don't
  forget to swap the Stripe price (see §3) — the old recurring price will be
  rejected in `payment` mode.

- **Shared calendars are scaffolded but not migrated.** The
  `SharedCalendar` / `SharedCalendarMember` / `SharedCalendarInvite` /
  `SharedEvent` models exist in `prisma/schema.prisma` and the routes in
  `src/routes/calendars.js` are wired up, but no migration has been run
  against any database — run `npm run db:migrate` (creates one against
  your local dev DB) or `npm run db:deploy` (applies pending migrations,
  for CI/production) once you're ready to turn this on. Invites don't send
  an email; `POST /api/calendars/:id/invites` just returns the invite
  (with its `token`) for you to deliver however you like (a `mailto:`
  link, copy-to-clipboard, etc.) — see `schedule-app/src/pages/
  SharedCalendarsPage.jsx` for the frontend that already expects this
  shape. Shared events are intentionally simple (no recurrence) — see the
  schema comment for why.
- Data sync (`/api/data`) stores the whole app state as one JSON blob per
  user — simple last-write-wins across a person's own devices, not a
  conflict-resolving multi-editor sync. It's a real prerequisite for any
  server-side feature that needs a user's history (e.g. an AI assistant),
  but that feature itself still needs to be built.
- `subscriptionStatus` treats `active` and `trialing` as Pro; adjust
  `PRO_STATUSES` in `src/routes/me.js` if you add a trial or grace-period
  policy.
