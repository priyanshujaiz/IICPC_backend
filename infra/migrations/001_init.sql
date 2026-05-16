-- Initial migration: Metrics hypertable
CREATE TABLE IF NOT EXISTS metrics (
  time TIMESTAMPTZ NOT NULL,
  submission_id TEXT NOT NULL,
  latency_p50 FLOAT,
  latency_p90 FLOAT,
  latency_p99 FLOAT,
  tps FLOAT,
  correctness_rate FLOAT,
  composite_score FLOAT
);

SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_metrics_submission 
  ON metrics (submission_id, time DESC);