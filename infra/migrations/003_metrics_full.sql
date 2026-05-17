-- Adds cumulative order tracking columns to metrics hypertable
-- Also enforces NOT NULL on all metric columns with 0 defaults

ALTER TABLE metrics
  ADD COLUMN IF NOT EXISTS total_orders  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_fills BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fills   BIGINT NOT NULL DEFAULT 0;

ALTER TABLE metrics
  ALTER COLUMN latency_p50      SET DEFAULT 0,
  ALTER COLUMN latency_p90      SET DEFAULT 0,
  ALTER COLUMN latency_p99      SET DEFAULT 0,
  ALTER COLUMN tps              SET DEFAULT 0,
  ALTER COLUMN correctness_rate SET DEFAULT 0,
  ALTER COLUMN composite_score  SET DEFAULT 0;

UPDATE metrics SET
  latency_p50      = 0 WHERE latency_p50      IS NULL;
UPDATE metrics SET
  latency_p90      = 0 WHERE latency_p90      IS NULL;
UPDATE metrics SET
  latency_p99      = 0 WHERE latency_p99      IS NULL;
UPDATE metrics SET
  tps              = 0 WHERE tps              IS NULL;
UPDATE metrics SET
  correctness_rate = 0 WHERE correctness_rate IS NULL;
UPDATE metrics SET
  composite_score  = 0 WHERE composite_score  IS NULL;

ALTER TABLE metrics
  ALTER COLUMN latency_p50      SET NOT NULL,
  ALTER COLUMN latency_p90      SET NOT NULL,
  ALTER COLUMN latency_p99      SET NOT NULL,
  ALTER COLUMN tps              SET NOT NULL,
  ALTER COLUMN correctness_rate SET NOT NULL,
  ALTER COLUMN composite_score  SET NOT NULL;
