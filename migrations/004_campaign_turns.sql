-- Authoritative campaign GameState + atomic turn commit ledger.
-- Additive on top of 003. Client sim and server share turnEngine.js.

-- migrate:up

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seed TEXT NOT NULL DEFAULT 'default',
  rule_version TEXT NOT NULL DEFAULT 'citizen-slice2-v1',
  state_version INTEGER NOT NULL DEFAULT 1,
  turn INTEGER NOT NULL DEFAULT 0 CHECK (turn >= 0),
  tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  state_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_updated_at ON campaigns (updated_at DESC);

CREATE TABLE IF NOT EXISTS turn_commits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  turn_before INTEGER NOT NULL CHECK (turn_before >= 0),
  turn_after INTEGER NOT NULL CHECK (turn_after >= 0),
  command_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_turn_commits_campaign_seq
  ON turn_commits (campaign_id, seq);

-- migrate:down

DROP INDEX IF EXISTS idx_turn_commits_campaign_seq;
DROP TABLE IF EXISTS turn_commits;
DROP INDEX IF EXISTS idx_campaigns_updated_at;
DROP TABLE IF EXISTS campaigns;
