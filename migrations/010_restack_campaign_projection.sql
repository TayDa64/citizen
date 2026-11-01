-- CIT-125 Rank-3: restack audit projection for compensation.
-- Durable restack_campaign_id so findTornMonths Index Scans instead of
-- seq-scanning ingest_runs JSONB. Additive on top of 009.

-- migrate:up

ALTER TABLE ingest_runs
  ADD COLUMN IF NOT EXISTS restack_campaign_id UUID;

-- Backfill from the JSON shapes restackRunsForCampaign already recognized:
-- success → result_json.restack.campaignId; error → restackFailed + campaignId.
UPDATE ingest_runs AS ir
SET restack_campaign_id = sub.cid
FROM (
  SELECT id,
         CASE
           WHEN result_json ? 'restack'
                AND (result_json->'restack'->>'campaignId') ~ '^[0-9a-fA-F-]{36}$'
             THEN (result_json->'restack'->>'campaignId')::uuid
           WHEN result_json->>'restackFailed' = 'true'
                AND (result_json->>'campaignId') ~ '^[0-9a-fA-F-]{36}$'
             THEN (result_json->>'campaignId')::uuid
           ELSE NULL
         END AS cid
  FROM ingest_runs
) AS sub
WHERE ir.id = sub.id
  AND ir.restack_campaign_id IS NULL
  AND sub.cid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingest_runs_restack_campaign
  ON ingest_runs (restack_campaign_id, started_at ASC)
  WHERE restack_campaign_id IS NOT NULL AND finished_at IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS idx_ingest_runs_restack_campaign;
ALTER TABLE ingest_runs DROP COLUMN IF EXISTS restack_campaign_id;
