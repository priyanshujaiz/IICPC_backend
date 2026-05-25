-- Migration 0002: users table
-- Stores registered contestants and admins.
-- contestantId in submissions table (TEXT) references users.id as a soft FK.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT        PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'contestant'
                            CHECK (role IN ('admin', 'contestant')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast login lookup by username
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
