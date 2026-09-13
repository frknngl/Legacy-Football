-- Canonical Entity Tables

CREATE TABLE leagues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(50) UNIQUE,
    game_name VARCHAR(100) NOT NULL,
    source_name VARCHAR(100),
    country VARCHAR(100),
    level INTEGER,
    reputation INTEGER CHECK (reputation >= 0 AND reputation <= 10000),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER set_timestamp_leagues BEFORE UPDATE ON leagues FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TABLE clubs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(50) UNIQUE,
    game_name VARCHAR(100) NOT NULL,
    source_name VARCHAR(100),
    country VARCHAR(100),
    league_id UUID REFERENCES leagues(id),
    stadium_capacity INTEGER DEFAULT 0,
    training_facilities INTEGER CHECK (training_facilities >= 0 AND training_facilities <= 20),
    youth_facilities INTEGER CHECK (youth_facilities >= 0 AND youth_facilities <= 20),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER set_timestamp_clubs BEFORE UPDATE ON clubs FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(50) UNIQUE,
    game_name VARCHAR(100) NOT NULL,
    source_name VARCHAR(100),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    birth_date DATE,
    nationality VARCHAR(100),
    secondary_nationality VARCHAR(100),
    height DECIMAL(5,2),
    weight DECIMAL(5,2),
    preferred_foot foot_preference,
    primary_position VARCHAR(50),
    secondary_positions VARCHAR(50)[],
    manual_override JSONB DEFAULT '{}'::jsonb, -- Track fields overridden in editor
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE TRIGGER set_timestamp_players BEFORE UPDATE ON players FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Entity Identity Map to handle dataset version changes
CREATE TABLE entity_identity_map (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL, -- 'player', 'club', 'league'
    canonical_id UUID NOT NULL,
    source_dataset VARCHAR(50) NOT NULL,
    source_id VARCHAR(50) NOT NULL,
    source_name VARCHAR(100),
    matching_confidence DECIMAL(5,2), -- e.g., 98.5 for high confidence
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_dataset, source_id, entity_type)
);
