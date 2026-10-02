-- Relational mapping of the TRACE investigation document (for a Postgres/Supabase StorageAdapter).
create table users (id uuid primary key, email text unique not null, created_at timestamptz default now());
create table investigations (id text primary key, owner_id uuid references users(id) on delete cascade, title text, mode text, status text, demo bool, conclusion jsonb, created_at timestamptz, updated_at timestamptz);
create table images (id text primary key, investigation_id text references investigations(id) on delete cascade, storage_key text, mime text, width int, height int, sha256 text, enhanced_from text, analysis jsonb);
create table image_regions (id text primary key, image_id text references images(id) on delete cascade, box jsonb, label text);
create table clues (id text primary key, investigation_id text references investigations(id) on delete cascade, image_id text, region_id text, type text, value text, weight real, origin text, engine text, ignored bool);
create table entities (id text primary key, investigation_id text references investigations(id) on delete cascade, name text, type text, wikidata_id text, match_quality text, detected_because jsonb);
create table locations (id text primary key, investigation_id text references investigations(id) on delete cascade, name text, address text, lat double precision, lng double precision, kind text, user_selected bool);
create table candidates (id text primary key, investigation_id text references investigations(id) on delete cascade, location_id text references locations(id), name text, kind text, status text, confidence text, signals jsonb, why jsonb, against jsonb, falsification jsonb);
create table sources (id text primary key, investigation_id text references investigations(id) on delete cascade, title text, url text, publisher text, category text, reliability jsonb, verified bool, used_in_reasoning bool, accessed_at timestamptz);
create table evidence (id text primary key, investigation_id text references investigations(id) on delete cascade, candidate_id text references candidates(id) on delete cascade, kind text, polarity text, strength text, statement text, source_ids text[], clue_ids text[]);
create table search_queries (id text primary key, investigation_id text references investigations(id) on delete cascade, branch text, text text, kind text, provider text, status text, result_count int);
create table search_results (id text primary key, query_id text references search_queries(id) on delete cascade, title text, url text, snippet text, source_id text);
create table timeline_events (id text primary key, investigation_id text references investigations(id) on delete cascade, date text, year int, label text, kind text, candidate_id text, source_ids text[]);
create table chat_messages (id text primary key, investigation_id text references investigations(id) on delete cascade, role text, content text, actions jsonb, created_at timestamptz);
create table notes (id text primary key, investigation_id text references investigations(id) on delete cascade, text text, year_hint int, created_at timestamptz);
create table evidence_connections (id text primary key, investigation_id text references investigations(id) on delete cascade, board_id text, source_node text, target_node text, label text, manual bool);
create table investigation_runs (id text primary key, investigation_id text references investigations(id) on delete cascade, mode text, status text, steps jsonb, started_at timestamptz, finished_at timestamptz);
create table api_usage (id bigserial primary key, provider text, op text, ok bool, ms int, cost_units int, at timestamptz default now());
-- Row-level security: every table is scoped to investigations.owner_id = auth.uid()
alter table investigations enable row level security;
create policy own on investigations using (owner_id = auth.uid());
