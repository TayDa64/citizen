-- CIT-123 Rank-2: index-friendly due-row sweep predicate.
-- Partial index matches OPEN_MEETING_STATUSES (non-terminal) so
-- next_check_at <= now AND status = ANY(open[]) can Index Scan.
-- Additive on top of 008. Does not edit 001–008 in place.

-- migrate:up

CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_due_open
  ON scheduled_meetings (next_check_at ASC, source_id ASC, external_event_id ASC)
  WHERE status NOT IN ('cancelled', 'ingested', 'unchanged');

-- migrate:down

DROP INDEX IF EXISTS idx_scheduled_meetings_due_open;
