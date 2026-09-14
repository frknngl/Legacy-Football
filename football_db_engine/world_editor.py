"""
WORLD.DB EDITORU -- her tabloya erisim, her satira duzenleme.

NEDEN YENI DOSYA:
    `editor_app.py` `fm_database.db`ye bakiyordu ve yalnizca dort tablo
    (players / clubs / coaches / player_state) icin ELLE YAZILMIS sayfalar
    tasiyordu. Yeni bir tablo eklendiginde editor onu GORMUYORDU -- yani
    ligler, kupalar, teknik heyet, hakemler, menajerlik sirketleri ve butun
    referans tablolari duzenlenemiyordu.

    Bu editor tablolari `sqlite_master`dan OKUR. Yeni bir tablo semaya
    eklendiginde burada kod degismez; tablo kendiliginden listeye duser.

SINIR:
    world.db bir TUREV urundur: import hatti onu kaynak CSV'lerden uretir.
    Buradaki duzenlemeler bir sonraki import'ta KORUNUR, cunku:
      - `mask_binding` yalnizca INSERT alir; kilitli ad degismez.
      - `ref_*` tohumlari `ON CONFLICT DO NOTHING` ile yazilir.
    Ama tureyen alanlar (itibar, butce, finansal guc) her import'ta YENIDEN
    HESAPLANIR ve elle verilen degeri ezer. Bu yuzden editor onlari
    isaretler.

CALISTIRMA:
    streamlit run football_db_engine/world_editor.py
"""

import os
import sqlite3

import pandas as pd
import streamlit as st

st.set_page_config(page_title="World DB Editor", page_icon="🌍", layout="wide")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB = os.path.join(PROJECT_ROOT, "data", "world.db")

# --------------------------------------------------------------- aciklamalar
#
# Tablo ve kolon notlari KOD DEGIL ACIKLAMADIR: editorde calisan kisi hangi
# alanin elle degistirilebilecegini, hangisinin her import'ta ezilecegini
# bilmeli. Bilmeden bir itibar degerini elle duzeltmek sessizce bosa giden
# bir is olurdu.

TABLE_NOTES = {
    "country": "Ulkeler. Ad MASKELENMEZ -- cografya tescilli degil.",
    "city": "Sehirler. Kulup adindaki yer tokeninden turetilir; ad maskelenmez.",
    "competition": "Ligler ve kupalar. name_masked PES mantiginda uretilir.",
    "club": "Kulupler. name_masked kuratorlu esleme ya da havuzdan gelir.",
    "player": "Oyuncular. Ad korunur, soyad kaydirilir.",
    "player_attributes": "Nitelikler. FC26 anligindan GERCEK degerler.",
    "staff": "Teknik heyet. Kimlik gercek, nitelik uretilmis.",
    "staff_attributes": "Teknik nitelikler. overall TURETILMIS -- elle yazmayin.",
    "staff_assignment": "Gorev gecmisi. is_current=1 olan satir guncel gorevdir.",
    "referee": "Hakemler. Hicbir kaynakta yok -- tamamen tohumdan uretilir.",
    "referee_eligibility": "Turnuva basina en dusuk kokart sarti.",
    "agent": "Menajerler (KISI). Hero'nun temsilcisi.",
    "agency": "Menajerlik sirketleri (KURUM). Kaynakta gercekten var.",
    "player_agency": "Oyuncu <-> sirket iliskisi, tarihli.",
    "mask_binding": "KIMLIK KILIDI. Buradaki bir satiri degistirmek 20 sezonluk "
    "bir kariyerin hatiralarini sahipsiz birakabilir.",
    "ref_league": "Lig -> ulke eslemesi. Yeni lig eklemek icin satir ekleyin.",
    "ref_mask_rule": "Kuratorlu maske eslemesi. Algoritmanin urettigi adi EZER.",
    "ref_name_pool": "Ulkeye ozel isim havuzlari.",
    "ref_attribute_band": "Nitelik bantlari. Cakismalari KASITLI.",
    "ref_distribution": "Agirlikli dagilimlar. Toplam 1.0 olmak zorunda degil.",
    "ref_staff_role": "Rol tanimlari. attributed=0 olan roller nitelik tasimaz.",
    "ref_word_pool": "Maskeleme sozcukleri.",
    "ref_setting": "Sayisal ayarlar.",
    "ref_manual_referee": "Elle tanimli hakemler; cekilisten ONCE yazilir.",
    "import_issue": "Import kalite raporu. Salt okunur sayilmali.",
    "source_dataset": "Koken kaydi: hangi anliktan, hangi filtreyle.",
    "identity_link": "Iki kaynak arasi kopru + guven skoru.",
}

# Her import'ta YENIDEN HESAPLANAN alanlar. Elle degistirmek bosa is.
DERIVED_COLUMNS = {
    "club": ["reputation", "tier", "budget_transfer", "budget_wage",
             "squad_value", "financial_power", "current_manager_id"],
    "competition": ["reputation", "club_count", "matches_per_club"],
    "staff_attributes": ["overall"],
    "agency": ["client_count", "reputation", "influence", "specialization"],
    "player_attributes": ["overall"],
}

# Degistirilmesi TEHLIKELI tablolar -- kimlik kilidi.
LOCKED_TABLES = {"mask_binding"}


@st.cache_resource
def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def list_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r["name"] for r in rows]


def table_columns(conn: sqlite3.Connection, table: str) -> list[dict]:
    return [dict(r) for r in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]


def primary_keys(columns: list[dict]) -> list[str]:
    return [c["name"] for c in sorted(columns, key=lambda c: c["pk"]) if c["pk"] > 0]


def row_count(conn: sqlite3.Connection, table: str) -> int:
    return conn.execute(f'SELECT COUNT(*) AS n FROM "{table}"').fetchone()["n"]


def _same(a, b) -> bool:
    """NaN/None farklarini esit sayar -- pandas bos hucreyi NaN yapar."""
    if pd.isna(a) and pd.isna(b):
        return True
    return a == b


def _clean(value):
    """pandas tiplerini SQLite'in kabul ettigi tiplere cevirir."""
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


# ------------------------------------------------------------------ kenar cubugu

st.sidebar.title("🌍 World DB Editor")

db_path = st.sidebar.text_input("Veritabani", value=DEFAULT_DB)
if not os.path.exists(db_path):
    st.sidebar.error("Veritabani bulunamadi.")
    st.title("world.db yok")
    st.markdown(
        "Once dunyayi uretin:\n\n"
        "```bash\n"
        "npm run roster -- import --data=<CSV klasoru>\n"
        "```\n\n"
        "`world.db` bir TUREV urundur: repoya girmez, kaynak CSV'lerden uretilir."
    )
    st.stop()

conn = connect(db_path)
tables = list_tables(conn)

# Tablolari ailelere ayir -- 25 tabloyu duz liste olarak sunmak gezinmeyi
# zorlastirirdi.
FAMILIES = {
    "Dunya": ["country", "city", "competition", "club"],
    "Oyuncu": ["player", "player_attributes", "player_agency"],
    "Teknik heyet": ["staff", "staff_attributes", "staff_assignment"],
    "Hakem": ["referee", "referee_eligibility", "ref_manual_referee"],
    "Menajerlik": ["agent", "agency"],
    "Referans": [t for t in tables if t.startswith("ref_") and t != "ref_manual_referee"],
    "Sistem": ["mask_binding", "import_issue", "source_dataset", "identity_link"],
}
placed = {t for group in FAMILIES.values() for t in group}
FAMILIES["Diger"] = [t for t in tables if t not in placed]

family = st.sidebar.radio("Aile", [k for k, v in FAMILIES.items() if v])
options = [t for t in FAMILIES[family] if t in tables]
if not options:
    st.warning("Bu ailede tablo yok.")
    st.stop()

table = st.sidebar.selectbox("Tablo", options)

st.sidebar.divider()
st.sidebar.caption("Satir sayilari")
for t in options:
    st.sidebar.text(f"{t}: {row_count(conn, t):,}")

# ------------------------------------------------------------------ ana panel

columns = table_columns(conn, table)
pks = primary_keys(columns)
names = [c["name"] for c in columns]

st.title(table)
note = TABLE_NOTES.get(table)
if note:
    st.caption(note)

if table in LOCKED_TABLES:
    st.error(
        "KIMLIK KILIDI. Bu tablodaki bir satiri degistirmek, o varligin adini ve "
        "kalici kimligini degistirir -- devam eden kariyerlerdeki iliskiler ve "
        "`mem_*` izleri sahipsiz kalir. Yalnizca ne yaptiginizi biliyorsaniz."
    )

derived = DERIVED_COLUMNS.get(table, [])
if derived:
    st.warning(
        "Su kolonlar HER IMPORT'ta yeniden hesaplanir ve elle verilen deger "
        f"EZILIR: `{'`, `'.join(derived)}`"
    )

if not pks:
    st.info("Bu tablonun tek kolonluk birincil anahtari yok -- salt okunur gosteriliyor.")

# --- arama
text_columns = [c["name"] for c in columns if (c["type"] or "").upper().startswith("TEXT")]
search = st.text_input("Ara", placeholder=f"{', '.join(text_columns[:4])} icinde ara")

where = ""
params: list = []
if search and text_columns:
    clauses = " OR ".join(f'"{c}" LIKE ?' for c in text_columns)
    where = f"WHERE {clauses}"
    params = [f"%{search}%"] * len(text_columns)

total = conn.execute(f'SELECT COUNT(*) AS n FROM "{table}" {where}', params).fetchone()["n"]

col_a, col_b = st.columns([1, 3])
with col_a:
    page_size = st.selectbox("Sayfa boyutu", [25, 50, 100, 250, 500], index=1)
page_count = max(1, (total + page_size - 1) // page_size)
with col_b:
    page = st.number_input(
        f"Sayfa (toplam {page_count}, {total:,} satir)",
        min_value=1, max_value=page_count, value=1, step=1,
    )

order = f'ORDER BY "{pks[0]}"' if pks else ""
rows = conn.execute(
    f'SELECT * FROM "{table}" {where} {order} LIMIT ? OFFSET ?',
    [*params, page_size, (page - 1) * page_size],
).fetchall()

frame = pd.DataFrame([dict(r) for r in rows], columns=names)

if frame.empty:
    st.info("Satir yok.")
    st.stop()

# Birincil anahtar duzenlenemez: degistirmek satiri SILIP yenisini yazmak
# olurdu ve FK'ler kirilirdi.
edited = st.data_editor(
    frame,
    use_container_width=True,
    num_rows="fixed" if table in LOCKED_TABLES else "dynamic",
    disabled=pks if pks else names,
    key=f"editor_{table}_{page}",
    hide_index=True,
)

if st.button("Degisiklikleri kaydet", type="primary", disabled=not pks):
    original = frame.set_index(pks[0])
    changed = edited.dropna(subset=[pks[0]]).set_index(pks[0])

    updates = 0
    inserts = 0
    try:
        for key, new_row in changed.iterrows():
            if key in original.index:
                old_row = original.loc[key]
                diff = {
                    c: new_row[c]
                    for c in names
                    if c != pks[0] and not _same(old_row[c], new_row[c])
                }
                if not diff:
                    continue
                sets = ", ".join(f'"{c}" = ?' for c in diff)
                conn.execute(
                    f'UPDATE "{table}" SET {sets} WHERE "{pks[0]}" = ?',
                    [*[_clean(v) for v in diff.values()], key],
                )
                updates += 1
            else:
                cols = [c for c in names if pd.notna(new_row.get(c))]
                marks = ", ".join("?" for _ in cols)
                quoted = ", ".join(f'"{c}"' for c in cols)
                conn.execute(
                    f'INSERT INTO "{table}" ({quoted}) VALUES ({marks})',
                    [_clean(new_row[c]) for c in cols],
                )
                inserts += 1

        # SILME: tablodan kaybolmus anahtarlar.
        removed = set(original.index) - set(changed.index)
        for key in removed:
            conn.execute(f'DELETE FROM "{table}" WHERE "{pks[0]}" = ?', [key])

        conn.commit()
        st.success(
            f"{updates} guncelleme, {inserts} ekleme, {len(removed)} silme kaydedildi."
        )
        st.rerun()
    except sqlite3.Error as error:
        conn.rollback()
        # STRICT tablo ve FK kisitlari burada devreye girer: yanlis tip ya da
        # olmayan bir FK hedefi SESSIZCE gecmez.
        st.error(f"Kaydedilemedi, degisiklikler geri alindi:\n\n{error}")


# ------------------------------------------------------------------ serbest SQL

st.divider()
with st.expander("SQL konsolu"):
    st.caption(
        "Salt okunur sorgular icin. Yazma islemleri de calisir ama geri alinamaz "
        "-- world.db turev bir urun oldugu icin en kotu durumda yeniden uretilir."
    )
    sql = st.text_area("SQL", value=f'SELECT * FROM "{table}" LIMIT 50')
    if st.button("Calistir"):
        try:
            result = conn.execute(sql).fetchall()
            if result:
                st.dataframe(pd.DataFrame([dict(r) for r in result]), use_container_width=True)
            else:
                conn.commit()
                st.success("Calisti, satir donmedi.")
        except sqlite3.Error as error:
            st.error(str(error))
