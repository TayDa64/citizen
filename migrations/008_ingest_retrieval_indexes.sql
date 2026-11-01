-- CIT-120 Rank-1: hot-read indexes for nest filter, calendar board, ingest FK.
-- Additive on top of 007. Does not edit 001–007 in place.

-- migrate:up

CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_jurisdiction_starts
  ON scheduled_meetings (jurisdiction_id, starts_at ASC, source_id ASC, external_event_id ASC);

CREATE INDEX IF NOT EXISTS idx_real_world_triggers_jurisdiction
  ON real_world_triggers (jurisdiction_id);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_scheduled_meeting
  ON ingest_runs (scheduled_meeting_id)
  WHERE scheduled_meeting_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS idx_ingest_runs_scheduled_meeting;
DROP INDEX IF EXISTS idx_real_world_triggers_jurisdiction;
DROP INDEX IF EXISTS idx_scheduled_meetings_jurisdiction_starts;
