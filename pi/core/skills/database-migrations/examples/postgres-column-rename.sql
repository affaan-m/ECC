-- Run with psql -X -v ON_ERROR_STOP=1 -f postgres-column-rename.sql.
-- Deterministic write interleavings; only a temporary table is modified.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE rename_demo (
    id bigint PRIMARY KEY,
    username text,
    display_name text
);
INSERT INTO rename_demo VALUES (1, 'before', NULL), (2, NULL, NULL);

-- Old ordering: backfill completes while an old-only writer still exists.
UPDATE rename_demo SET display_name = username WHERE display_name IS NULL;
UPDATE rename_demo SET username = 'after' WHERE id = 1;
-- Retrying a NULL-only backfill cannot repair the stale non-NULL value.
UPDATE rename_demo SET display_name = username WHERE display_name IS NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM rename_demo
        WHERE id = 1 AND username = 'after' AND display_name = 'before'
    ) THEN
        RAISE EXCEPTION 'Expected stale value from backfill-before-dual-write ordering';
    END IF;
    RAISE NOTICE 'PASS: old ordering leaves a stale non-NULL value';
END $$;

-- Reconciliation must handle NULL mismatches in both directions as well.
INSERT INTO rename_demo VALUES (3, NULL, 'stale'), (4, 'source', NULL);

-- From here, assume all old-only writers and their transactions are drained.
-- Every application INSERT/UPDATE supplies both columns atomically.
UPDATE rename_demo SET username = 'dual', display_name = 'dual' WHERE id = 2;
UPDATE rename_demo SET display_name = username
WHERE id > 0 AND id <= 10000 AND display_name IS DISTINCT FROM username;
DO $$
DECLARE
    changed_rows integer;
BEGIN
    IF EXISTS (SELECT 1 FROM rename_demo WHERE display_name IS DISTINCT FROM username) THEN
        RAISE EXCEPTION 'Expected all values to match after reconciliation';
    END IF;
    -- Rerunning a completed batch is a no-op.
    UPDATE rename_demo SET display_name = username
    WHERE id > 0 AND id <= 10000 AND display_name IS DISTINCT FROM username;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 0 THEN
        RAISE EXCEPTION 'Expected idempotent backfill';
    END IF;
    RAISE NOTICE 'PASS: reconciliation repairs stale values and reruns update zero rows';
END $$;

-- A later atomic dual write preserves parity after a completed backfill.
UPDATE rename_demo SET username = 'latest', display_name = 'latest' WHERE id = 1;
-- NULL is a legitimate value in this fixture, not a progress marker.
UPDATE rename_demo SET username = NULL, display_name = NULL WHERE id = 2;
DO $$
DECLARE
    changed_rows integer;
BEGIN
    UPDATE rename_demo SET display_name = username
    WHERE id > 0 AND id <= 10000 AND display_name IS DISTINCT FROM username;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 0 OR EXISTS (
        SELECT 1 FROM rename_demo WHERE display_name IS DISTINCT FROM username
    ) THEN
        RAISE EXCEPTION 'Expected later dual writes and NULL pairs to remain consistent';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM rename_demo WHERE id = 1 AND display_name = 'latest') THEN
        RAISE EXCEPTION 'Backfill lost the newer application value';
    END IF;
    RAISE NOTICE 'PASS: later dual writes, including NULL, survive backfill retries';
END $$;
ROLLBACK;
