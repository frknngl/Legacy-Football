import sqlite3
import pandas as pd
import uuid
import os
import json

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fm_database.db")
BASE_DIR = r"c:\Users\Mirac\Downloads\archive"

def generate_fake_name(real_name):
    if not real_name or not isinstance(real_name, str):
        return ""
    words = real_name.split()
    if not words: return ""
    last_word = words[-1]
    # Simple PES-style obfuscation
    last_word = last_word.replace('a', 'o', 1).replace('e', 'a', 1).replace('i', 'e', 1)
    if last_word == words[-1]:
        last_word += "es"
    words[-1] = last_word
    return " ".join(words)

def setup_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Drop existing tables for fresh schema
    cursor.executescript("""
    DROP TABLE IF EXISTS player_state;
    DROP TABLE IF EXISTS transfers;
    DROP TABLE IF EXISTS players;
    DROP TABLE IF EXISTS coaches;
    DROP TABLE IF EXISTS clubs;
    """)
    
    # 2. Create Core Tables
    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS players (

        id TEXT PRIMARY KEY,
        source_id TEXT UNIQUE NOT NULL,
        short_name TEXT NOT NULL,
        long_name TEXT NOT NULL,
        fake_name TEXT NOT NULL,
        birth_date TEXT,
        nationality TEXT,
        manual_override TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS coaches (
        id TEXT PRIMARY KEY,
        source_id TEXT UNIQUE NOT NULL,
        short_name TEXT NOT NULL,
        long_name TEXT NOT NULL,
        birth_date TEXT,
        nationality TEXT,
        manual_override TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS clubs (
        id TEXT PRIMARY KEY,
        source_id TEXT UNIQUE NOT NULL,
        club_name TEXT NOT NULL,
        country TEXT,
        manager_id TEXT,
        manual_override TEXT DEFAULT '{}',
        FOREIGN KEY (manager_id) REFERENCES coaches(id)
    );

    -- Simulation Data
    CREATE TABLE IF NOT EXISTS player_state (
        id TEXT PRIMARY KEY,
        player_id TEXT,
        club_id TEXT,
        overall INTEGER,
        potential INTEGER,
        value_eur REAL,
        wage_eur REAL,
        player_face_url TEXT,
        attributes TEXT, -- JSON holding pace, shooting, passing etc.
        FOREIGN KEY (player_id) REFERENCES players(id),
        FOREIGN KEY (club_id) REFERENCES clubs(id)
    );
    
    CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY,
        player_id TEXT,
        from_club_id TEXT,
        to_club_id TEXT,
        fee REAL,
        transfer_date TEXT
    );
    """)
    
    # 2. Create FTS5 Virtual Tables for Search
    cursor.executescript("""
    DROP TABLE IF EXISTS players_fts;
    CREATE VIRTUAL TABLE players_fts USING fts5(
        id UNINDEXED, 
        short_name, 
        long_name,
        fake_name,
        source_id
    );
    
    DROP TABLE IF EXISTS clubs_fts;
    CREATE VIRTUAL TABLE clubs_fts USING fts5(
        id UNINDEXED, 
        club_name, 
        country
    );
    """)

    conn.commit()
    return conn

def seed_data(conn):
    print("Seeding Coaches...")
    df_coaches = pd.read_csv(os.path.join(BASE_DIR, "male_coaches.csv"), low_memory=False)
    coaches_records = []
    for _, row in df_coaches.iterrows():
        c_id = str(uuid.uuid4())
        coaches_records.append((
            c_id, 
            str(row.get('coach_id', '')), 
            str(row.get('short_name', '')),
            str(row.get('long_name', '')),
            str(row.get('dob', '')), 
            str(row.get('nationality_name', ''))
        ))
    conn.executemany("INSERT OR IGNORE INTO coaches (id, source_id, short_name, long_name, birth_date, nationality) VALUES (?, ?, ?, ?, ?, ?)", coaches_records)

    print("Seeding FC26 Players and Clubs...")
    df_fc26 = pd.read_csv(os.path.join(BASE_DIR, "FC26_20250921.csv"), low_memory=False)
    
    club_records = {}
    player_records = []
    player_fts_records = []
    player_state_records = []
    
    for _, row in df_fc26.iterrows():
        # Handle Clubs
        source_club_id = str(row.get('club_team_id', '')).replace('.0', '')
        if pd.isna(source_club_id) or source_club_id == 'nan' or not source_club_id:
            club_uuid = None
        else:
            if source_club_id not in club_records:
                club_uuid = str(uuid.uuid4())
                club_name = str(row.get('club_name', 'Unknown Club'))
                league_name = str(row.get('league_name', 'Unknown League'))
                club_records[source_club_id] = {
                    'id': club_uuid,
                    'name': club_name,
                    'country': league_name # Use league as proxy for country for now
                }
            else:
                club_uuid = club_records[source_club_id]['id']

        # Handle Players
        p_id = str(uuid.uuid4())
        source_id = str(row.get('player_id', ''))
        short_name = str(row.get('short_name', ''))
        long_name = str(row.get('long_name', ''))
        if pd.isna(long_name): long_name = short_name
        fake_name = generate_fake_name(short_name)
        
        player_records.append((
            p_id, 
            source_id, 
            short_name, 
            long_name, 
            fake_name,
            str(row.get('dob', '')), 
            str(row.get('nationality_name', ''))
        ))
        player_fts_records.append((p_id, short_name, long_name, fake_name, source_id))
        
        # Attributes JSON
        attrs = {
            'pace': int(row.get('pace', 0)) if not pd.isna(row.get('pace')) else 0,
            'shooting': int(row.get('shooting', 0)) if not pd.isna(row.get('shooting')) else 0,
            'passing': int(row.get('passing', 0)) if not pd.isna(row.get('passing')) else 0,
            'dribbling': int(row.get('dribbling', 0)) if not pd.isna(row.get('dribbling')) else 0,
            'defending': int(row.get('defending', 0)) if not pd.isna(row.get('defending')) else 0,
            'physic': int(row.get('physic', 0)) if not pd.isna(row.get('physic')) else 0,
        }
        
        player_state_records.append((
            str(uuid.uuid4()),
            p_id,
            club_uuid,
            int(row.get('overall', 70)) if not pd.isna(row.get('overall')) else 70,
            int(row.get('potential', 75)) if not pd.isna(row.get('potential')) else 75,
            float(row.get('value_eur', 0)) if not pd.isna(row.get('value_eur')) else 0.0,
            float(row.get('wage_eur', 0)) if not pd.isna(row.get('wage_eur')) else 0.0,
            str(row.get('player_face_url', '')),
            json.dumps(attrs)
        ))

    # Insert Clubs
    club_insert = [(v['id'], k, v['name'], v['country'], None) for k, v in club_records.items()]
    club_fts_insert = [(v['id'], v['name'], v['country']) for k, v in club_records.items()]
    conn.executemany("INSERT OR IGNORE INTO clubs (id, source_id, club_name, country, manager_id) VALUES (?, ?, ?, ?, ?)", club_insert)
    conn.executemany("INSERT INTO clubs_fts (id, club_name, country) VALUES (?, ?, ?)", club_fts_insert)

    # Insert Players
    conn.executemany("INSERT OR IGNORE INTO players (id, source_id, short_name, long_name, fake_name, birth_date, nationality) VALUES (?, ?, ?, ?, ?, ?, ?)", player_records)
    conn.executemany("INSERT INTO players_fts (id, short_name, long_name, fake_name, source_id) VALUES (?, ?, ?, ?, ?)", player_fts_records)
    conn.executemany("INSERT INTO player_state (id, player_id, club_id, overall, potential, value_eur, wage_eur, player_face_url, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", player_state_records)

    conn.commit()
    print("Database Seeded Successfully!")

if __name__ == "__main__":
    conn = setup_db()
    # Truncate tables for fresh seed
    conn.executescript("DELETE FROM players; DELETE FROM players_fts; DELETE FROM clubs; DELETE FROM clubs_fts; DELETE FROM coaches; DELETE FROM player_state;")
    seed_data(conn)
    conn.close()
