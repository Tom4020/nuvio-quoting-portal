-- Nuvio Quoting Portal — initial schema
-- Run via: npm run migrate

CREATE TABLE IF NOT EXISTS customers (
  id           SERIAL PRIMARY KEY,
  shopify_id   BIGINT UNIQUE,
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  company      TEXT,
  address      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
  id            SERIAL PRIMARY KEY,
  quote_number  TEXT UNIQUE NOT NULL,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
  currency      TEXT NOT NULL DEFAULT 'AUD',
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate      NUMERIC(5,4)  NOT NULL DEFAULT 0.10, -- 10% GST
  tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  valid_until   DATE,
  created_by    TEXT,
  shopify_draft_order_id BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id             SERIAL PRIMARY KEY,
  quote_id       INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  shopify_variant_id BIGINT,
  sku            TEXT,
  title          TEXT NOT NULL,
  description    TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON quote_items(quote_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  address      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            SERIAL PRIMARY KEY,
  po_number     TEXT UNIQUE NOT NULL,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','partial','received','cancelled')),
  currency      TEXT NOT NULL DEFAULT 'AUD',
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax           NUMERIC(12,2) NOT NULL DEFAULT 0,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_date DATE,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku               TEXT,
  title             TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  qty_received      INTEGER NOT NULL DEFAULT 0,
  unit_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  position          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items(purchase_order_id);

-- Order management: mirrors Shopify orders we care about + our internal fulfilment state
CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  shopify_order_id    BIGINT UNIQUE,
  order_number        TEXT,
  customer_id         INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  source_quote_id     INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','processing','packed','shipped','delivered','cancelled')),
  total               NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at triggers
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'quotes_updated_at') THEN
    CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pos_updated_at') THEN
    CREATE TRIGGER pos_updated_at BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_updated_at') THEN
    CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
