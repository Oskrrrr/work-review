CREATE TABLE IF NOT EXISTS worklog_documents (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worklog_documents_collection_idx
  ON worklog_documents (collection);
