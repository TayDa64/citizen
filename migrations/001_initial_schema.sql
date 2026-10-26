-- Citizen Game - Initial Schema
-- PostgreSQL with pgvector recommended for AI features

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Core simulation objects (policies, metrics, events, situations)
CREATE TABLE simulation_objects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL, -- 'policy', 'metric', 'event', 'situation', 'voter_group'
  zone TEXT,
  default_value FLOAT DEFAULT 0.5,
  min_value FLOAT DEFAULT 0,
  max_value FLOAT DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Effects connecting objects (Democracy 4 style)
CREATE TABLE effects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID REFERENCES simulation_objects(id),
  target_id UUID REFERENCES simulation_objects(id),
  formula JSONB NOT NULL,
  direction TEXT DEFAULT 'output',
  is_active BOOLEAN DEFAULT true
);

-- Companies / Startups
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID,
  name TEXT NOT NULL,
  idea TEXT,
  target_market TEXT,
  stage TEXT DEFAULT 'idea',
  cash NUMERIC(14,2) DEFAULT 15000,
  burn_rate NUMERIC(10,2) DEFAULT 0,
  valuation NUMERIC(16,2) DEFAULT 0,
  hype FLOAT DEFAULT 0.3,
  product_quality FLOAT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  founded_at TIMESTAMPTZ DEFAULT now()
);

-- Employees
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT,
  department TEXT, -- 'tech', 'marketing', 'sales'
  salary NUMERIC(10,2),
  skill_tech FLOAT DEFAULT 0.5,
  skill_marketing FLOAT DEFAULT 0.5,
  skill_sales FLOAT DEFAULT 0.5,
  morale FLOAT DEFAULT 0.7,
  happiness FLOAT DEFAULT 0.6,
  is_active BOOLEAN DEFAULT true,
  hired_at TIMESTAMPTZ DEFAULT now()
);

-- Real-world triggers
CREATE TABLE real_world_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  extracted JSONB,
  impact_objects UUID[],
  processed BOOLEAN DEFAULT false
);

-- Indexes for performance
CREATE INDEX idx_effects_source ON effects(source_id);
CREATE INDEX idx_effects_target ON effects(target_id);
CREATE INDEX idx_employees_company ON employees(company_id);
