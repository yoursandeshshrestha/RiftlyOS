-- Finance & Invoicing Schema
-- All amounts stored as integer minor units (pence/cents) to avoid float drift
-- Currency fixed per invoice (£ primary, USD/EUR presentment)

-- ─── Finance enums ──────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE invoice_type AS ENUM ('retainer', 'one_off');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'past_due', 'void', 'uncollectible');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('succeeded', 'pending', 'failed', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_provider AS ENUM ('stripe', 'gocardless');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─── customer (1:1 with a workspace/organization) ──────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  gocardless_customer_id TEXT,
  default_currency TEXT NOT NULL DEFAULT 'gbp',
  vat_number TEXT,
  billing_email TEXT,
  billing_address JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_workspace ON customers(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_workspace ON customers(workspace_id);

-- ─── subscription / retainer ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider payment_provider NOT NULL DEFAULT 'stripe',
  provider_subscription_id TEXT UNIQUE,
  amount INTEGER NOT NULL, -- minor units, recurring
  currency TEXT NOT NULL DEFAULT 'gbp',
  interval TEXT NOT NULL DEFAULT 'month',
  day_of_month INTEGER,
  status subscription_status NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON subscriptions(workspace_id, status);

-- ─── invoice ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type invoice_type NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  provider payment_provider NOT NULL DEFAULT 'stripe',
  provider_invoice_id TEXT UNIQUE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  due_date DATE,
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  hosted_url TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_status ON invoices(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace_issued ON invoices(workspace_id, issued_at);

-- ─── line_item ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL, -- minor units
  tax_amount INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_items_workspace_invoice ON line_items(workspace_id, invoice_id);

-- ─── payment ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  provider payment_provider NOT NULL DEFAULT 'stripe',
  provider_payment_id TEXT UNIQUE,
  amount INTEGER NOT NULL, -- minor units
  currency TEXT NOT NULL DEFAULT 'gbp',
  status payment_status NOT NULL,
  method TEXT,
  fee_amount INTEGER,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_workspace_invoice ON payments(workspace_id, invoice_id);

-- ─── revenue_target table already exists from previous migration ────────────
-- We'll use the existing revenue_targets table (month, target_amount as DECIMAL)
-- TODO: Consider migrating to INTEGER minor units in future

-- ─── stripe_event (idempotency ledger — dedupe webhooks on event.id) ─────────
-- Not tenant-scoped by RLS: written only by service_role webhook worker.

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY, -- Stripe event.id
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  payload JSONB NOT NULL
);

COMMENT ON TABLE stripe_events IS 'Webhook idempotency ledger - dedupes Stripe events by event.id';
