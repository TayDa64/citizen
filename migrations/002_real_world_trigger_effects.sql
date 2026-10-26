-- Slice 2: store real-world trigger labels and apply hype / talent-cost effects.
-- Expand-only. Existing rows stay valid: new columns are nullable, except
-- companies.talent_cost, which has a constant default so current inserts that
-- omit the column keep working.

-- migrate:up

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS talent_cost NUMERIC(12,2) DEFAULT 4000;

ALTER TABLE real_world_triggers
  ADD COLUMN IF NOT EXISTS trigger_type TEXT;

ALTER TABLE real_world_triggers
  ADD COLUMN IF NOT EXISTS label TEXT;

ALTER TABLE real_world_triggers
  DROP CONSTRAINT IF EXISTS real_world_triggers_type_check;

ALTER TABLE real_world_triggers
  ADD CONSTRAINT real_world_triggers_type_check
  CHECK (trigger_type IS NULL OR trigger_type IN ('news', 'market', 'talent', 'policy'));

ALTER TABLE effects
  ADD COLUMN IF NOT EXISTS trigger_id UUID REFERENCES real_world_triggers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_effects_trigger ON effects(trigger_id);

-- migrate:down

DROP INDEX IF EXISTS idx_effects_trigger;

ALTER TABLE effects
  DROP COLUMN IF EXISTS trigger_id;

ALTER TABLE real_world_triggers
  DROP CONSTRAINT IF EXISTS real_world_triggers_type_check;

ALTER TABLE real_world_triggers
  DROP COLUMN IF EXISTS label;

ALTER TABLE real_world_triggers
  DROP COLUMN IF EXISTS trigger_type;

ALTER TABLE companies
  DROP COLUMN IF EXISTS talent_cost;
