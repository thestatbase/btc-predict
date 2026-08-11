-- BTC Signal Notebook v1.4 schema / safe upgrade
-- Run in your Cloudflare D1 console before deploying v1.4.
CREATE TABLE IF NOT EXISTS forecasts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, model_version TEXT NOT NULL, created_at INTEGER NOT NULL, due_at INTEGER NOT NULL,
 horizon_minutes INTEGER NOT NULL, entry_price REAL NOT NULL, probability_up REAL NOT NULL, feature_json TEXT NOT NULL,
 resolved_at INTEGER, exit_price REAL, outcome_up INTEGER CHECK(outcome_up IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_forecast_per_horizon_minute ON forecasts(model_version,created_at,horizon_minutes);
CREATE INDEX IF NOT EXISTS unresolved_due ON forecasts(model_version,resolved_at,due_at);
CREATE INDEX IF NOT EXISTS resolved_by_horizon ON forecasts(model_version,horizon_minutes,resolved_at);
CREATE TABLE IF NOT EXISTS audit_runs (run_at INTEGER PRIMARY KEY,price REAL,status TEXT NOT NULL,detail TEXT);
CREATE TABLE IF NOT EXISTS model_state (
 model_version TEXT NOT NULL,horizon_minutes INTEGER NOT NULL,weights_json TEXT NOT NULL,calibration_json TEXT NOT NULL,
 trained_n INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(model_version,horizon_minutes)
);