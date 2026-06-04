CREATE TABLE IF NOT EXISTS operator_reviews (
  reviewer_chat_id TEXT NOT NULL,
  target_chat_id TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK(vote IN (-1, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(reviewer_chat_id, target_chat_id)
);

CREATE INDEX IF NOT EXISTS idx_operator_reviews_target
ON operator_reviews(target_chat_id);
