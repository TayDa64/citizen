-- TRIGGER_CONTRACT v1. Additive on top of 002.
-- client_id is the wire id. The UUID primary key stays, so rows written
-- before this column existed remain valid (UNIQUE allows many NULLs).
-- The type check grows. It still allows NULL and the 002 values
-- news, market, talent, and policy. The API allowlist is v1-only.

-- migrate:up

ALTER TABLE real_world_triggers
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE real_world_triggers
  DROP CONSTRAINT IF EXISTS real_world_triggers_client_id_key;

ALTER TABLE real_world_triggers
  ADD CONSTRAINT real_world_triggers_client_id_key UNIQUE (client_id);

ALTER TABLE real_world_triggers
  DROP CONSTRAINT IF EXISTS real_world_triggers_type_check;

ALTER TABLE real_world_triggers
  ADD CONSTRAINT real_world_triggers_type_check
  CHECK (
    trigger_type IS NULL
    OR trigger_type IN (
      'news', 'market', 'talent', 'policy',
      'news_spike', 'policy_change', 'market_shift'
    )
  );

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS hype_baseline DOUBLE PRECISION;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS talent_cost_baseline NUMERIC(12,2);

-- migrate:down

UPDATE real_world_triggers
SET trigger_type = NULL
WHERE trigger_type IN ('news_spike', 'policy_change', 'market_shift');

ALTER TABLE companies
  DROP COLUMN IF EXISTS talent_cost_baseline;

ALTER TABLE companies
  DROP COLUMN IF EXISTS hype_baseline;

ALTER TABLE real_world_triggers
  DROP CONSTRAINT IF EXISTS real_world_triggers_client_id_key;

ALTER TABLE real_world_triggers
  DROP COLUMN IF EXISTS client_id;

ALTER TABLE real_world_triggers
  DROP CONSTRAINT IF EXISTS real_world_triggers_type_check;

ALTER TABLE real_world_triggers
  ADD CONSTRAINT real_world_triggers_type_check
  CHECK (trigger_type IS NULL OR trigger_type IN ('news', 'market', 'talent', 'policy'));
