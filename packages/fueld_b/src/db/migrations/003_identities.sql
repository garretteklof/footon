CREATE TABLE identities (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (platform, external_id)
);
CREATE INDEX identities_user_id_idx ON identities(user_id);

INSERT INTO identities (user_id, platform, external_id, created_at)
SELECT user_id, provider, external_id, created_at FROM messaging_identities;

DROP TABLE messaging_identities;
