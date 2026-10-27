-- CIT-80: jurisdiction nest (federal → state → county → city).
-- Seed rows before FKs so campaigns.home_jurisdiction_id DEFAULT 'mv' succeeds.
-- Peers (e.g. sunnyvale) do not bind Mountain View. Wage triggers backfill to mv.
-- Additive on top of 005. scheduled_meetings waits for migration 007.

-- migrate:up

CREATE TABLE IF NOT EXISTS jurisdictions (
  id text PRIMARY KEY,
  name text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('federal', 'state', 'county', 'city')),
  parent_id text REFERENCES jurisdictions (id)
);

INSERT INTO jurisdictions (id, name, tier, parent_id) VALUES
  ('us', 'United States', 'federal', NULL),
  ('ca', 'California', 'state', 'us'),
  ('sc_county', 'Santa Clara County', 'county', 'ca'),
  ('mv', 'Mountain View', 'city', 'sc_county'),
  ('sunnyvale', 'Sunnyvale', 'city', 'sc_county')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS home_jurisdiction_id text REFERENCES jurisdictions (id) DEFAULT 'mv';

ALTER TABLE real_world_triggers
  ADD COLUMN IF NOT EXISTS jurisdiction_id text REFERENCES jurisdictions (id);

-- Wage bulletin fixture pack binds Mountain View (fail-closed NULL otherwise).
UPDATE real_world_triggers
SET jurisdiction_id = 'mv'
WHERE client_id LIKE 'evt-pipeline-obs-civic-wage-bulletin-%'
  AND (jurisdiction_id IS DISTINCT FROM 'mv');

-- migrate:down

ALTER TABLE real_world_triggers
  DROP COLUMN IF EXISTS jurisdiction_id;

ALTER TABLE campaigns
  DROP COLUMN IF EXISTS home_jurisdiction_id;

DROP TABLE IF EXISTS jurisdictions;
