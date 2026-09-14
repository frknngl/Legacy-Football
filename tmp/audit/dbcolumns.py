"""
VERITABANI KOLON KULLANIM DENETIMI.

Her kolon icin sorar:
  1. Veritabaninda var mi?           -> sqlite_master
  2. Kodda okunuyor mu?              -> src/ ve tools/ icinde arama
  3. MOTOR tarafindan mi okunuyor?   -> yalnizca src/ (oyun)
  4. Yalnizca hat mi yaziyor?        -> yalnizca tools/ (import)

SINIR: "kodda gecmesi" entegrasyon SAYILMAZ. Bu betik yalnizca
referansi bulur; gameplay etkisi ana raporda ayrica kanitlanir.
"""

import os
import re
import sqlite3
import collections

DB = "data/world.db"
SRC_DIRS = ["src"]
TOOL_DIRS = ["tools/roster"]


def read_sources(dirs):
    out = {}
    for d in dirs:
        for root, _, files in os.walk(d):
            for f in files:
                if f.endswith((".ts", ".py")):
                    p = os.path.join(root, f)
                    out[p] = open(p, encoding="utf-8", errors="ignore").read()
    return out


src = read_sources(SRC_DIRS)
tools = read_sources(TOOL_DIRS)

conn = sqlite3.connect(DB)
tables = [
    r[0]
    for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
]


def hits(col, corpus):
    """Kolon adinin gectigi dosyalar. Kelime siniri ile -- 'id' her yerde gecmesin."""
    pat = re.compile(r"\b" + re.escape(col) + r"\b")
    return [p for p, t in corpus.items() if pat.search(t)]


rows = []
for t in tables:
    cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')]
    n = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
    for c in cols:
        # Cok jenerik adlar tek basina aranamaz; tablo baglami ile bakariz.
        generic = c in ("id", "name", "value", "key", "type", "role", "level", "week", "season")
        s_hits = [] if generic else hits(c, src)
        t_hits = [] if generic else hits(c, tools)
        rows.append(
            {
                "table": t,
                "column": c,
                "rows": n,
                "engine": len(s_hits),
                "pipeline": len(t_hits),
                "generic": generic,
                "engine_files": [os.path.basename(x) for x in s_hits[:3]],
            }
        )

print(f"{'TABLO':22} {'KOLON':22} {'SATIR':>7} {'MOTOR':>6} {'HAT':>5}  DURUM")
print("-" * 100)
status_count = collections.Counter()
for r in rows:
    if r["generic"]:
        st = "JENERIK (elle bakilmali)"
    elif r["engine"] > 0:
        st = "MOTOR OKUYOR"
    elif r["pipeline"] > 0:
        st = "YALNIZCA HAT YAZIYOR"
    else:
        st = "HIC REFERANS YOK"
    status_count[st] += 1
    r["status"] = st
    print(
        f"{r['table']:22} {r['column']:22} {r['rows']:>7} {r['engine']:>6} {r['pipeline']:>5}  {st}"
        + (f"  [{', '.join(r['engine_files'])}]" if r["engine_files"] else "")
    )

print()
print("=== OZET ===")
for k, v in status_count.most_common():
    print(f"   {k:26} {v}")
print(f"   TOPLAM tablo: {len(tables)}   TOPLAM kolon: {len(rows)}")

print()
print("=== MOTOR HIC OKUMUYOR (hat yaziyor ama oyun gormuyor) ===")
for r in rows:
    if r["status"] == "YALNIZCA HAT YAZIYOR":
        print(f"   {r['table']}.{r['column']}")

print()
print("=== HICBIR YERDE REFERANS YOK ===")
for r in rows:
    if r["status"] == "HIC REFERANS YOK":
        print(f"   {r['table']}.{r['column']}")
