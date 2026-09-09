-- Reference schema for the operator approval loop.
-- SQLite dialect; adapt types for other engines.

CREATE TABLE IF NOT EXISTS obligations (
  id             INTEGER PRIMARY KEY,
  counterparty   TEXT NOT NULL,
  source         TEXT NOT NULL,           -- origin platform
  channel        TEXT NOT NULL,
  direction      TEXT NOT NULL,           -- 'we_owe_them' | 'they_owe_us' | 'none'
  status         TEXT NOT NULL,           -- 'open' | 'drafted' | 'approved' | 'rejected' | 'sent' | 'closed'
  summary        TEXT NOT NULL,
  opened_ts      INTEGER NOT NULL,
  last_touch_ts  INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL         -- decision epoch; advances on every re-file
);

-- Exact draft text plus origin coordinates. One per obligation; replaced on re-file.
CREATE TABLE IF NOT EXISTS obligation_drafts (
  obligation_id        INTEGER PRIMARY KEY REFERENCES obligations(id),
  draft_text           TEXT NOT NULL,
  context              TEXT,
  origin_platform      TEXT NOT NULL,
  origin_channel       TEXT NOT NULL,
  origin_thread        TEXT,
  origin_user          TEXT,
  priority             TEXT NOT NULL DEFAULT 'P2',   -- P0..P3
  draft_sha256         TEXT NOT NULL,
  created_ts           INTEGER NOT NULL,
  updated_ts           INTEGER NOT NULL,
  auto_send_after      INTEGER,                      -- NULL = hard gate
  signal_obligation_id INTEGER REFERENCES obligations(id)
);

-- Operator (or auto-ttl) decisions, keyed to the draft epoch they were made against.
CREATE TABLE IF NOT EXISTS obligation_decisions (
  id               INTEGER PRIMARY KEY,
  obligation_id    INTEGER NOT NULL REFERENCES obligations(id),
  decision         TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  operator         TEXT NOT NULL,
  decided_ts       INTEGER NOT NULL,
  nonce            TEXT NOT NULL UNIQUE,
  draft_updated_ts INTEGER NOT NULL      -- must equal obligations.updated_at to be valid
);

-- Delivery ledger. UNIQUE(obligation_id, decision_id) makes delivery idempotent.
CREATE TABLE IF NOT EXISTS obligation_deliveries (
  id            INTEGER PRIMARY KEY,
  obligation_id INTEGER NOT NULL REFERENCES obligations(id),
  decision_id   INTEGER NOT NULL REFERENCES obligation_decisions(id),
  kind          TEXT NOT NULL CHECK (kind IN ('draft_sent', 'reject_notice', 'manual_notice')),
  coordinate    TEXT NOT NULL,           -- where it landed: message id, email id, thread ts
  delivered_ts  INTEGER NOT NULL,
  UNIQUE(obligation_id, decision_id)
);

-- State table
-- drafted   -> approved   (operator approve, or auto-ttl sweep when auto_send_after passed)
-- drafted   -> rejected   (operator reject)
-- drafted   -> drafted    (re-file: new draft text, new sha, updated_at advances)
-- approved  -> sent       (delivery monitor sends exact draft_text, ledger row inserted)
-- rejected  -> rejected   (reject notice ledgered, no send)

-- Pending deliveries: decided, has a draft sidecar, no ledger row yet.
-- SELECT o.id, dec.id, d.draft_text
--   FROM obligations o
--   JOIN obligation_decisions dec ON dec.obligation_id = o.id
--   JOIN obligation_drafts d      ON d.obligation_id = o.id
--  WHERE o.status IN ('approved', 'rejected')
--    AND NOT EXISTS (SELECT 1 FROM obligation_deliveries del
--                     WHERE del.obligation_id = o.id AND del.decision_id = dec.id)
--  ORDER BY dec.decided_ts ASC;
