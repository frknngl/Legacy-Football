import streamlit as st
from st_keyup import st_keyup
import sqlite3
import pandas as pd
import uuid
import json

st.set_page_config(page_title="Football Simulation Data Engine", page_icon="⚽", layout="wide")

import os

# Custom CSS for Premium FM-style Look
st.markdown("""
<style>
    div[data-testid="metric-container"] {
        background-color: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 10px;
        border-radius: 8px;
    }
    .fm-card {
        padding: 20px;
        border-radius: 10px;
        background-color: #1e1e24;
        border-left: 5px solid #2ecc71;
        margin-bottom: 15px;
    }
    .fm-title {
        font-size: 2.2rem;
        font-weight: 800;
        margin-bottom: 0px;
        padding-bottom: 0px;
    }
    .fm-subtitle {
        font-size: 1.1rem;
        color: #95a5a6;
    }
</style>
""", unsafe_allow_html=True)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fm_database.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# --- Session State Initialization ---
if 'selected_player_id' not in st.session_state:
    st.session_state.selected_player_id = None
if 'selected_club_id' not in st.session_state:
    st.session_state.selected_club_id = None
if 'nav_page' not in st.session_state:
    st.session_state.nav_page = "Dashboard"

def navigate(page):
    st.session_state.nav_page = page
    st.session_state.selected_player_id = None
    st.session_state.selected_club_id = None

def view_player(player_id):
    st.session_state.selected_player_id = player_id

def view_club(club_id):
    st.session_state.selected_club_id = club_id

def go_back():
    st.session_state.selected_player_id = None
    st.session_state.selected_club_id = None

# --- Sidebar Navigation ---
st.sidebar.title("⚽ DB Editor")
pages = ["Dashboard", "Players", "Clubs", "Coaches"]
for p in pages:
    if st.sidebar.button(p, use_container_width=True, type="primary" if st.session_state.nav_page == p else "secondary"):
        navigate(p)
        st.rerun()

conn = get_db_connection()

# ==========================================
# PLAYER PROFILE VIEW (Master-Detail)
# ==========================================
if st.session_state.selected_player_id:
    st.button("⬅ Back to Results", on_click=go_back)
    p_id = st.session_state.selected_player_id
    
    query = """
        SELECT p.id, p.short_name, p.long_name, p.fake_name, p.nationality, p.birth_date,
               ps.overall, ps.potential, ps.value_eur, ps.wage_eur, ps.player_face_url, ps.attributes,
               c.club_name, c.id as club_id
        FROM players p
        LEFT JOIN player_state ps ON p.id = ps.player_id
        LEFT JOIN clubs c ON ps.club_id = c.id
        WHERE p.id = ?
    """
    player = conn.execute(query, (p_id,)).fetchone()
    
    if player:
        # Top Header Card
        st.markdown(f"""
        <div class="fm-card">
            <div class="fm-title">{player['short_name']}</div>
            <div class="fm-subtitle">{player['fake_name']} | {player['nationality']}</div>
        </div>
        """, unsafe_allow_html=True)
        
        # Create Tabs
        tab1, tab2, tab3, tab4 = st.tabs(["Overview", "Attributes", "Edit Profile", "Transfer Market"])
        
        with tab1:
            col1, col2 = st.columns([1, 3])
            with col1:
                if player['player_face_url']:
                    st.image(player['player_face_url'], width=180)
                else:
                    st.write("No Image")
            with col2:
                c1, c2 = st.columns(2)
                c1.metric("Overall", player['overall'])
                c2.metric("Potential", player['potential'])
                st.write(f"**Real Name:** {player['long_name']}")
                st.write(f"**Age/DOB:** {player['birth_date']}")
                st.write(f"**Value:** €{player['value_eur']:,.0f}")
                st.write(f"**Wage:** €{player['wage_eur']:,.0f}")
                if player['club_id']:
                    st.write(f"**Current Club:** {player['club_name']}")
                    if st.button("Go to Club Dashboard", key="btn_go_club"):
                        view_club(player['club_id'])
                        st.session_state.selected_player_id = None
                        st.rerun()
                else:
                    st.write("**Current Club:** Free Agent")
        
        with tab2:
            if player['attributes']:
                attrs = json.loads(player['attributes'])
                st.subheader("Core Attributes")
                c1, c2, c3, c4, c5, c6 = st.columns(6)
                c1.metric("PAC", attrs.get('pace', 0))
                c2.metric("SHO", attrs.get('shooting', 0))
                c3.metric("PAS", attrs.get('passing', 0))
                c4.metric("DRI", attrs.get('dribbling', 0))
                c5.metric("DEF", attrs.get('defending', 0))
                c6.metric("PHY", attrs.get('physic', 0))
            else:
                st.write("No attribute data available.")
                
        with tab3:
            st.subheader("Edit Player Attributes")
            with st.form(f"edit_player_{p_id}"):
                col_ovr, col_pot = st.columns(2)
                new_ovr = col_ovr.number_input("Overall", min_value=1, max_value=99, value=int(player['overall']))
                new_pot = col_pot.number_input("Potential", min_value=1, max_value=99, value=int(player['potential']))
                
                col_dob, col_nat = st.columns(2)
                new_dob = col_dob.text_input("Birth Date (YYYY-MM-DD)", value=player['birth_date'])
                
                # Dynamic Nationality Dropdown
                nat_df = pd.read_sql_query("SELECT DISTINCT nationality FROM players WHERE nationality IS NOT NULL ORDER BY nationality", conn)
                nat_list = nat_df['nationality'].tolist()
                curr_nat = player['nationality'] if player['nationality'] else "Unknown"
                if curr_nat not in nat_list:
                    nat_list.insert(0, curr_nat)
                nat_idx = nat_list.index(curr_nat)
                
                new_nat = col_nat.selectbox("Nationality", nat_list, index=nat_idx)
                
                st.write("---")
                st.write("**Core Attributes**")
                edit_attrs = json.loads(player['attributes']) if player['attributes'] else {}
                c1, c2, c3 = st.columns(3)
                new_pac = c1.number_input("Pace (PAC)", min_value=1, max_value=99, value=int(edit_attrs.get('pace', 50)))
                new_sho = c2.number_input("Shooting (SHO)", min_value=1, max_value=99, value=int(edit_attrs.get('shooting', 50)))
                new_pas = c3.number_input("Passing (PAS)", min_value=1, max_value=99, value=int(edit_attrs.get('passing', 50)))
                
                c4, c5, c6 = st.columns(3)
                new_dri = c4.number_input("Dribbling (DRI)", min_value=1, max_value=99, value=int(edit_attrs.get('dribbling', 50)))
                new_def = c5.number_input("Defending (DEF)", min_value=1, max_value=99, value=int(edit_attrs.get('defending', 50)))
                new_phy = c6.number_input("Physical (PHY)", min_value=1, max_value=99, value=int(edit_attrs.get('physic', 50)))
                
                if st.form_submit_button("Save Changes"):
                    new_attrs_json = json.dumps({
                        "pace": new_pac,
                        "shooting": new_sho,
                        "passing": new_pas,
                        "dribbling": new_dri,
                        "defending": new_def,
                        "physic": new_phy
                    })
                    
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE players 
                        SET birth_date = ?, nationality = ?
                        WHERE id = ?
                    """, (new_dob, new_nat, p_id))
                    
                    cursor.execute("""
                        UPDATE player_state
                        SET overall = ?, potential = ?, attributes = ?
                        WHERE player_id = ?
                    """, (new_ovr, new_pot, new_attrs_json, p_id))
                    
                    conn.commit()
                    st.success("Player profile updated!")
                    st.rerun()
                    
        with tab4:
            st.subheader("Execute Transfer")
            # Get all clubs
            clubs_df = pd.read_sql_query("SELECT id, club_name FROM clubs ORDER BY club_name", conn)
            club_opts = clubs_df['id'].tolist()
            club_opts.insert(0, None)
            
            def format_club(c_id):
                if c_id is None: return "Free Agent"
                return clubs_df[clubs_df['id'] == c_id]['club_name'].values[0]

            curr_club_id = player['club_id']
            idx = club_opts.index(curr_club_id) if curr_club_id in club_opts else 0
            
            with st.form("transfer_form"):
                new_club_id = st.selectbox("Destination Club", club_opts, index=idx, format_func=format_club)
                if st.form_submit_button("Transfer Player"):
                    if new_club_id != curr_club_id:
                        cursor = conn.cursor()
                        t_id = str(uuid.uuid4())
                        cursor.execute("""
                            INSERT INTO transfers (id, player_id, from_club_id, to_club_id, fee, transfer_date)
                            VALUES (?, ?, ?, ?, 0, date('now'))
                        """, (t_id, p_id, curr_club_id, new_club_id))
                        cursor.execute("UPDATE player_state SET club_id = ? WHERE player_id = ?", (new_club_id, p_id))
                        conn.commit()
                        st.success("Transfer Completed!")
                        st.rerun()

# ==========================================
# CLUB DASHBOARD VIEW (Master-Detail)
# ==========================================
elif st.session_state.selected_club_id:
    st.button("⬅ Back to Results", on_click=go_back)
    c_id = st.session_state.selected_club_id
    
    club = conn.execute("SELECT id, club_name, country FROM clubs WHERE id = ?", (c_id,)).fetchone()
    if club:
        st.title(f"{club['club_name']} Dashboard")
        st.write(f"**League/Country:** {club['country']}")
        
        st.subheader("Active Roster")
        roster_query = """
            SELECT p.id, p.short_name, p.fake_name, p.nationality, ps.overall, ps.potential, ps.value_eur
            FROM players p
            JOIN player_state ps ON p.id = ps.player_id
            WHERE ps.club_id = ?
            ORDER BY ps.overall DESC
        """
        roster_df = pd.read_sql_query(roster_query, conn, params=(c_id,))
        
        if roster_df.empty:
            st.info("No players assigned to this club.")
        else:
            st.write("💡 *Tablodan incelemek istediğiniz oyuncunun satırına tıklayın.*")
            event = st.dataframe(
                roster_df[['short_name', 'fake_name', 'nationality', 'overall', 'potential', 'value_eur']],
                use_container_width=True,
                on_select="rerun",
                selection_mode="single-row"
            )
            
            if event.selection.rows:
                selected_idx = event.selection.rows[0]
                selected_roster_p_id = roster_df.iloc[selected_idx]['id']
                view_player(selected_roster_p_id)
                st.session_state.selected_club_id = None
                st.rerun()


# ==========================================
# GENERIC PAGES
# ==========================================
elif st.session_state.nav_page == "Dashboard":
    st.title("Database Dashboard")
    try:
        total_players = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
        total_clubs = conn.execute("SELECT COUNT(*) FROM clubs").fetchone()[0]
        total_coaches = conn.execute("SELECT COUNT(*) FROM coaches").fetchone()[0]
    except Exception as e:
        st.error("Database not seeded yet!")
        total_players, total_clubs, total_coaches = 0, 0, 0
    
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Players", f"{total_players:,}")
    col2.metric("Total Clubs", f"{total_clubs:,}")
    col3.metric("Total Coaches", f"{total_coaches:,}")
    col4.metric("Dataset", "FC26 (Full)")
    st.success("Connected to local SQLite Database.")

elif st.session_state.nav_page == "Players":
    st.title("Player Search")
    search = st_keyup("🔍 Search by Real Name, Game Name, or Fake Name (Anlık Arama)", placeholder="e.g. Messi or Lionel", key="player_search")
    
    if search:
        query = """
            SELECT p.id, p.short_name, p.long_name, p.fake_name, ps.overall, ps.potential, c.club_name
            FROM players p
            JOIN players_fts fts ON p.id = fts.id
            LEFT JOIN player_state ps ON p.id = ps.player_id
            LEFT JOIN clubs c ON ps.club_id = c.id
            WHERE players_fts MATCH ?
            ORDER BY rank
            LIMIT 50
        """
        search_term = f"{search}*"
        df = pd.read_sql_query(query, conn, params=(search_term,))
    else:
        query = """
            SELECT p.id, p.short_name, p.long_name, p.fake_name, ps.overall, ps.potential, c.club_name
            FROM players p
            LEFT JOIN player_state ps ON p.id = ps.player_id
            LEFT JOIN clubs c ON ps.club_id = c.id
            ORDER BY ps.overall DESC
            LIMIT 50
        """
        df = pd.read_sql_query(query, conn)
        
    st.write(f"Showing top {len(df)} results. 💡 *Detaylarını görmek için oyuncunun satırına tıklayın.*")
    
    if not df.empty:
        event = st.dataframe(
            df[['short_name', 'long_name', 'fake_name', 'overall', 'potential', 'club_name']],
            use_container_width=True,
            on_select="rerun",
            selection_mode="single-row",
            key="players_df"
        )
        if event.selection.rows:
            selected_idx = event.selection.rows[0]
            selected_p_id = df.iloc[selected_idx]['id']
            view_player(selected_p_id)
            st.rerun()

elif st.session_state.nav_page == "Clubs":
    st.title("Club Search")
    search = st_keyup("🔍 Search Club Name (Anlık Arama)", placeholder="e.g. Madrid", key="club_search")
    
    if search:
        query = """
            SELECT c.id, c.club_name, c.country
            FROM clubs c
            JOIN clubs_fts fts ON c.id = fts.id
            WHERE clubs_fts MATCH ?
            ORDER BY rank
            LIMIT 50
        """
        search_term = f"{search}*"
        df = pd.read_sql_query(query, conn, params=(search_term,))
    else:
        query = "SELECT id, club_name, country FROM clubs LIMIT 50"
        df = pd.read_sql_query(query, conn)
        
    if not df.empty:
        st.write("💡 *Kulüp dashboard'una gitmek için satıra tıklayın.*")
        event = st.dataframe(
            df[['club_name', 'country']],
            use_container_width=True,
            on_select="rerun",
            selection_mode="single-row",
            key="clubs_df"
        )
        if event.selection.rows:
            selected_idx = event.selection.rows[0]
            selected_club_id = df.iloc[selected_idx]['id']
            view_club(selected_club_id)
            st.rerun()

elif st.session_state.nav_page == "Coaches":
    st.title("Coach Search")
    search = st_keyup("🔍 Search Coach Name (Anlık Arama)", placeholder="e.g. Guardiola", key="coach_search")
    
    if search:
        query = """
            SELECT short_name, long_name, nationality 
            FROM coaches 
            WHERE short_name LIKE ? OR long_name LIKE ?
            LIMIT 50
        """
        search_term = f"%{search}%"
        df = pd.read_sql_query(query, conn, params=(search_term, search_term))
    else:
        df = pd.read_sql_query("SELECT short_name, long_name, nationality FROM coaches LIMIT 50", conn)
        
    st.write(f"Showing top {len(df)} results. Toplam sistemdeki hoca sayısı: 1,369")
    st.dataframe(df, use_container_width=True)

conn.close()
