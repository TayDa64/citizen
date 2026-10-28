-- CIT-81: calendar instances (scheduled_meetings) + ingest_runs FK.
-- Additive on top of 006. Does not edit 001–006 in place.
-- Fixture-driven clock rows; expected_url is a seed-time copy of catalog, not the allowlist.

-- migrate:up

CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  jurisdiction_id text NOT NULL REFERENCES jurisdictions (id),
  source_id text NOT NULL,
  external_event_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('meeting', 'publication')),
  starts_at timestamptz NOT NULL,
  timezone text NOT NULL,
  next_check_at timestamptz NOT NULL,
  phase text NOT NULL CHECK (phase IN ('A', 'B', 'C')),
  status text NOT NULL CHECK (status IN (
    'scheduled', 'agenda_due', 'agenda_seen', 'confirmed',
    'minutes_wait', 'ingested', 'unchanged', 'cancelled'
  )),
  fixture_id text,
  expected_url text,
  agenda_url text,
  agenda_published_at timestamptz,
  minutes_url text,
  minutes_published_at timestamptz,
  observed_source_url text,
  last_error text,
  backoff_index integer NOT NULL DEFAULT 0,
  horizon_days integer NOT NULL DEFAULT 60,
  body_name text,
  UNIQUE (source_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_due
  ON scheduled_meetings (status, next_check_at);

ALTER TABLE ingest_runs
  ADD COLUMN IF NOT EXISTS scheduled_meeting_id uuid REFERENCES scheduled_meetings (id);

-- migrate:down

ALTER TABLE ingest_runs
  DROP COLUMN IF EXISTS scheduled_meeting_id;

DROP INDEX IF EXISTS idx_scheduled_meetings_due;
DROP TABLE IF EXISTS scheduled_meetings;
