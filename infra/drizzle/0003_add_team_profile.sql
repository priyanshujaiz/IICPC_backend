-- Migration 0003: Add team_name and email to users table
-- team_name is the human-readable display name for leaderboard/dashboard
-- email is optional contact information

ALTER TABLE users ADD COLUMN IF NOT EXISTS team_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill existing rows: set team_name = username for anyone who registered before this migration
UPDATE users SET team_name = username WHERE team_name IS NULL;

-- Now make team_name NOT NULL after backfill
ALTER TABLE users ALTER COLUMN team_name SET NOT NULL;
