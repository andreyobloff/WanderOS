CREATE TABLE IF NOT EXISTS users (
  chat_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  language_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  chat_id TEXT PRIMARY KEY,
  city TEXT NOT NULL DEFAULT 'Москва',
  base_lat REAL,
  base_lon REAL,
  base_label TEXT,
  radius_m INTEGER NOT NULL DEFAULT 1200,
  mood TEXT NOT NULL DEFAULT 'liminal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin_lat REAL NOT NULL,
  origin_lon REAL NOT NULL,
  target_lat REAL NOT NULL,
  target_lon REAL NOT NULL,
  radius_m INTEGER NOT NULL,
  title TEXT,
  omen TEXT,
  map_url TEXT,
  route_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ui_state (
  chat_id TEXT PRIMARY KEY,
  active_message_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ui_messages (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS user_state (
  chat_id TEXT PRIMARY KEY,
  mode TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routes_chat_created
ON routes(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ui_messages_chat_created
ON ui_messages(chat_id, created_at DESC);
