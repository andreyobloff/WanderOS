CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  value_points INTEGER NOT NULL DEFAULT 0,
  created_by_chat_id TEXT NOT NULL,
  created_route_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anomaly_findings (
  id TEXT PRIMARY KEY,
  anomaly_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  finder_chat_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(anomaly_id, route_id, finder_chat_id)
);

CREATE TABLE IF NOT EXISTS anomaly_media (
  id TEXT PRIMARY KEY,
  anomaly_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  file_id TEXT NOT NULL,
  duration INTEGER,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS researches (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  value_points INTEGER NOT NULL DEFAULT 0,
  created_by_chat_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_links (
  id TEXT PRIMARY KEY,
  research_id TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK(link_type IN ('trace', 'anomaly')),
  link_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(research_id, link_type, link_id)
);

CREATE TABLE IF NOT EXISTS research_media (
  id TEXT PRIMARY KEY,
  research_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  file_id TEXT NOT NULL,
  duration INTEGER,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_notes (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_reviews (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('anomaly', 'research')),
  entity_id TEXT NOT NULL,
  reviewer_chat_id TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id, reviewer_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_anomalies_title ON anomalies(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_anomaly_findings_geo ON anomaly_findings(lat, lon);
CREATE INDEX IF NOT EXISTS idx_anomaly_findings_anomaly ON anomaly_findings(anomaly_id);
CREATE INDEX IF NOT EXISTS idx_researches_title ON researches(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_research_links_research ON research_links(research_id, position);
CREATE INDEX IF NOT EXISTS idx_entity_reviews_entity ON entity_reviews(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_card_notes_chat ON card_notes(chat_id, created_at DESC);
