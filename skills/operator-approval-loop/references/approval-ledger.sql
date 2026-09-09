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

-- Only one obligation may occupy a counterparty/channel draft queue at a time.
-- This is independent of delivery-claim uniqueness. Existing duplicate drafts
-- make schema application fail: stop startup and reconcile them explicitly before
-- retrying. Never delete, merge or change their status automatically on upgrade.
CREATE UNIQUE INDEX IF NOT EXISTS one_drafted_obligation_per_counterparty_channel
ON obligations(counterparty, channel) WHERE status='drafted';

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

-- Completed receipts only. Uniqueness deduplicates rows, not external side effects.
CREATE TABLE IF NOT EXISTS obligation_deliveries (
  id            INTEGER PRIMARY KEY,
  obligation_id INTEGER NOT NULL REFERENCES obligations(id),
  decision_id   INTEGER NOT NULL REFERENCES obligation_decisions(id),
  kind          TEXT NOT NULL CHECK (kind IN ('draft_sent', 'reject_notice', 'manual_notice')),
  coordinate    TEXT NOT NULL,           -- where it landed: message id, email id, thread ts
  delivered_ts  INTEGER NOT NULL,
  UNIQUE(obligation_id, decision_id)
);

-- Additive reference schema for NEW, already-authorized decisions. No legacy backfill.
-- Every connection must enable foreign_keys and recursive_triggers.
PRAGMA foreign_keys = ON;
PRAGMA recursive_triggers = ON;

-- Eligible current records are not authority by themselves: the trusted decision
-- writer must persist an approval snapshot in its decision transaction.
CREATE VIEW IF NOT EXISTS approval_current_drafts AS
SELECT dec.id AS decision_id, o.id AS obligation_id, o.updated_at AS draft_epoch,
       d.draft_text, d.draft_sha256, d.origin_platform, d.origin_channel, d.origin_thread
  FROM obligation_decisions dec
  JOIN obligations o ON o.id=dec.obligation_id
  JOIN obligation_drafts d ON d.obligation_id=o.id
 WHERE dec.decision='approve' AND o.status='approved' AND o.direction='we_owe_them'
   AND dec.draft_updated_ts=o.updated_at AND d.updated_ts=o.updated_at
   AND o.source=d.origin_platform AND o.channel=d.origin_channel;

CREATE TABLE IF NOT EXISTS obligation_approval_snapshots (
  decision_id INTEGER PRIMARY KEY REFERENCES obligation_decisions(id),
  obligation_id INTEGER NOT NULL REFERENCES obligations(id),
  draft_epoch INTEGER NOT NULL,
  draft_text TEXT NOT NULL,
  draft_sha256 TEXT NOT NULL,
  origin_platform TEXT NOT NULL CHECK(length(trim(origin_platform))>0),
  origin_channel TEXT NOT NULL CHECK(length(trim(origin_channel))>0),
  origin_thread TEXT,
  kind TEXT NOT NULL CHECK(kind='draft_sent'),
  UNIQUE(obligation_id, decision_id)
);

CREATE TRIGGER IF NOT EXISTS approval_snapshot_insert BEFORE INSERT ON obligation_approval_snapshots
WHEN EXISTS (SELECT 1 FROM obligation_approval_snapshots WHERE decision_id=NEW.decision_id)
  OR NOT EXISTS (
    SELECT 1 FROM approval_current_drafts d
     WHERE d.decision_id=NEW.decision_id AND d.obligation_id=NEW.obligation_id
       AND d.draft_epoch=NEW.draft_epoch AND d.draft_text=NEW.draft_text
       AND d.draft_sha256=NEW.draft_sha256 AND d.origin_platform=NEW.origin_platform
       AND d.origin_channel=NEW.origin_channel AND d.origin_thread IS NEW.origin_thread)
BEGIN SELECT RAISE(ABORT,'approval snapshot must match a current authorized decision'); END;
CREATE TRIGGER IF NOT EXISTS approval_snapshot_update BEFORE UPDATE ON obligation_approval_snapshots
BEGIN SELECT RAISE(ABORT,'approval snapshots are immutable'); END;
CREATE TRIGGER IF NOT EXISTS approval_snapshot_delete BEFORE DELETE ON obligation_approval_snapshots
BEGIN SELECT RAISE(ABORT,'approval snapshots are immutable'); END;

CREATE VIEW IF NOT EXISTS approval_bound_drafts AS
SELECT s.* FROM obligation_approval_snapshots s
JOIN approval_current_drafts d ON d.decision_id=s.decision_id AND d.obligation_id=s.obligation_id
 WHERE d.draft_epoch=s.draft_epoch AND d.draft_text=s.draft_text
   AND d.draft_sha256=s.draft_sha256 AND d.origin_platform=s.origin_platform
   AND d.origin_channel=s.origin_channel AND d.origin_thread IS s.origin_thread;

CREATE TABLE IF NOT EXISTS obligation_delivery_claims (
  obligation_id INTEGER NOT NULL,
  decision_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE CHECK(length(token)>0),
  state TEXT NOT NULL CHECK(state IN ('claimed','dispatching','unknown','delivered','cancelled')),
  created_ts INTEGER NOT NULL CHECK(typeof(created_ts)='integer' AND created_ts>=0),
  updated_ts INTEGER NOT NULL CHECK(typeof(updated_ts)='integer' AND updated_ts>=created_ts),
  reconciliation_evidence TEXT,
  PRIMARY KEY(obligation_id, decision_id),
  FOREIGN KEY(obligation_id, decision_id)
    REFERENCES obligation_approval_snapshots(obligation_id, decision_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_claim_per_obligation
ON obligation_delivery_claims(obligation_id) WHERE state IN ('claimed','dispatching','unknown');

CREATE TRIGGER IF NOT EXISTS approval_claim_insert BEFORE INSERT ON obligation_delivery_claims
WHEN NEW.state!='claimed' OR NEW.reconciliation_evidence IS NOT NULL
  OR EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id=NEW.obligation_id AND decision_id=NEW.decision_id)
  OR EXISTS (SELECT 1 FROM obligation_deliveries
              WHERE obligation_id=NEW.obligation_id AND decision_id=NEW.decision_id)
  OR NOT EXISTS (SELECT 1 FROM approval_bound_drafts
                  WHERE obligation_id=NEW.obligation_id AND decision_id=NEW.decision_id)
BEGIN SELECT RAISE(ABORT,'claim requires an unused bound approval'); END;
CREATE TRIGGER IF NOT EXISTS approval_claim_delete BEFORE DELETE ON obligation_delivery_claims
BEGIN SELECT RAISE(ABORT,'claims cannot be erased or reused'); END;
CREATE TRIGGER IF NOT EXISTS approval_claim_update BEFORE UPDATE ON obligation_delivery_claims
BEGIN
  SELECT CASE WHEN NEW.obligation_id IS NOT OLD.obligation_id OR NEW.decision_id IS NOT OLD.decision_id
    OR NEW.token IS NOT OLD.token OR NEW.created_ts IS NOT OLD.created_ts OR NEW.updated_ts<OLD.updated_ts
    THEN RAISE(ABORT,'immutable claim identity or invalid clock') END;
  SELECT CASE WHEN NOT (
    (OLD.state='claimed' AND NEW.state IN ('dispatching','cancelled')) OR
    (OLD.state='dispatching' AND NEW.state IN ('unknown','delivered')) OR
    (OLD.state='unknown' AND NEW.state='delivered'))
    THEN RAISE(ABORT,'claim transition forbidden') END;
  SELECT CASE WHEN OLD.state='unknown' AND NEW.state='delivered'
    AND (NEW.reconciliation_evidence IS NULL OR length(trim(NEW.reconciliation_evidence))=0)
    THEN RAISE(ABORT,'reconciliation evidence required') END;
  SELECT CASE WHEN NOT (OLD.state='unknown' AND NEW.state='delivered')
    AND NEW.reconciliation_evidence IS NOT OLD.reconciliation_evidence
    THEN RAISE(ABORT,'evidence only belongs to reconciliation') END;
  SELECT CASE WHEN NEW.state='dispatching' AND NOT EXISTS (
    SELECT 1 FROM approval_bound_drafts WHERE obligation_id=NEW.obligation_id AND decision_id=NEW.decision_id)
    THEN RAISE(ABORT,'approval binding changed') END;
  SELECT CASE WHEN NEW.state='delivered' AND NOT EXISTS (
    SELECT 1 FROM obligation_deliveries WHERE obligation_id=NEW.obligation_id AND decision_id=NEW.decision_id
      AND kind='draft_sent' AND length(trim(coordinate))>0 AND delivered_ts=NEW.updated_ts)
    THEN RAISE(ABORT,'confirmed receipt required') END;
END;

-- Legacy receipts remain readable/importable when there is no claim. The
-- reference cannot claim an already receipted decision. Claimed receipts are immutable.
CREATE TRIGGER IF NOT EXISTS claimed_receipt_insert BEFORE INSERT ON obligation_deliveries
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims WHERE obligation_id=NEW.obligation_id)
 AND (NEW.kind!='draft_sent' OR length(trim(NEW.coordinate))=0 OR NOT EXISTS (
      SELECT 1 FROM obligation_delivery_claims WHERE obligation_id=NEW.obligation_id
        AND decision_id=NEW.decision_id AND state IN ('dispatching','unknown'))
      OR EXISTS (SELECT 1 FROM obligation_deliveries
                  WHERE id=NEW.id OR (obligation_id=NEW.obligation_id AND decision_id=NEW.decision_id)))
BEGIN SELECT RAISE(ABORT,'receipt requires a matching dispatched claim'); END;
CREATE TRIGGER IF NOT EXISTS claimed_receipt_update BEFORE UPDATE ON obligation_deliveries
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.obligation_id,NEW.obligation_id))
BEGIN SELECT RAISE(ABORT,'claimed receipts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS claimed_receipt_delete BEFORE DELETE ON obligation_deliveries
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims WHERE obligation_id=OLD.obligation_id)
BEGIN SELECT RAISE(ABORT,'claimed receipts are immutable'); END;

-- All writers must preserve active approval binding, including INSERT OR REPLACE.
CREATE TRIGGER IF NOT EXISTS freeze_obligations_insert BEFORE INSERT ON obligations
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (NEW.id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligations_update BEFORE UPDATE ON obligations
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.id,NEW.id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligations_delete BEFORE DELETE ON obligations
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligation_drafts_insert BEFORE INSERT ON obligation_drafts
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (NEW.obligation_id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligation_drafts_update BEFORE UPDATE ON obligation_drafts
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.obligation_id,NEW.obligation_id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligation_drafts_delete BEFORE DELETE ON obligation_drafts
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.obligation_id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligation_decisions_insert BEFORE INSERT ON obligation_decisions
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (NEW.obligation_id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligation_decisions_update BEFORE UPDATE ON obligation_decisions
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.obligation_id,NEW.obligation_id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;
CREATE TRIGGER IF NOT EXISTS freeze_obligation_decisions_delete BEFORE DELETE ON obligation_decisions
WHEN EXISTS (SELECT 1 FROM obligation_delivery_claims
              WHERE obligation_id IN (OLD.obligation_id) AND state IN ('claimed','dispatching','unknown'))
BEGIN SELECT RAISE(ABORT,'active claim freezes approval records'); END;

-- Candidate discovery grants no dispatch permission. claim() validates the hash
-- and reserves in BEGIN IMMEDIATE; begin_dispatch() must then win its own CAS.
-- SELECT b.obligation_id,b.decision_id FROM approval_bound_drafts b
-- WHERE NOT EXISTS (SELECT 1 FROM obligation_delivery_claims c
--                    WHERE c.obligation_id=b.obligation_id AND
--                         (c.decision_id=b.decision_id OR c.state IN ('claimed','dispatching','unknown')))
--   AND NOT EXISTS (SELECT 1 FROM obligation_deliveries r
--                    WHERE r.obligation_id=b.obligation_id AND r.decision_id=b.decision_id);
-- claimed -> dispatching | cancelled; dispatching -> delivered | unknown;
-- unknown -> delivered by explicit reconciliation only. No expiry or retry.
