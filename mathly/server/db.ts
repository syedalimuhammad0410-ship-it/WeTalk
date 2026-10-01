// SQLite persistence (node:sqlite). Schema is created/migrated on boot.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','parent','teacher','moderator','admin','super_admin')),
  is_guest INTEGER NOT NULL DEFAULT 0,
  oauth_provider TEXT,
  oauth_sub TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_sub) WHERE oauth_provider IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT, guest_user_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🦊',
  color TEXT NOT NULL DEFAULT '#6366f1',
  school_grade INTEGER,
  curriculum TEXT NOT NULL DEFAULT 'us',
  current_course TEXT,
  purposes TEXT NOT NULL DEFAULT '[]',
  enjoys TEXT NOT NULL DEFAULT '[]',
  styles TEXT NOT NULL DEFAULT '[]',
  goals TEXT NOT NULL DEFAULT '[]',
  learning_level REAL,
  onboarded INTEGER NOT NULL DEFAULT 0,
  placement_done INTEGER NOT NULL DEFAULT 0,
  daily_goal_min INTEGER NOT NULL DEFAULT 20,
  preferences TEXT NOT NULL DEFAULT '{}',
  pin_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

CREATE TABLE IF NOT EXISTS mastery (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  explain_score REAL,
  confidence INTEGER,
  estimated INTEGER NOT NULL DEFAULT 0,
  last_practiced TEXT,
  PRIMARY KEY (profile_id, skill_id)
);

CREATE TABLE IF NOT EXISTS issued_questions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  context TEXT,
  hints_used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_issued_profile ON issued_questions(profile_id, created_at);

CREATE TABLE IF NOT EXISTS question_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  time_ms INTEGER,
  hints_used INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER,
  mistake_type TEXT,
  mode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_profile ON question_attempts(profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_skill ON question_attempts(profile_id, skill_id);

CREATE TABLE IF NOT EXISTS lesson_progress (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_key TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'learn',
  status TEXT NOT NULL DEFAULT 'in_progress',
  score REAL,
  data TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, lesson_key)
);

CREATE TABLE IF NOT EXISTS xp_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xp_profile ON xp_transactions(profile_id);

CREATE TABLE IF NOT EXISTS activity_days (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  questions INTEGER NOT NULL DEFAULT 0,
  frozen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, day)
);

CREATE TABLE IF NOT EXISTS user_achievements (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'personal' CHECK (status IN ('personal','pending_review','approved','draft','rejected')),
  request_topic TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_courses_owner ON courses(owner_profile_id);

CREATE TABLE IF NOT EXISTS enrollments (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened TEXT,
  PRIMARY KEY (profile_id, course_id)
);

CREATE TABLE IF NOT EXISTS topic_requests (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  reason TEXT,
  level TEXT,
  style TEXT,
  course_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_topic ON topic_requests(normalized_topic);

CREATE TABLE IF NOT EXISTS homework_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_file TEXT,
  image_mime TEXT,
  problem_text TEXT,
  analysis TEXT,
  step INTEGER NOT NULL DEFAULT 0,
  messages TEXT NOT NULL DEFAULT '[]',
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  topic TEXT,
  skill_id TEXT,
  tasks TEXT NOT NULL DEFAULT '[]',
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_plans (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  test_date TEXT NOT NULL,
  skills TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  plan TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_attempts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  test_plan_id TEXT,
  config TEXT NOT NULL,
  questions TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  score REAL,
  analysis TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS presentation_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  topic_title TEXT NOT NULL,
  mode TEXT NOT NULL,
  transcript TEXT NOT NULL,
  duration_s REAL,
  feedback TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'article',
  skill_ids TEXT NOT NULL DEFAULT '[]',
  domain TEXT,
  difficulty TEXT,
  description TEXT,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(profile_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS daily_challenges (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  question_id TEXT NOT NULL,
  solved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, day)
);

CREATE TABLE IF NOT EXISTS flagged_content (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  kind TEXT NOT NULL,
  ref TEXT,
  snapshot TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  props TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
db.exec(SCHEMA);

// ─────────────────────────────────────────── small typed helpers
type Row = Record<string, unknown>;
export const one = <T = Row>(sql: string, ...params: unknown[]): T | undefined => db.prepare(sql).get(...(params as never[])) as T | undefined;
export const all = <T = Row>(sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...(params as never[])) as T[];
export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]));
export const json = <T>(v: unknown, fallback: T): T => { if (typeof v !== 'string') return fallback; try { return JSON.parse(v) as T; } catch { return fallback; } };
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSetting<T>(key: string, fallback: T): T {
  const r = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return r ? json<T>(r.value, fallback) : fallback;
}
export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function audit(actor: string | null, action: string, target?: string, details?: unknown) {
  run('INSERT INTO audit_logs (actor_user_id, action, target, details) VALUES (?, ?, ?, ?)', actor, action, target ?? null, details ? JSON.stringify(details) : null);
}
