-- submissions table: durable source of truth for all submission metadata
-- Redis caches this for fast access but this survives Redis restarts

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT        PRIMARY KEY,
  contestant_id   TEXT        NOT NULL,
  language        TEXT        NOT NULL CHECK (language IN ('cpp', 'rust', 'go')),
  artifact_path   TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','building','running','stopped','error')),
  container_host  TEXT,
  container_port  INTEGER,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_submissions_contestant
  ON submissions (contestant_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions (status);
