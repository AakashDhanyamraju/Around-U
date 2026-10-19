-- Report resolutions carry a record, not just a status.
--
-- The moderation surface promises "every resolution is written to the log with
-- your name". Until now `resolve_report` only wrote `status`, `handled_by` and
-- `handled_at`, so the reviewer's reasoning — the part another moderator needs
-- when the same account comes back — was thrown away.
--
-- `resolution` is the specific action taken ('hidden', 'no_action', ...), which
-- is finer-grained than the two-value `status` and lets the queue distinguish
-- "looked and it was fine" from "removed it".

ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution      TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- Welfare reports are triaged ahead of everything else, so the open queue is
-- read reason-first. A partial index keeps it to the rows the queue actually
-- scans.
CREATE INDEX IF NOT EXISTS idx_reports_open_priority
  ON reports ((reason = 'self_harm') DESC, created_at DESC)
  WHERE status = 'open';
