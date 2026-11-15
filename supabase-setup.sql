-- FinanceLog — Supabase Database Setup
-- Run this entire script in your Supabase SQL Editor

-- 1. Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  type          TEXT          NOT NULL CHECK (type IN ('expense', 'income')),
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  category      TEXT          NOT NULL,
  payment_mode  TEXT          CHECK (payment_mode IN ('Cash', 'UPI', 'Credit Card')),
  notes         TEXT,
  date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2. Budget settings table (single row, id always = 1)
CREATE TABLE IF NOT EXISTS budget_settings (
  id              INTEGER       PRIMARY KEY DEFAULT 1,
  monthly_budget  NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 3. Insert default budget row
INSERT INTO budget_settings (id, monthly_budget)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- 4. Enable Row Level Security
ALTER TABLE transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_settings ENABLE ROW LEVEL SECURITY;

-- 5. Allow all operations (personal app — no login required)
CREATE POLICY "Allow all on transactions"
  ON transactions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all on budget_settings"
  ON budget_settings FOR ALL USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════
-- UPGRADE: Spending Limits + EMI Tracker
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- 6. Add weekly budget to existing settings
ALTER TABLE budget_settings
  ADD COLUMN IF NOT EXISTS weekly_budget NUMERIC(10,2) DEFAULT 0;

-- 7. EMI / Loan Tracker table
CREATE TABLE IF NOT EXISTS emi_tracker (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_name         TEXT          NOT NULL,
  loan_icon         TEXT          DEFAULT '🏦',
  total_amount      NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  emi_amount        NUMERIC(10,2) NOT NULL CHECK (emi_amount > 0),
  total_tenure      INTEGER       NOT NULL CHECK (total_tenure > 0),
  remaining_tenure  INTEGER       NOT NULL CHECK (remaining_tenure >= 0),
  total_paid        NUMERIC(12,2) NOT NULL DEFAULT 0,
  start_date        DATE          NOT NULL,
  last_deducted     DATE,
  is_active         BOOLEAN       DEFAULT true,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 8. Enable RLS on emi_tracker
ALTER TABLE emi_tracker ENABLE ROW LEVEL SECURITY;

-- 9. Allow all operations on emi_tracker (personal app)
CREATE POLICY "Allow all on emi_tracker"
  ON emi_tracker FOR ALL USING (true) WITH CHECK (true);
