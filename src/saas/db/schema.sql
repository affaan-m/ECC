-- Incident Response SaaS — Postgres Schema
-- Run: psql $DATABASE_URL -f schema.sql

-- ─────────────────────────────────────────
-- Multi-tenant Organizations
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,           -- used in webhook URLs
  plan          TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','team','enterprise')),
  stripe_customer_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Users (belong to one org)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','readonly')),
  oncall        BOOLEAN NOT NULL DEFAULT FALSE, -- currently on-call?
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- ─────────────────────────────────────────
-- Alert Sources (Datadog, PagerDuty, etc.)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                  -- "Production Datadog"
  type          TEXT NOT NULL CHECK (type IN ('datadog','pagerduty','cloudwatch','prometheus','grafana','custom')),
  webhook_token TEXT NOT NULL UNIQUE,           -- secret token in webhook URL
  config        JSONB NOT NULL DEFAULT '{}',    -- source-specific config (sanitized)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_org ON alert_sources(org_id);

-- ─────────────────────────────────────────
-- Incidents
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_id     UUID REFERENCES alert_sources(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  service       TEXT NOT NULL,
  severity      INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),  -- 1=SEV1 ... 4=SEV4
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','mitigating','resolved')),
  source_type   TEXT,                           -- datadog | pagerduty | etc.
  source_alert_id TEXT,                         -- external alert ID for dedup
  raw_payload   JSONB,                          -- original webhook payload (sanitized)
  summary       TEXT,                           -- AI-generated triage summary
  root_cause    TEXT,                           -- AI-identified root cause
  mitigation    TEXT,                           -- action taken
  resolved_at   TIMESTAMPTZ,
  duration_secs INTEGER GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (resolved_at - created_at))::INTEGER
  ) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_org       ON incidents(org_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status    ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_severity  ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_created   ON incidents(created_at DESC);
-- Prevent duplicate ingestion of the same external alert
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_source_dedup
  ON incidents(org_id, source_type, source_alert_id)
  WHERE source_alert_id IS NOT NULL;

-- ─────────────────────────────────────────
-- Incident Timeline Events
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incident_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor         TEXT NOT NULL DEFAULT 'ai',    -- 'ai' | user email
  event_type    TEXT NOT NULL CHECK (event_type IN (
                  'alert_received','triage','diagnosis','mitigation',
                  'status_change','notification_sent','postmortem','comment'
                )),
  message       TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_incident ON incident_events(incident_id, created_at);

-- ─────────────────────────────────────────
-- Postmortems
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS postmortems (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   UUID NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  summary       TEXT,
  timeline      JSONB NOT NULL DEFAULT '[]',   -- [{time, event}]
  root_cause    TEXT,
  contributing_factors TEXT[],
  what_went_well TEXT[],
  action_items  JSONB NOT NULL DEFAULT '[]',   -- [{action, owner, due_date, priority}]
  lessons_learned TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postmortems_org ON postmortems(org_id);

-- ─────────────────────────────────────────
-- Notification Channels (Slack, email, etc.)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('slack','email','pagerduty','webhook')),
  config        JSONB NOT NULL DEFAULT '{}',   -- webhook_url, email, etc. (encrypted at app layer)
  min_severity  INTEGER NOT NULL DEFAULT 2 CHECK (min_severity BETWEEN 1 AND 4),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_org ON notification_channels(org_id);

-- ─────────────────────────────────────────
-- Audit Log (immutable)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  org_id        UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,                 -- 'incident.created', 'user.login', etc.
  resource_type TEXT,
  resource_id   UUID,
  ip_address    INET,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_org     ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);

-- ─────────────────────────────────────────
-- API Keys (for programmatic access)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,          -- bcrypt hash of the key
  key_prefix    TEXT NOT NULL,                 -- first 8 chars for display (e.g. "ira_live")
  scopes        TEXT[] NOT NULL DEFAULT '{}',  -- ['incidents:read', 'incidents:write']
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apikeys_org ON api_keys(org_id);

-- ─────────────────────────────────────────
-- Runbooks
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runbooks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global/built-in
  title         TEXT NOT NULL,
  scenario      TEXT NOT NULL,                 -- 'high-error-rate', 'db-connection-exhaustion'
  content       TEXT NOT NULL,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  builtin       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runbooks_org      ON runbooks(org_id);
CREATE INDEX IF NOT EXISTS idx_runbooks_scenario ON runbooks(scenario);

-- ─────────────────────────────────────────
-- Update timestamp trigger
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['organizations','incidents','postmortems','runbooks'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
       CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', tbl, tbl
    );
  END LOOP;
END;
$$;
