-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  age_range_label TEXT,
  table_count INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tables
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  table_number INTEGER NOT NULL,
  display_label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category_id, table_number)
);

-- Passations
CREATE TABLE IF NOT EXISTS passations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  student_names TEXT,
  coach_name TEXT,
  parent_name TEXT,
  parent_contact TEXT,
  category_id UUID NOT NULL REFERENCES categories(id),
  table_id UUID NOT NULL REFERENCES tables(id),
  scheduled_time TIMESTAMPTZ,
  queue_position INTEGER NOT NULL DEFAULT 0,
  live_status TEXT NOT NULL DEFAULT 'Scheduled',
  final_result_status TEXT,
  score NUMERIC,
  time_seconds INTEGER,
  notes TEXT,
  signature_image TEXT,
  judge_name TEXT,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable realtime
ALTER TABLE passations REPLICA IDENTITY FULL;
ALTER TABLE categories REPLICA IDENTITY FULL;
ALTER TABLE tables REPLICA IDENTITY FULL;

-- Seed default categories
INSERT INTO categories (name, age_range_label, table_count) VALUES
  ('Sportswonderland', '4–5 years old', 5),
  ('Sportswonderland', '6–7 years old', 5),
  ('Capelli Soccer', '', 3),
  ('Capelli Inspire', '8–9 years old', 5),
  ('Capelli Inspire', '10–12 years old', 5),
  ('Capelli Starter', '13–15 years old', 5),
  ('MakeX Inspire', '8–12 years old', 5),
  ('MakeX Starter', '11–13 years old', 1);
