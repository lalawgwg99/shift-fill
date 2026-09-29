CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  month TEXT NOT NULL,
  leave_dates TEXT NOT NULL DEFAULT '[]',
  prefs TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, month)
);
CREATE INDEX IF NOT EXISTS idx_submissions_month ON submissions(month);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pins (
  name TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pin_fails (
  name TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  last_fail TEXT NOT NULL DEFAULT (datetime('now'))
);
