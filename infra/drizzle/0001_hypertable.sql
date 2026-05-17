-- infra/drizzle/0001_hypertable.sql
-- Runs AFTER Drizzle creates the metrics table (0000_*.sql).
-- Converts metrics into a TimescaleDB hypertable partitioned by time (7-day chunks).
-- After this runs, Drizzle INSERT/SELECT/UPDATE on metrics works identically to a normal table.

SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');

-- Primary query pattern index: get last N minutes for a specific submission
CREATE INDEX IF NOT EXISTS idx_metrics_submission
  ON metrics (submission_id, time DESC);

-- Submissions table indexes (not handled by Drizzle schema to keep schema clean)
CREATE INDEX IF NOT EXISTS idx_submissions_contestant
  ON submissions (contestant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions (status);
