-- Nuvio Quoting Portal v2 — users, OTP, key-value store
-- Run via: npm run migrate

-- Users table for per-user accounts + JWT sessions
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  pass_hash      TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  commission     NUMERIC(5,2) DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time passwords for login flow
CREATE TABLE IF NOT EXISTS otp_codes (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL,
  code           TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);

-- Key-value store for blob data (costs, users list, POs, clients, etc.)
CREATE TABLE IF NOT EXISTS kv_store (
  key            TEXT PRIMARY KEY,
  value          JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
