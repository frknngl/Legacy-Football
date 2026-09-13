-- PostgreSQL Core Schema Setup

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy string matching

-- Enums
CREATE TYPE foot_preference AS ENUM ('left', 'right', 'both');
CREATE TYPE transfer_type AS ENUM ('permanent', 'loan', 'loan_return', 'free_transfer', 'youth_promotion', 'retirement', 'release', 'contract_expiry', 'transfer_cancelled');
CREATE TYPE transfer_status AS ENUM ('rumour', 'negotiating', 'agreed', 'completed', 'cancelled', 'failed');
CREATE TYPE competition_type AS ENUM ('domestic_league', 'domestic_cup', 'super_cup', 'continental', 'international', 'friendly');

CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(50) UNIQUE NOT NULL, -- Original ID from CSV
    game_name VARCHAR(100) NOT NULL, -- License-safe name
    source_name VARCHAR(100) NOT NULL, -- Original name
    birth_date DATE,
    nationality VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    manual_override JSONB DEFAULT '{}'::jsonb -- Stores user edits
);

-- Coaches (NEW)
CREATE TABLE IF NOT EXISTS coaches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(50) UNIQUE NOT NULL,
    game_name VARCHAR(100) NOT NULL,
    source_name VARCHAR(100) NOT NULL,
    birth_date DATE,
    nationality VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    manual_override JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS clubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id VARCHAR(50) UNIQUE NOT NULL,
    game_name VARCHAR(100) NOT NULL,
    source_name VARCHAR(100) NOT NULL,
    country VARCHAR(50),
    manager_id UUID REFERENCES coaches(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    manual_override JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS coach_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
    club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    manual_override JSONB DEFAULT '{}'::jsonb
);

-- Audit trailing function
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
