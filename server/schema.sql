CREATE TABLE IF NOT EXISTS reminders (
  device TEXT NOT NULL,
  idea   TEXT NOT NULL,
  at     INTEGER NOT NULL,
  sub    TEXT NOT NULL,
  sent   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device, idea)
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (sent, at);
