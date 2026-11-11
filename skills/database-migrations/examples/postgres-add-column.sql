-- PostgreSQL 11+; run with psql -X -v ON_ERROR_STOP=1 -f postgres-add-column.sql
-- Do not use --single-transaction: fixture creation must commit before the lock check.
-- Uses only a temporary table; rolls back ALTERs and drops the fixture.
\set ON_ERROR_STOP on
CREATE TEMP TABLE add_column_demo (id integer);
INSERT INTO add_column_demo VALUES (1), (2);

-- Commit fixture creation before checking the lock acquired by ALTER TABLE.
BEGIN;

DO $$
DECLARE
    original_file oid := pg_relation_filenode('add_column_demo');
BEGIN
    ALTER TABLE add_column_demo ADD COLUMN avatar_url text;
    IF pg_relation_filenode('add_column_demo') <> original_file THEN
        RAISE EXCEPTION 'Nullable ADD COLUMN unexpectedly rewrote the table';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE relation = 'add_column_demo'::regclass
          AND pid = pg_backend_pid()
          AND mode = 'AccessExclusiveLock' AND granted
    ) THEN
        RAISE EXCEPTION 'Expected AccessExclusiveLock after ADD COLUMN';
    END IF;
    RAISE NOTICE 'PASS: nullable ADD COLUMN takes AccessExclusiveLock without a rewrite';

    ALTER TABLE add_column_demo ADD COLUMN is_active boolean NOT NULL DEFAULT true;
    IF pg_relation_filenode('add_column_demo') <> original_file
       OR EXISTS (SELECT 1 FROM add_column_demo WHERE is_active IS DISTINCT FROM true) THEN
        RAISE EXCEPTION 'Expected constant default without a table rewrite';
    END IF;
    RAISE NOTICE 'PASS: constant default supplies existing rows without a rewrite';

    BEGIN
        ALTER TABLE add_column_demo ADD COLUMN role text NOT NULL;
        RAISE EXCEPTION 'Expected NOT NULL violation on populated table';
    EXCEPTION WHEN not_null_violation THEN
        RAISE NOTICE 'PASS: NOT NULL without default fails with SQLSTATE 23502';
    END;

    ALTER TABLE add_column_demo ADD COLUMN sampled_at timestamptz DEFAULT clock_timestamp();
    IF pg_relation_filenode('add_column_demo') = original_file THEN
        RAISE EXCEPTION 'Expected volatile default to rewrite the table';
    END IF;
    RAISE NOTICE 'PASS: volatile default rewrites the table';
END $$;
ROLLBACK;
DROP TABLE add_column_demo;
