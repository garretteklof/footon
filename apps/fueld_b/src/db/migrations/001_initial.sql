CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE messaging_identities (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, external_id)
);
CREATE INDEX messaging_identities_user_id_idx ON messaging_identities(user_id);

CREATE TABLE food_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fdc_id INTEGER NOT NULL,
  food_name TEXT NOT NULL,
  quantity_g REAL NOT NULL CHECK (quantity_g > 0),
  consumed_at TEXT NOT NULL,
  calories_kcal REAL,
  protein_g REAL,
  carbohydrates_g REAL,
  fat_g REAL,
  fiber_g REAL,
  sodium_mg REAL,
  nutrients_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX food_logs_user_consumed_idx ON food_logs(user_id, consumed_at);
