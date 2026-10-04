-- WebScout AI on Supabase: lock down the auto-generated Data API.
-- The application connects as the database owner from the server and enforces
-- workspace isolation + roles in code. Enabling RLS with NO policies for the
-- anon/authenticated roles means PostgREST/GraphQL can read or write nothing.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;
