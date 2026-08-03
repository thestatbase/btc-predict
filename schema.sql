-- BTC Signal Notebook v1.2 — Cloudflare D1 schema
-- One compact forecast per horizon per minute. The index lets resolve/query work avoid full scans.
CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version TEXT NOT NULL DEFAULT 'v1.2',
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  horizon_minutes INTEGER NOT NULL CHECK(horizon_minutes IN (1,5,15,60)),
  entry_price REAL NOT NULL,
  probability_up REAL NOT NULL CHECK(probability_up >= 0 AND probability_up <= 1),
  feature_json TEXT NOT NULL,
  resolved_at INTEGER,
  exit_price REAL,
  outcome_up INTEGER CHECK(outcome_up IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_forecast_per_horizon_minute ON forecasts(model_version, created_at, horizon_minutes);
CREATE INDEX IF NOT EXISTS unresolved_due ON forecasts(resolved_at, due_at);
CREATE INDEX IF NOT EXISTS resolved_horizon_time ON forecasts(horizon_minutes, resolved_at);

-- One row per audit run: exposes liveness and makes failures visible rather than hidden.
CREATE TABLE IF NOT EXISTS audit_runs (
  run_at INTEGER PRIMARY KEY,
  price REAL,
  status TEXT NOT NULL,
  detail TEXT
);