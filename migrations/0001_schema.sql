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
