-- The migration runner creates tables with its own owner. Cloud Functions use
-- CloudBase's service_role for server-side RDB access, so grant that role the
-- minimum permissions needed by the document compatibility layer.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.worklog_documents TO service_role;
