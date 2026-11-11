CREATE TABLE IF NOT EXISTS signed_agreements (
  mode TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  token TEXT NOT NULL,
  number TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  final_hash TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (mode, token)
);
CREATE UNIQUE INDEX IF NOT EXISTS signed_agreements_number ON signed_agreements (mode, number);
