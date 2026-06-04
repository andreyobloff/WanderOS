CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_profiles_callsign_unique
ON operator_profiles(callsign COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_operator_profiles_callsign_search
ON operator_profiles(callsign COLLATE NOCASE);
