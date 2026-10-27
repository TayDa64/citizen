-- CIT-68: durable ingest audit rows.
-- Additive on top of 004. scheduled_meeting_id waits for migration 007.

-- migrate:up

CREATE TABLE IF NOT EXISTS ingest_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  adapter TEXT,
  fixture_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  changed BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  trigger_client_ids TEXT[] NOT NULL DEFAULT '{}',
  result_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_started_at
  ON ingest_runs (started_at DESC);

-- migrate:down

DROP INDEX IF EXISTS idx_ingest_runs_started_at;
DROP TABLE IF EXISTS ingest_runs;
