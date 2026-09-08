# -*- coding: utf-8 -*-
"""HATTIN KENDI TESTLERI.

Uretim hattinin dogru calistigini VARSAYMAK, en pahali hata bicimidir: kapinin
kapanmadigini ancak yuzlerce sahne uretildikten sonra fark edersiniz.

Dort sey sinanir:
  1. Kapi gercekten kapatiyor mu   -- kasten klon metin uret, reddedilsin
  2. Defter tekrari engelliyor mu  -- ayni imza ikinci kez uretilemesin
  3. Zincir kopmuyor mu            -- yazilan her `mem_*` okunuyor olsun
  4. Anahtar sizmiyor mu           -- repoda hicbir dosyada API anahtari olmasin

Testler PROJEYE DOKUNMAZ: kapi gecici dosyayla calisir ve kendini temizler.
"""
from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path

from . import vocab
from .arcs import ArcComposer

from .gate import QualityGate
from .ledger import SceneLedger
from .planner import Planner, PROFILES

# Saglayici anahtar bicimleri. DEGERLER degil DESENLER aranir -- gercek bir
# anahtari test dosyasina yazmak, onlemeye calistigimiz seyin ta kendisidir.
KEY_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"AIza[0-9A-Za-z_\-]{35}", "Google API anahtari"),
    (r"AQ\.[A-Za-z0-9_\-]{30,}", "Google OAuth/AQ token"),
    (r"sk-[A-Za-z0-9]{32,}", "OpenAI anahtari"),
    (r"sk-ant-[A-Za-z0-9_\-]{20,}", "Anthropic anahtari"),
)

SKIP_DIRS = {".git", "node_modules", "dist", ".cache", "__pycache__", ".prompts"}


class TestFailure(RuntimeError):
    pass


def run_all(root: Path, skip_slow: bool = False) -> list[tuple[str, bool, str]]:
    """Tum testleri calistirir; (ad, gecti_mi, aciklama) listesi doner."""
    results: list[tuple[str, bool, str]] = []

    for name, fn, slow in (
        ("kapi klonu reddediyor", _test_gate_rejects_clone, True),
        ("defter tekrari engelliyor", _test_ledger_blocks_repeat, False),
        ("zincir kapaniyor", _test_arcs_close, False),
        ("anahtar sizmiyor", _test_no_key_leak, False),
    ):
        if slow and skip_slow:
            results.append((name, True, "atlandi (--hizli)"))
            continue
        try:
            detail = fn(root)
            results.append((name, True, detail))
        except TestFailure as err:
            results.append((name, False, str(err)))
        except Exception as err:  # noqa: BLE001 -- test kosucusu cokmemeli
            results.append((name, False, f"{type(err).__name__}: {err}"))

    return results


# --------------------------------------------------------------- 1. kapi


def _test_gate_rejects_clone(root: Path) -> str:
    """Mevcut bir sahnenin metnini AYNEN kopyalar; kapi reddetmeli.

    Bu testin degeri sembolik degil: kapi bozulursa (validator komutu degisir,
    cikti bicimi kayar, `returncode` yutulur) hat sessizce her seyi kabul
    etmeye baslar ve bunu hicbir sey haber vermez.
    """
    source = _pick_donor(root)
    clone = json.loads(source.read_text(encoding="utf-8"))

    original_id = clone["id"]
    clone["id"] = "evt_selftest_clone"
    clone["family"] = "fam_selftest_clone"
    clone.pop("lint", None)  # muafiyet varsa test anlamsizlasir

    gate = QualityGate(root)
    result = gate.check(clone, clone.get("category", "media"))

    if result.ok:
        raise TestFailure(
            f"Kapi klonu KABUL ETTI ({original_id} metninin birebir kopyasi). "
            "TextQualityRule calismiyor ya da gate cikti ayristirmasi bozuk."
        )

    hits = [e for e in result.errors if "TextQualityRule" in e]
    if not hits:
        raise TestFailure(
            "Klon reddedildi ama TextQualityRule yuzunden degil: "
            f"{result.errors[:2]}"
        )
    return f"{len(hits)} klon dugumu yakalandi ({original_id} kaynakli)"


def _pick_donor(root: Path) -> Path:
    """Klonlamak icin yeterince uzun metni olan bir olay secer."""
    best: tuple[int, Path] | None = None
    for path in sorted((root / "content" / "events").rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if "lint" in data:
            continue
        longest = max(
            (len(n.get("text", "")) for n in (data.get("nodes") or {}).values()),
            default=0,
        )
        if longest >= 120 and (best is None or longest > best[0]):
            best = (longest, path)
    if best is None:
        raise TestFailure("Klonlanacak yeterli uzunlukta olay bulunamadi")
    return best[1]


# --------------------------------------------------------------- 2. defter


def _test_ledger_blocks_repeat(root: Path) -> str:
    """Ayni gating hucresi + beat icin ikinci brief uretilememeli."""
    v = vocab.load(root)
    ledger = SceneLedger(root / "tools" / "authoring" / ".cache" / "ledger.json")
    ledger.scan_existing(root / "content" / "events")

    planner = Planner(v, ledger, seed=101)
    first = planner.plan(1, category="locker")[0]

    if ledger.is_taken(first):
        raise TestFailure("Planlayici zaten dolu bir imza uretti")

    ledger.register(first)
    if not ledger.is_taken(first):
        raise TestFailure("Defter kaydettigi imzayi dolu saymiyor")

    # Ayni tohumla ikinci kez sorulunca AYNI brief donmemeli: imza artik dolu.
    again = Planner(v, ledger, seed=101).plan(1, category="locker")[0]
    if again.signature() == first.signature():
        raise TestFailure(
            f"Defter tekrari gecirdi: {first.signature()} iki kez uretildi"
        )

    # Elle kurulmus tam kopya da reddedilmeli -- id farkli, imza ayni.
    twin = replace(first, event_id=first.event_id + "_twin")
    if not ledger.is_taken(twin):
        raise TestFailure("Farkli id, ayni imza: defter bunu tekrar saymadi")

    return f"imza {first.signature()} ikinci kez uretilemedi"


# --------------------------------------------------------------- 3. zincir


def _test_arcs_close(root: Path) -> str:
    """Her zincirin yazdigi her `mem_*` icin bir okuyucu olmali."""
    v = vocab.load(root)
    ledger = SceneLedger(root / "tools" / "authoring" / ".cache" / "ledger.json")
    ledger.scan_existing(root / "content" / "events")

    checked = 0
    for seed in range(8):
        composer = ArcComposer(v, ledger, seed=seed)
        for category in PROFILES:
            arc = composer.compose(category)
            if not arc.is_closed():
                raise TestFailure(
                    f"{arc.chain_id} kapanmadi, okunmayan iz: {sorted(arc.orphans())}"
                )
            if not arc.payoffs:
                raise TestFailure(f"{arc.chain_id} odemesiz -- zincir degil")
            delays = [p.delay_turns or 0 for p in arc.payoffs]
            if delays != sorted(delays):
                raise TestFailure(f"{arc.chain_id} odemeleri zamanda geri gidiyor: {delays}")
            checked += 1

    return f"{checked} zincir kapali, odemeler zamanda ileri akiyor"


# --------------------------------------------------------------- 4. anahtar


def _test_no_key_leak(root: Path) -> str:
    """Repoda hicbir dosyada API anahtari gorunmemeli.

    `.env` disaridadir ve `.gitignore`dadir; buradaki tarama onun DISINDA
    kalan her seye bakar -- uretilen JSON'lar, prompt'lar, log'lar dahil.
    """
    leaks: list[str] = []
    scanned = 0

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.name == ".env":
            continue  # anahtarin YASAMASI gereken tek yer
        if path.suffix.lower() in {".png", ".jpg", ".ico", ".woff", ".woff2"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        scanned += 1
        for pattern, label in KEY_PATTERNS:
            if re.search(pattern, text):
                leaks.append(f"{path.relative_to(root)}: {label}")

    if leaks:
        raise TestFailure("Anahtar sizintisi: " + "; ".join(leaks[:5]))

    gitignore = root / ".gitignore"
    if not gitignore.exists() or ".env" not in gitignore.read_text(encoding="utf-8"):
        raise TestFailure(".env `.gitignore`da degil -- anahtar commit edilebilir")

    return f"{scanned} dosya tarandi, sizinti yok; .env gitignore'da"
