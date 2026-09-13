-- Raw Staging Tables for Dataset Import
-- These match the CSV structures closely.

CREATE TABLE raw_players (
    player_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(200),
    date_of_birth DATE,
    nationality VARCHAR(100),
    height DECIMAL(5,2),
    position VARCHAR(50),
    foot VARCHAR(20),
    current_club_id VARCHAR(50),
    contract_expires DATE
);

CREATE TABLE raw_clubs (
    club_id VARCHAR(50) PRIMARY KEY,
    club_name VARCHAR(200),
    country_name VARCHAR(100),
    league_id VARCHAR(50)
);

CREATE TABLE raw_transfers (
    transfer_id SERIAL PRIMARY KEY,
    player_id VARCHAR(50),
    transfer_date DATE,
    season_name VARCHAR(50),
    from_team_id VARCHAR(50),
    to_team_id VARCHAR(50),
    transfer_type VARCHAR(100),
    transfer_fee VARCHAR(50)
);
