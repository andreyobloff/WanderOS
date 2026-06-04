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

CREATE TABLE IF NOT EXISTS operator_profiles (
  chat_id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  age INTEGER NOT NULL,
  sex TEXT NOT NULL,
  bio TEXT NOT NULL,
  photo_file_id TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cooperations (
  id TEXT PRIMARY KEY,
  requester_chat_id TEXT NOT NULL,
  target_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_cards (
  route_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  summary TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_media (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  file_id TEXT NOT NULL,
  duration INTEGER,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_state (
  chat_id TEXT PRIMARY KEY,
  mode TEXT,
  payload_json TEXT,
  updated_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_routes_chat_created
ON routes(chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_visible
ON operator_profiles(is_visible);

CREATE INDEX IF NOT EXISTS idx_coop_requester
ON cooperations(requester_chat_id, status);

CREATE INDEX IF NOT EXISTS idx_coop_target
ON cooperations(target_chat_id, status);

CREATE INDEX IF NOT EXISTS idx_trace_media_route
ON trace_media(route_id, position);

CREATE INDEX IF NOT EXISTS idx_ui_messages_chat_created
ON ui_messages(chat_id, created_at DESC);
