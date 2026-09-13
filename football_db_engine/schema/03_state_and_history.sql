-- Simulation State and History Tables

CREATE TABLE dataset_versions (
    id SERIAL PRIMARY KEY,
    version_name VARCHAR(100) UNIQUE NOT NULL,
    import_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT
);

-- Player dynamic state (separated from master data)
CREATE TABLE player_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    season VARCHAR(20) NOT NULL,
    dataset_version_id INTEGER REFERENCES dataset_versions(id),
    current_club_id UUID REFERENCES clubs(id),
    overall INTEGER CHECK (overall >= 0 AND overall <= 100),
    potential INTEGER CHECK (potential >= 0 AND potential <= 100),
    market_value BIGINT,
    salary BIGINT,
    contract_start DATE,
    contract_end DATE,
    attributes JSONB, -- For granular stats (Technical, Mental, Physical, Goalkeeping)
    form INTEGER DEFAULT 10,
    is_injured BOOLEAN DEFAULT FALSE,
    is_suspended BOOLEAN DEFAULT FALSE,
    manual_override JSONB DEFAULT '{}'::jsonb,
    UNIQUE(player_id, season, dataset_version_id)
);

CREATE TABLE club_finances (
    club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
    season VARCHAR(20) NOT NULL,
    cash_balance BIGINT DEFAULT 0,
    transfer_budget BIGINT DEFAULT 0,
    wage_budget BIGINT DEFAULT 0,
    PRIMARY KEY (club_id, season)
);

CREATE TABLE transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id VARCHAR(50) UNIQUE,
    player_id UUID REFERENCES players(id),
    from_club_id UUID REFERENCES clubs(id),
    to_club_id UUID REFERENCES clubs(id),
    transfer_date DATE NOT NULL,
    season VARCHAR(20),
    transfer_type transfer_type NOT NULL,
    transfer_fee BIGINT,
    status transfer_status DEFAULT 'completed',
    dataset_version_id INTEGER REFERENCES dataset_versions(id)
);

CREATE TABLE player_club_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    transfer_id UUID REFERENCES transfers(id)
);
