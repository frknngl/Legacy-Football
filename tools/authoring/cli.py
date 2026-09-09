# -*- coding: utf-8 -*-
"""YAZIM HATTI CLI.

    python -m authoring report                 defter durumu, bosluklar
    python -m authoring plan --count=5         brief uret, prompt dosyasi yaz
    python -m authoring write --count=3        brief -> LLM -> kapi -> diske
    python -m authoring arc --category=mind    zincir uret: tohum + odemeler
    python -m authoring ingest <dosya.json>    elle/disardan uretileni kapiya sok
    python -m authoring widen                  olu olaylarin kapilamasini gevset
    python -m authoring selftest               hattin kendi dort testi
    python -m authoring doctor                 sizinti ve kurulum kontrolu

Hattin tamami build-time'dir; oyun calisirken bu kodun hicbir parcasi yuklenmez.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
from pathlib import Path

from . import vocab
from .arcs import ArcComposer, ArcError
from .brief import BEATS, Brief, GatingCell
from .flags import prune_unused
from .gate import QualityGate, extract_json
from .ledger import SceneLedger, _primary_slot
from .planner import Planner, PlannerError, PROFILES
from .prompt import build, build_enrich, build_retry
from .providers.base import NullProvider, Provider, ProviderError, load_dotenv
from .providers.gemini import GeminiProvider

CACHE = Path("tools/authoring/.cache/ledger.json")
PROMPTS = Path(".prompts")
CORE = Path("content/orchestrator/core.json")
MAX_RETRIES = 3


def _setup(root: Path):
    load_dotenv(root / ".env")
    v = vocab.load(root)
    ledger = SceneLedger(root / CACHE)
    ledger.scan_existing(root / "content" / "events")
    ledger.scan_pending(root / PROMPTS)
    return v, ledger


def _provider(name: str) -> Provider:
    if name == "gemini":
        return GeminiProvider()
    return NullProvider()


# --------------------------------------------------------------------- report


def cmd_report(args, root: Path) -> int:
    v, ledger = _setup(root)
    report = ledger.report()

    print("=== SAHNE DEFTERI ===\n")
    print(f"Olay        : {report['olay']}")
    print(f"Sahne imzasi: {report['toplam_sahne']}\n")

    print("KATEGORI DOLULUGU")
    for cat in v.categories:
        n = report["kategori"].get(cat, 0)
        bar = "#" * min(n, 30)
        mark = "  <- bos" if n == 0 else ("  <- ince" if n < 6 else "")
        print(f"  {cat:12} {n:3} {bar}{mark}")

    unused_slots = ledger.unused_slots(tuple(s.id for s in v.slots))
    print(f"\nHIC SAHNEYE CIKMAMIS SLOT: {len(unused_slots)}/{len(v.slots)}")
    for i in range(0, len(unused_slots), 6):
        print("  " + ", ".join(unused_slots[i : i + 6]))

    unused_beats = report["hic_kullanilmamis_beat"]
    print(f"\nHIC KULLANILMAMIS BEAT: {len(unused_beats)}")
    if unused_beats:
        print("  " + ", ".join(unused_beats))

    print("\n--- 30 SEZON HEDEFI ---")
    scenes = _count_scenes(root / "content" / "events")
    print(f"  mevcut sahne (node) : {scenes}")
    print(f"  hedef               : ~1100")
    print(f"  acik                : {max(0, 1100 - scenes)}")
    return 0


def _count_scenes(events_dir: Path) -> int:
    total = 0
    for path in events_dir.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if "nodes" in data:
            total += len(data["nodes"])
        for variant in data.get("variants", []):
            total += len(variant.get("nodes", {}))
    return total


# ----------------------------------------------------------------------- plan


def cmd_plan(args, root: Path) -> int:
    v, ledger = _setup(root)
    planner = Planner(v, ledger, seed=args.seed)

    try:
        briefs = planner.plan(
            args.count,
            category=args.category,
            life_state=args.life_state,
            era=args.era,
        )
    except PlannerError as err:
        print(f"HATA: {err}", file=sys.stderr)
        return 1

    out_dir = root / PROMPTS
    out_dir.mkdir(parents=True, exist_ok=True)

    for brief in briefs:
        _dump_brief(brief, out_dir)
        cell = brief.cell
        print(
            f"  {brief.event_id:46} {brief.tier:6} "
            f"beat={brief.beat:16} era={','.join(cell.era)}"
        )

    print(f"\n{len(briefs)} brief -> {out_dir}/")
    print("Prompt'lari doldurup `python -m authoring ingest <dosya>` ile iceri alin,")
    print("ya da `python -m authoring write` ile modele yazdirin.")
    return 0


def _dump_brief(brief: Brief, out_dir: Path) -> None:
    """Brief'i diske birakir; defter bunu bekleyen imza olarak sayar."""
    (out_dir / f"{brief.event_id}.prompt.txt").write_text(build(brief), encoding="utf-8")
    (out_dir / f"{brief.event_id}.brief.json").write_text(
        json.dumps(brief.to_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------- write


def cmd_write(args, root: Path) -> int:
    v, ledger = _setup(root)
    provider = _provider(args.provider)
    if not provider.available:
        print(
            f"HATA: '{args.provider}' saglayicisi kullanilamiyor. "
            "GEMINI_API_KEY tanimli mi?",
            file=sys.stderr,
        )
        return 1

    planner = Planner(v, ledger, seed=args.seed)
    gate = QualityGate(root)

    try:
        briefs = planner.plan(
            args.count,
            category=args.category,
            life_state=args.life_state,
            era=args.era,
        )
    except PlannerError as err:
        print(f"HATA: {err}", file=sys.stderr)
        return 1

    written = 0
    for brief in briefs:
        print(f"\n>> {brief.event_id}  [{brief.tier}/{brief.beat}]")
        event = _generate_with_gate(brief, provider, gate, verbose=args.verbose)
        if event is None:
            print("   kapidan gecemedi, atlandi")
            continue
        path = gate.commit(event, brief.category)
        ledger.register(brief)
        written += 1
        print(f"   yazildi: {path.relative_to(root)}")

    ledger.save()
    print(f"\n{written}/{len(briefs)} sahne korpusa girdi.")
    return 0 if written else 1


def _generate_with_gate(
    brief: Brief,
    provider: Provider,
    gate: QualityGate,
    verbose: bool = False,
    avoid: list[dict] | None = None,
    pending_traces: frozenset[str] = frozenset(),
) -> dict | None:
    """Uret -> denetle -> hatalari geri besle. En fazla `MAX_RETRIES` deneme."""
    prompt = build(brief, avoid=avoid)
    previous = ""

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            raw = provider.generate(prompt)
        except ProviderError as err:
            print(f"   saglayici hatasi: {err}")
            return None

        try:
            event = extract_json(raw)
        except (ValueError, json.JSONDecodeError) as err:
            print(f"   deneme {attempt}: gecersiz JSON ({err})")
            prompt = build_retry(brief, raw[:2000], [f"Gecersiz JSON: {err}"])
            previous = raw
            continue

        event = _enforce_contract(event, brief)
        violations = _contract_violations(event, brief)
        result = gate.check(event, brief.category, pending_traces)
        errors = violations + result.errors
        print(f"   deneme {attempt}: {result.summary()}" + (
            f", {len(violations)} sozlesme ihlali" if violations else ""
        ))

        if result.ok and not violations:
            return event

        if verbose:
            for e in errors[:6]:
                print(f"      {e}")

        previous = json.dumps(event, ensure_ascii=False, indent=2)
        prompt = build_retry(brief, previous, errors)

    return None


# Flag efekti operatorleri. Bunlarin disindaki `op` bir KOSULDUR, yani okumadir.
WRITE_OPS = frozenset({"set", "add", "mul", "unset"})


def _memory_usage(node: object) -> tuple[set[str], set[str]]:
    """Olayin yazdigi ve okudugu `mem_*` izlerini ayirir."""
    writes: set[str] = set()
    reads: set[str] = set()

    def walk(value: object) -> None:
        if isinstance(value, dict):
            flag = value.get("flag")
            if isinstance(flag, str) and flag.startswith("mem_"):
                (writes if value.get("op") in WRITE_OPS else reads).add(flag)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return writes, reads


def _transitions(node: object) -> set[str]:
    """Olayin actigi DURUM GECISLERI -- kanonik imzalariyla.

    "lifeState:incarcerated", "suspend:3", "clubTier:lower",
    "schedule:evt_x" bicimindedir. Varyantin ayni kapilari acmasi
    gerektigini `_contract_violations` bu kumeye bakarak denetler.
    """
    out: set[str] = set()

    def walk(value: object) -> None:
        if isinstance(value, dict):
            op = value.get("op")
            if op == "lifeState":
                out.add(f"lifeState:{value.get('to')}")
            elif op == "clubTier":
                out.add(f"clubTier:{value.get('to')}")
            elif op == "suspend":
                out.add(f"suspend:{value.get('matches')}")
            elif op == "schedule":
                out.add(f"schedule:{value.get('event')}")
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return out


def _incidents(node: object) -> set[str]:
    """Olayin ACTIGI incident'ler.

    Iki bicimde gecerler: `op: match` efektinde `incident: "..."` alani,
    ya da dogrudan bir `inc_*` bayragi.
    """
    out: set[str] = set()

    def walk(value: object) -> None:
        if isinstance(value, dict):
            inc = value.get("incident")
            if isinstance(inc, str):
                out.add(inc)
            flag = value.get("flag")
            if isinstance(flag, str) and flag.startswith("inc_"):
                out.add(flag)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    return out


def _contract_violations(event: dict, brief: Brief) -> list[str]:
    """Kelebek sozlesmesini modelin tutup tutmadigini denetler.

    `_enforce_contract` kimligi ve kapilamayi ustune yazar ama EFEKTLERE
    dokunamaz -- proza oradadir. Model brief'te olmayan bir iz yazarsa o izi
    kimse okumaz: zincir kapali planlanmis olsa bile korpusta yetim kelebek
    kalir. Eksik yazim daha da kotudur; odeme hic birakilmamis bir izi okur
    ve olay hicbir kariyerde tetiklenmez.
    """
    writes, reads = _memory_usage(event)
    promised_w = set(brief.writes_memory)
    promised_r = set(brief.reads_memory)

    out: list[str] = []
    for extra in sorted(writes - promised_w):
        allowed = ", ".join(sorted(promised_w)) or "hicbiri"
        out.append(
            f'SOZLESME: brief\'te olmayan iz yaziliyor: "{extra}". '
            f"Bu sahnenin yazabilecegi tek iz: {allowed}."
        )
    if brief.variant_of is None:
        # YENI OLAY: vaat edilen HER iz yazilmali.
        for missing in sorted(promised_w - writes):
            out.append(
                f'SOZLESME: brief\'in istedigi iz yazilmamis: "{missing}". '
                "Bir `outcome` node'unun `onEnter` alaninda `set` ile yaz."
            )
    elif not writes:
        # VARYANT: olayin izlerinden EN AZ BIRINI yazmali, hepsini degil.
        #
        # Eskiden varyanttan olayin TUM izlerini yazmasi isteniyordu.
        # `evt_react_hero_night` bes izi bes ayri sonuca dagitiyor; tek
        # bir varyantin besini birden yazmasi imkansiz. Sonuc: kariyerde
        # 248 kez gorulen -- en cok gorulen -- sahne uc denemenin
        # ucunde de reddedildi ve hic cesitlenemedi.
        #
        # Dogru kural: izlerin ALT KUMESI, bos olmamak sartiyla.
        # Fazladan iz yazmak yukarida zaten yasak.
        allowed = ", ".join(sorted(promised_w)) or "hicbiri"
        out.append(
            "SOZLESME: varyant en az bir iz yazmali. "
            f"Bu olayin izlerinden birini secip `onEnter` ile yaz: {allowed}."
        )
    # INCIDENT SOZLESMESI.
    #
    # Mac anlari incident'lerin KAYNAGIDIR: `inc_var_against`,
    # `inc_scored_penalty`, `inc_injured_in_match`... Tepki sahneleri ve
    # zincirler bunlarla tetiklenir.
    #
    # Olculdu: `momentType` elemesi kaldirilinca uretilen 30 mac varyanti
    # incident'leri HIC tasimadi. Motor o varyanti sectiginde mac
    # sonucsuz kaliyor ve VAR -> roportaj -> PFDK -> ceza gibi zincirler
    # sessizce oluyor. Bu, yalnizca bir test kirilmasi degil oyunun
    # sonuc sisteminin delinmesiydi.
    expected_inc = set(brief.expects_incidents or ())
    if expected_inc:
        got = _incidents(event)
        for missing in sorted(expected_inc - got):
            out.append(
                f'SOZLESME: bu olay "{missing}" olayini acar; varyant da acmali. '
                "Bir `outcome` node'unun `onEnter` alanina "
                f'{{"op": "match", "incident": "{missing}"}} ekleyin.'
            )

    # DURUM GECISI SOZLESMESI.
    #
    # Ayni gerekce `expects_incidents` ile bire bir: varyant olayin actigi
    # kapiyi acmazsa oyuncu kapinin arkasinda kalir ve hicbir kural bunu
    # yakalamaz -- her iki varyant da tek basina gecerlidir.
    #
    # Bu sozlesme yazilana kadar gecis tasiyan olaylar varyant uretiminden
    # TAMAMEN disariydi (`_variant_targets`), yani sahne butcesinin bir
    # kismi erisilemez kaliyordu.
    expected_tr = set(brief.expects_transitions or ())
    if expected_tr:
        got_tr = _transitions(event)
        for missing in sorted(expected_tr - got_tr):
            kind, _, value = missing.partition(":")
            out.append(
                f'SOZLESME: bu olay bir KAPI aciyor ({kind} -> {value}); varyant da '
                f"acmali, yoksa oyuncu kapinin arkasinda kalir."
            )

    for missing in sorted(promised_r - reads):
        out.append(
            f'SOZLESME: bu sahne bir ODEME; "{missing}" izini `trigger` ya da bir '
            "secimin `requires` alaninda okumali."
        )
    return out


def _enforce_contract(event: dict, brief: Brief) -> dict:
    """Brief'in PAZARLIKSIZ alanlarini modelin ustune yazar.

    Model prozayi yazar; kimlik, kategori ve kapilama BRIEF'IN karari. Modelin
    bunlari degistirmesine izin vermek, defterin tuttugu imzayla diske yazilan
    dosyayi ayirir ve tekrar denetimi anlamsizlasir.
    """
    cell = brief.cell
    event["id"] = brief.event_id
    event["category"] = brief.category
    event["family"] = brief.family
    event["tier"] = brief.tier
    event.setdefault("weight", brief.weight)
    event["cooldown"] = {"self": brief.cooldown_self, "family": brief.cooldown_family}
    if brief.once:
        event["once"] = True

    for key, values in (
        ("eras", cell.era),
        ("stature", cell.stature),
        ("clubTiers", cell.club_tier),
        ("lifeStates", cell.life_state),
    ):
        if values:
            event[key] = list(values)
        else:
            event.pop(key, None)

    # Model bos alanlari `null` ile doldurma egiliminde. Ayristirici bunu
    # yutuyor ama sema yutmuyor -- ve hakli: "trigger": null, alani hic
    # yazmamakla ayni sey, fazladan gurultu.
    for key in [k for k, v in event.items() if v is None]:
        del event[key]
    return event


# ------------------------------------------------------------------------ arc


def cmd_arc(args, root: Path) -> int:
    """Bir zinciri TEK PARCA uretir: tohum + odemeler.

    Zincir ya butun halinde korpusa girer ya da hic girmez. Yarim zincir,
    okuyucusu olmayan bir `mem_*` demektir: oyuncu bir karar verir, faturasi
    hic gelmez ve `OrphanMemoryFlagRule` bunu ancak sonradan uyari olarak
    bildirir. Bu yuzden bir halka kapiyi gecemezse yazilanlar geri alinir.
    """
    v, ledger = _setup(root)
    composer = ArcComposer(v, ledger, seed=args.seed)

    try:
        arc = composer.compose(args.category, payoffs=args.payoffs)
    except (ArcError, PlannerError) as err:
        print(f"HATA: {err}", file=sys.stderr)
        return 1

    print(f"zincir: {arc.chain_id}  ({arc.title})\n")
    for brief in arc.all_briefs():
        when = f"+{brief.delay_turns} tur" if brief.delay_turns else "tohum"
        print(f"  {brief.event_id:52} {brief.chain_role:9} {when:9} beat={brief.beat}")

    if args.dry_run:
        out_dir = root / PROMPTS
        out_dir.mkdir(parents=True, exist_ok=True)
        for brief in arc.all_briefs():
            _dump_brief(brief, out_dir)
        print(f"\n--dry-run: {len(arc.all_briefs())} brief -> {out_dir}/")
        return 0

    provider = _provider(args.provider)
    if not provider.available:
        print(f"HATA: '{args.provider}' saglayicisi kullanilamiyor.", file=sys.stderr)
        return 1

    gate = QualityGate(root)
    core = root / CORE
    core_snapshot = core.read_text(encoding="utf-8")
    cache_dir = root / PROMPTS
    cache_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    # ZINCIRIN ILAN ETTIGI IZLER.
    #
    # Tohum izi yazmak ZORUNDA (brief sozlesmesi) ama o izi okuyan odeme
    # sahneleri henuz uretilmemis. `OrphanMemoryFlagRule` bu yuzden tohumu
    # her denemede reddediyordu ve HICBIR zincir uretilemiyordu -- kapi
    # kendi kendini kilitliyordu.
    #
    # Bu adlar ARA adimlarda tolere edilir; zincir bittiginde toleransSIZ
    # tam dogrulama yapilir.
    pending = frozenset(
        flag for brief in arc.all_briefs() for flag in brief.writes_memory
    )

    for brief in arc.all_briefs():
        print(f"\n>> {brief.event_id}  [{brief.tier}/{brief.beat}]")
        cached = cache_dir / f"{brief.event_id}.json"

        event = _reuse(cached, brief, gate)
        if event is not None:
            print("   onbellekten alindi (API cagrisi yok)")
        else:
            event = _generate_with_gate(
                brief, provider, gate, verbose=args.verbose, pending_traces=pending
            )

        if event is None:
            for path in written:
                path.unlink(missing_ok=True)
            core.write_text(core_snapshot, encoding="utf-8")
            print(
                f"\nZINCIR KIRILDI: {brief.event_id} kapidan gecemedi. "
                f"{len(written)} sahne geri alindi (uretilmis olanlar "
                f"{PROMPTS}/ altinda duruyor, tekrar calistirinca kullanilir).",
                file=sys.stderr,
            )
            return 1

        cached.write_text(
            json.dumps(event, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        written.append(gate.commit(event, brief.category))
        print(f"   yazildi: {written[-1].relative_to(root)}")

    # SON DENETIM -- toleransSIZ.
    #
    # Ara adimlarda zincirin izleri hos goruldu; simdi hepsi diskte ve
    # okuyucularin GERCEKTEN var olmasi gerekiyor. Gecmezse zincir geri
    # alinir: yarim zincir, faturasi hic gelmeyen bir karar demektir.
    final = gate.check_corpus()
    if not final.ok:
        for path in written:
            path.unlink(missing_ok=True)
        core.write_text(core_snapshot, encoding="utf-8")
        print(
            f"\nZINCIR GERI ALINDI: son denetim {len(final.errors)} hata verdi.",
            file=sys.stderr,
        )
        for line in final.errors[:6]:
            print(f"   {line}", file=sys.stderr)
        return 1

    for brief in arc.all_briefs():
        ledger.register(brief)
        (cache_dir / f"{brief.event_id}.json").unlink(missing_ok=True)
    ledger.save()
    print(f"\nzincir tamam: {len(written)} sahne korpusa girdi.")
    return 0


def _reuse(path: Path, brief: Brief, gate: QualityGate) -> dict | None:
    """Onceki turda uretilmis ama yayimlanamamis sahneyi geri getirir.

    Model cagrilari kotalidir: zincirin son halkasinda kota bitince tum
    zinciri bastan uretmek hem kotayi hem zamani ikinci kez yakar.

    Onbellekten gelen sahne YINE kapidan gecer. Klon denetimi korpusa gore
    yapilir ve korpus bu arada degismis olabilir; onbellege guvenmek kapiyi
    delmek olurdu.
    """
    if not path.exists():
        return None
    try:
        event = extract_json(path.read_text(encoding="utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None

    event = _enforce_contract(event, brief)
    if _contract_violations(event, brief):
        return None
    return event if gate.check(event, brief.category).ok else None


# --------------------------------------------------------------------- ingest


def cmd_ingest(args, root: Path) -> int:
    """Elle yazilmis sahneleri kapiya sokar.

    BIRDEN COK DOSYA birlikte alinabilir ve BIRLIKTE dogrulanir. Sebebi
    zincir uretimindekiyle ayni: bir sahne iz birakiyorsa (`mem_*`) o izi
    OKUYAN sahne de ayni anda korpusa girmeli, yoksa `OrphanMemoryFlagRule`
    tohumu reddeder ve elle zincir yazmak imkansizlasir.

    Ya hepsi girer ya hicbiri: yarim zincir, oyuncunun verdigi bir kararin
    faturasinin hic gelmemesi demektir.
    """
    v, ledger = _setup(root)
    gate = QualityGate(root)

    events: list[tuple[dict, str]] = []
    for raw_path in args.path:
        path = Path(raw_path)
        try:
            event = extract_json(path.read_text(encoding="utf-8"))
        except (ValueError, json.JSONDecodeError) as err:
            print(f"HATA: {path} icinde gecerli JSON yok: {err}", file=sys.stderr)
            return 1
        category = event.get("category")
        if category not in v.categories:
            print(f"HATA: {path}: gecersiz kategori: {category}", file=sys.stderr)
            return 1
        events.append((event, category))

    core = root / CORE
    core_snapshot = core.read_text(encoding="utf-8")
    written: list[Path] = []

    # Once HEPSINI yaz, sonra TEK SEFERDE dogrula. Tek tek dogrulamak
    # zinciri kirar: tohum okuyucusundan once gelir ve yetim gorunur.
    try:
        for event, category in events:
            written.append(gate.commit(event, category))

        result = gate.check_corpus()
        print(result.summary())
        if not result.ok:
            for e in result.errors:
                print(f"  {e}")
            raise _IngestRejected()
    except _IngestRejected:
        for path in written:
            path.unlink(missing_ok=True)
        core.write_text(core_snapshot, encoding="utf-8")
        print(
            f"GERI ALINDI: {len(written)} sahne yazilmadi.", file=sys.stderr
        )
        return 1

    for path in written:
        print(f"yazildi: {path.relative_to(root)}")
    return 0


class _IngestRejected(Exception):
    """Ic kontrol akisi -- geri alma yolunu tek yerde toplar."""


# ------------------------------------------------------------------- enrich

# Tier basina EN AZ kelime (validator ile ayni) ve HEDEF uzunluk.
#
# Esigi kil payi gecirmek dolgu yazdirmaktir; hedef bilerek daha yukarida
# tutuluyor cunku asil is metni okunur kilmak, uyariyi susturmak degil.
_ENRICH_FLOOR = {"minor": 12, "major": 18, "epic": 20}
_ENRICH_IDEAL = {"minor": 30, "major": 45, "epic": 55}


def _node_sets(event: dict):
    """(sahip, dugumler) ikilileri: ana olay ve her varyant AYRI.

    DIKKAT: varyantlar ana olayla AYNI dugum kimliklerini kullanir
    (`n_gri`, `n_guvenli`...). Hepsini tek havuzda toplamak, bir metni
    hepsine birden yazmak demektir -- ve birebir ayni metinler
    `TextQualityRule`a klon olarak takilir. Ilk yazimda tam olarak bu
    oldu ve zenginlestirmelerin yarisi bu yuzden reddedildi.
    """
    yield "", event.get("nodes", {})
    for variant in event.get("variants", []):
        yield variant.get("id", ""), variant.get("nodes", {})


def _qualify(owner: str, node_id: str) -> str:
    return f"{owner}::{node_id}" if owner else node_id


def _short_outcomes(event: dict) -> list[str]:
    """Tier esiginin ALTINDA kalan `outcome` dugumleri -- NITELIKLI kimlikle."""
    floor = _ENRICH_FLOOR.get(event.get("tier", "minor"), 12)
    out: list[str] = []
    for owner, nodes in _node_sets(event):
        for nid, node in nodes.items():
            if node.get("kind") != "outcome":
                continue
            if len(node.get("text", "").split()) < floor:
                out.append(_qualify(owner, nid))
    return out


def _splice_texts(event: dict, texts: dict[str, str]) -> dict:
    """Yalnizca METINLERI orijinalin ustune koyar.

    Modele tum olayi geri yazdirmak yapinin sessizce kaymasina yol acar
    (efekt kaybi, secenek id degisimi, kaybolan kilit). Burada yapinin
    degismesi YAPISAL olarak imkansiz: yalnizca `text` alanlari degisir.
    """
    out = json.loads(json.dumps(event))
    for qualified, text in texts.items():
        if not isinstance(text, str) or not text.strip():
            continue
        owner, _, nid = qualified.rpartition("::")
        for candidate_owner, nodes in _node_sets(out):
            if candidate_owner != owner:
                continue
            if nid in nodes:
                nodes[nid]["text"] = text.strip()
    return out


def cmd_enrich(args, root: Path) -> int:
    """Kisa `outcome` metinlerini zenginlestirir.

    Olay basina TEK model cagrisi yapilir (dugum basina degil): 401 kisa
    dugum yalnizca 108 olayda toplaniyor, yani dort kat daha az kota.
    """
    _setup(root)
    gate = QualityGate(root)
    provider = _provider(args.provider)
    if not provider.available:
        print(f"HATA: '{args.provider}' saglayicisi kullanilamiyor.", file=sys.stderr)
        return 1

    events_dir = root / "content" / "events"
    targets: list[tuple[Path, dict, list[str]]] = []
    for path in sorted(events_dir.rglob("*.json")):
        event = json.loads(path.read_text(encoding="utf-8"))
        if args.category and event.get("category") != args.category:
            continue
        short = _short_outcomes(event)
        if short:
            targets.append((path, event, short))

    if not targets:
        print("Zenginlestirilecek kisa metin yok.")
        return 0

    print(f"{len(targets)} olayda kisa metin var; {args.count} tanesi islenecek.\n")
    done = 0
    for path, event, short in targets[: args.count]:
        tier = event.get("tier", "minor")
        print(f">> {event['id']}  ({len(short)} kisa dugum, tier {tier})")

        prompt = build_enrich(
            event, short, _ENRICH_FLOOR.get(tier, 12), _ENRICH_IDEAL.get(tier, 30)
        )
        ok = False
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                raw = provider.generate(prompt)
            except ProviderError as err:
                print(f"   saglayici hatasi: {err}")
                return 1
            try:
                texts = extract_json(raw)
            except (ValueError, json.JSONDecodeError) as err:
                print(f"   deneme {attempt}: gecersiz JSON ({err})")
                continue

            candidate = _splice_texts(event, texts)
            still = _short_outcomes(candidate)
            if still:
                print(f"   deneme {attempt}: hala kisa: {', '.join(still)}")
                continue

            result = gate.check(candidate, event["category"])
            if not result.ok:
                print(f"   deneme {attempt}: {result.summary()}")
                if args.verbose:
                    for e in result.errors[:4]:
                        print(f"      {e}")
                continue

            gate.commit(candidate, event["category"])
            print(f"   zenginlestirildi ({len(short)} dugum)")
            ok = True
            done += 1
            break

        if not ok:
            print("   atlandi")

    print(f"\n{done}/{min(args.count, len(targets))} olay zenginlestirildi.")
    return 0


# ------------------------------------------------------------------- selftest


def cmd_selftest(args, root: Path) -> int:
    """Hattin dogru calistigini VARSAYMAK yerine sinar.

    Kapinin kapanmadigini yuzlerce sahne uretildikten sonra fark etmek, bu
    testleri her uretim oncesi calistirmaktan cok daha pahalidir.
    """
    from .selftest import run_all

    results = run_all(root, skip_slow=args.hizli)

    print("=== HAT TESTLERI ===\n")
    for name, ok, detail in results:
        print(f"  [{'GECTI' if ok else 'KALDI'}] {name}")
        print(f"          {detail}\n")

    failed = [name for name, ok, _ in results if not ok]
    if failed:
        print(f"{len(failed)}/{len(results)} test BASARISIZ: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"{len(results)} testin hepsi gecti.")
    return 0


# -------------------------------------------------------------------- variant


def cmd_variant(args, root: Path) -> int:
    """Mevcut olaya IKINCI BIR SAHNE ekler.

    Varyant ayni sozlesmeyi (kapilama, slot, birakilan iz) paylasir, farkli
    sahne anlatir; motor gorulmemis olani secer. Yeni olay yazmaya gore uc kat
    ucuz: kapilama, aile, cooldown ve iz zaten kurulmus durumda.

    Ayni iz yeniden yazildigi icin varyant YENI YETIM URETMEZ -- yeni olay
    yazmanin en pahali yan etkisi budur.
    """
    v, ledger = _setup(root)
    provider = _provider(args.provider)
    if not provider.available:
        print(f"HATA: '{args.provider}' saglayicisi kullanilamiyor.", file=sys.stderr)
        return 1

    gate = QualityGate(root)
    rng = random.Random(args.seed)
    planner = Planner(v, ledger, seed=args.seed)
    targets = _variant_targets(root, args.category, args.count, args.max)
    if not targets:
        print("Varyant eklenecek uygun olay bulunamadi.")
        return 1

    written = 0
    for path, data in targets:
        brief = _variant_brief(data, planner, v, rng)
        if brief is None:
            print(f"  {data['id']:44} varyant brief'i kurulamadi, atlandi")
            continue
        if ledger.is_taken(brief):
            print(f"  {data['id']:44} bu beat zaten kullanilmis, atlandi")
            continue

        have = len(data.get("variants", ())) or 1
        print(f"\n>> {data['id']}  [{have} -> {have + 1} varyant / {brief.beat}]")
        # SEKIL icin ayri deneme dongusu: model ilk seferde cogu zaman
        # mekani degistiriyor ama iskeleti degistirmiyor. Reddedip
        # tekrar istemek, tek cumlelik ricadan cok daha etkili.
        merged = None
        for shape_try in range(1, 4):
            produced = _generate_with_gate(
                brief, provider, gate, verbose=args.verbose, avoid=_existing_scenes(data)
            )
            if produced is None:
                print("   kapidan gecemedi, atlandi")
                break
            candidate = _merge_variant(data, produced, brief.beat)
            clash = _shape_clash(candidate)
            if not clash:
                merged = candidate
                break
            print(f"   sekil denemesi {shape_try}: {clash}")
        if merged is None:
            continue

        # SEKIL AYRIKLIGI -- kapinin en sert kurali.
        #
        # Olculdu: 271 varyant ciftinin %97'si ayni sayida secenege, %93'u
        # ayni kilit desenine sahipti. Prompt'a "KACINILACAK" bolumu
        # eklemek mekani ve bayraklari cesitlendirdi ama iskeleti tam
        # cozmedi -- uc denemenin ikisi hala 4 secenek + 1 kilit cikti.
        #
        # Dogrulayici bunu `warn` olarak goruyor ve kapi warn'a takilmaz;
        # yuzlerce sahne uretilirken ayni tekduzelik olcekte yeniden
        # uretilirdi. Bu yuzden ayriklik BURADA, yazmadan once dayatilir.
        result = gate.check(merged, data["category"])
        if not result.ok:
            print(f"   birlesik olay reddedildi: {result.summary()}")
            if args.verbose:
                for e in result.errors[:4]:
                    print(f"      {e}")
            continue

        gate.commit(merged, data["category"])
        ledger.register(brief)
        written += 1
        n = len(merged["variants"])
        print(f"   yazildi: {path.relative_to(root)}  ({n} varyant)")

    ledger.save()
    print(f"\n{written}/{len(targets)} olaya varyant eklendi.")
    return 0 if written else 1


def _variant_shape(variant: dict) -> tuple[int, str, str]:
    """Bir varyantin iskeleti: (secenek sayisi, kilit deseni, bayrak seti)."""
    node = variant.get("nodes", {}).get(variant.get("rootNode"), {})
    choices = node.get("choices", [])
    locks = "|".join(
        "-" if "requires" not in c else str(c["requires"].get("flag", "?")) for c in choices
    )
    flags = ",".join(
        sorted({e["flag"] for c in choices for e in c.get("effects", []) if "flag" in e})
    )
    return (len(choices), locks, flags)


def _shape_clash(merged: dict) -> str:
    """Yeni varyant mevcutlardan yeterince ayrisiyor mu.

    Kural `VariantDistinctnessRule` ile AYNI: uc eksenden en az IKISINDE
    ayrismali. Ikisi ya da ucu tutuyorsa reddedilir; model yeniden dener.
    """
    variants = merged.get("variants", [])
    if len(variants) < 2:
        return ""
    fresh = _variant_shape(variants[-1])
    for prev in variants[:-1]:
        old = _variant_shape(prev)
        same = [fresh[0] == old[0], fresh[1] == old[1], fresh[2] == old[2]]
        if sum(same) >= 2:
            axes = [n for n, ok in zip(("secenek sayisi", "kilit deseni", "bayrak seti"), same) if ok]
            return f"{prev['id']} ile ayni: {' + '.join(axes)}"
    return ""


def _existing_scenes(data: dict) -> list[dict]:
    """Bir olayin mevcut anlatimlarinin ozeti -- prompt'un KACINILACAK bolumu.

    Model bunlari gormeden yazdiginda neyin kalibindan kacinacagini
    bilemiyor; olculdu ki varyant ciftlerinin %97'si ayni iskelette
    cikiyordu.
    """
    out: list[dict] = []
    units = (
        [("", data.get("rootNode"), data.get("nodes", {}))]
        if data.get("nodes")
        else [(v.get("id", ""), v.get("rootNode"), v.get("nodes", {})) for v in data.get("variants", ())]
    )
    for _vid, root, nodes in units:
        node = nodes.get(root) if root else None
        if not node:
            continue
        choices = node.get("choices", [])
        out.append(
            {
                "title": node.get("title", "?"),
                "text": node.get("text", ""),
                "count": len(choices),
                "choices": " | ".join(c.get("text", "")[:60] for c in choices),
            }
        )
    return out


def _variant_targets(
    root: Path, category: str | None, count: int, maximum: int
) -> list[tuple[Path, dict]]:
    """Varyanta en cok ihtiyaci olan olaylar.

    Once EN AZ varyanti olan ve en agir olaylar: `epic` bir sahnenin kariyerde
    ikinci kez ayni metinle cikmasi, `beat` bir sahnenin tekrarindan cok daha
    fazla batar.

    DURUM GECISI tasiyan olaylar disarida kalir. `lifeState` ya da `clubTier`
    degistiren bir olay yalnizca sahne degil bir KAPIDIR: hapisten cikis,
    lige donus, sakatliktan donme. Varyant o gecisi yazmazsa oyuncu kapinin
    arkasinda kalir -- ve bunu hicbir kural yakalamaz cunku her iki varyant da
    tek basina gecerlidir.
    """
    out: list[tuple[Path, dict, int, int]] = []
    order = {"epic": 0, "major": 1, "minor": 2, "beat": 3}

    for path in sorted((root / "content" / "events").rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        have = len(data.get("variants", ())) or (1 if "nodes" in data else 0)
        if have == 0 or have >= maximum:
            continue
        if category and data.get("category") != category:
            continue
        if data.get("category") not in PROFILES:
            continue  # profili olmayan kategoriye brief kurulamaz
        if data.get("scheduledOnly"):
            continue  # sirali yay halkasi; varyant yayi bozar
        # `momentType` ARTIK ELEMEZ. Mac anlari kendi sozlesmesini tasir
        # ama varyant o sozlesmeyi degistirmez -- olay govdesi korunur ve
        # `EventSelector.forMoment` de varyant secer. Eski eleme, sahne
        # butcesinin %21'ini erisim disinda birakiyordu.
        # GECIS TASIYAN OLAYLAR ARTIK ELENMEZ.
        #
        # Eskiden elenirlerdi: varyant kapiyi acmazsa oyuncu arkasinda
        # kalir ve hicbir kural yakalamaz. Ama eleme, en cok tekrar eden
        # sahnelerin bir kismini erisim disinda birakiyordu.
        #
        # Artik `expects_transitions` sozlesmesi var: varyant olayin
        # actigi HER kapiyi acmak zorunda, yoksa kapidan gecemez.
        out.append((path, data, have, order.get(data.get("tier", "beat"), 3)))

    out.sort(key=lambda row: (row[2], row[3], row[1]["id"]))
    return [(p, d) for p, d, _, _ in out[:count]]


TRANSITION_OPS = frozenset({"lifeState", "clubTier", "schedule", "suspend"})


def _has_transition(node: object) -> bool:
    """Olay bir kapi mi aciyor -- yoksa yalnizca sahne mi."""
    if isinstance(node, dict):
        if node.get("op") in TRANSITION_OPS:
            return True
        return any(_has_transition(child) for child in node.values())
    if isinstance(node, list):
        return any(_has_transition(child) for child in node)
    return False


def cmd_unvariant(args, root: Path) -> int:
    """Varyant gecisini geri alir: `v_asil`i tekrar olayin govdesi yapar.

    DIKKAT -- BU KOMUT VERI SILER.
      `v_asil` disindaki BUTUN varyantlar kalicidir olarak gider; iyi olan
      da kotu olan da. Proje bir git deposu DEGIL, yani geri donus yok.
      Bu yuzden:
        * VARSAYILAN GUVENLI: `--force` verilmedikce hicbir sey yazilmaz
        * silinecek varyantlarin id'leri TEK TEK yazdirilir
        * `--keep` ile korunacak varyant id'leri belirtilebilir
        * yazimdan SONRA dogrulayici calisir; kirilirsa haber verir

    Kalite olcmez, secim yapmaz: zayif varyant ayiklamak icin degil,
    varyant gecisini toptan geri almak icindir.
    """
    reverted = 0
    removed_total = 0
    for path in sorted((root / "content" / "events").rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        variants = data.get("variants")
        if not variants:
            continue
        original = next((v for v in variants if v["id"] == "v_asil"), None)
        if original is None:
            continue  # elle yazilmis varyant seti, dokunma
        if args.only and data["id"] not in args.only:
            continue

        keep = set(getattr(args, "keep", None) or ())
        doomed = [v["id"] for v in variants if v["id"] != "v_asil" and v["id"] not in keep]
        if not doomed:
            continue

        print(f"  {data['id']}: SILINECEK -> {', '.join(doomed)}")
        removed_total += len(doomed)
        reverted += 1
        if not args.force:
            continue

        survivors = [v for v in variants if v["id"] in keep]
        restored = {k: v for k, v in data.items() if k != "variants"}
        if survivors:
            # Korunan varyant varsa olay VARYANTLI kalir: iki bicim
            # (duz `nodes` ve `variants`) ayni anda gecerli degil.
            restored.pop("rootNode", None)
            restored.pop("nodes", None)
            restored["variants"] = [original, *survivors]
        else:
            restored["rootNode"] = original["rootNode"]
            restored["nodes"] = original["nodes"]
        path.write_text(
            json.dumps(restored, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    if not args.force:
        print(
            f"\n{removed_total} varyant {reverted} olaydan SILINECEKTI. "
            "Hicbir sey yazilmadi."
        )
        print("Gercekten silmek icin: --force")
        return 0

    print(f"\n{reverted} olay sadelestirildi, {removed_total} varyant SILINDI.")

    # Silme sonrasi DOGRULAYICI. Eskiden calistirilmiyordu; silinen
    # varyantlarin beyan ettigi `mem_*` izleri ortada kalinca sessizce
    # bozuk bir korpus birakiyordu.
    print("dogrulayici calisiyor...")
    proc = subprocess.run(
        ["npm", "run", "validate", "--silent"],
        cwd=root,
        capture_output=True,
        text=True,
        shell=True,
    )
    for line in (proc.stdout or proc.stderr).strip().splitlines()[-3:]:
        print(f"  {line}")
    if proc.returncode != 0:
        print("  UYARI: korpus kirildi. Silinen izleri core.json'dan temizleyin.")
    return 0


def _variant_brief(data: dict, planner: Planner, v, rng: random.Random) -> Brief | None:
    """Mevcut olayin sozlesmesinden varyant brief'i turetir.

    Kapilama, slot ve iz OLAYDAN alinir -- varyant ayni olaydir, baska bir
    anlatimi. Yalnizca duygusal beat degisir; degismezse iki varyant ayni
    sahnenin farkli ismi olur ve defter bunu zaten reddeder.
    """
    profile = PROFILES.get(data.get("category", ""))
    if profile is None:
        return None

    slot = _primary_slot(data)
    if not any(s.id == slot for s in v.slots):
        return None

    writes, _ = _memory_usage(data)
    cell = GatingCell(
        era=tuple(data.get("eras", ())),
        stature=tuple(data.get("stature", ())),
        club_tier=tuple(data.get("clubTiers", ())),
        life_state=tuple(data.get("lifeStates", ())),
    )

    used = {v["id"] for v in data.get("variants", ())}
    beats = [
        b for b in profile["beats"]
        if b in BEATS and f"v_{b}" not in used and b not in data["id"]
    ]
    if not beats:
        return None
    beat = rng.choice(beats)

    tier = data.get("tier", "major")
    return Brief(
        event_id=f"{data['id']}__v{beat}",
        category=data["category"],
        family=data.get("family", f"fam_{data['category']}"),
        tier=tier,
        beat=beat,
        primary_slot=slot,
        cell=cell,
        writes_memory=tuple(sorted(writes)),
        expects_incidents=tuple(sorted(_incidents(data))),
        expects_transitions=tuple(sorted(_transitions(data))),
        variant_of=data["id"],
        choices=planner._choice_specs(tier, slot, cell.life_state, beat),
        premise=(
            f"{BEATS[beat]} Bu sahne mevcut bir olayin IKINCI ANLATIMI: ayni "
            f"kisi, ayni kariyer donemi, ayni sonuc -- ama bambaska bir olay. "
            f"Ilk anlatimin kalibini tekrar etme."
        ),
        weight=data.get("weight", 20),
        cooldown_self=data.get("cooldown", {}).get("self", 20),
        cooldown_family=data.get("cooldown", {}).get("family", 8),
    )


def _merge_variant(original: dict, produced: dict, beat: str) -> dict:
    """Yeni anlatimi varyant setine ekler; set yoksa kurar."""
    existing = original.get("variants")
    if existing is None:
        existing = [
            {
                "id": "v_asil",
                "rootNode": original["rootNode"],
                "nodes": original["nodes"],
            }
        ]

    merged = {k: val for k, val in original.items() if k not in ("nodes", "rootNode")}
    merged["variants"] = [
        *existing,
        {"id": f"v_{beat}", "rootNode": produced["rootNode"], "nodes": produced["nodes"]},
    ]
    return merged


# --------------------------------------------------------------------- widen


# Simulasyon ciktisindaki red ekseni -> olay dosyasindaki alan.
AXIS_FIELD = {
    "stature": "stature",
    "clubTier": "clubTiers",
    "era": "eras",
    "lifeState": "lifeStates",
}
DEAD_LINE = re.compile(r"^\s{2}(evt_\S+)\s+(\S+)/(\S+)\s+->\s+en sik red: (\w+)$")


def cmd_widen(args, root: Path) -> int:
    """OLU ICERIGI kapilamasini gevseterek diriltir.

    Hacim uretmek yetmiyor: dort dar eksenin kesisimi o kadar kucuk olabilir
    ki sahne hicbir kariyerde cikmaz. Bu gecis metne DOKUNMAZ -- yalnizca
    olayin hangi kariyer hucresinde gorunecegini ayarlar. Hangi eksenin
    daralttigini tahmin etmiyoruz; simulasyona soruyoruz.
    """
    dead = _dead_events(root)
    if not dead:
        print("Olu olay yok.")
        return 0

    print(f"{len(dead)} olu olay bulundu.\n")
    changed = 0

    for event_id, category, axis in dead:
        path = root / "content" / "events" / category / f"{event_id}.json"
        if not path.exists():
            print(f"  {event_id:44} dosya yok, atlandi")
            continue

        data = json.loads(path.read_text(encoding="utf-8"))
        note = _relax(data, axis, PROFILES.get(category, {}).get("eras"))
        if note is None:
            print(f"  {event_id:44} {axis:10} elle bakilmali")
            continue

        print(f"  {event_id:44} {axis:10} {note}")
        if not args.dry_run:
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        changed += 1

    if args.dry_run:
        print(f"\n--dry-run: {changed} olay degistirilecekti.")
    else:
        print(f"\n{changed} olayin kapilamasi gevsetildi. `npm run simulate` ile olcun.")
    return 0


def _dead_events(root: Path) -> list[tuple[str, str, str]]:
    proc = subprocess.run(
        ["npm", "run", "simulate", "--silent"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=True,
    )
    out: list[tuple[str, str, str]] = []
    for line in (proc.stdout or "").splitlines():
        match = DEAD_LINE.match(line)
        if match:
            out.append((match.group(1), match.group(2), match.group(4)))
    return out


def _relax(event: dict, axis: str, profile_eras: tuple[str, ...] | None) -> str | None:
    """Daraltan ekseni gevsetir; gevsetemezse None doner.

    `stature` ve `clubTier` cogu sahne icin ARAC eksenidir: sahne gercekten
    o bandda gecmek zorunda degilse kisitlamak yalnizca onu gorunmez yapar.

    `era` boyle degil -- sahnenin bir yasi vardir. Kaldirilmaz, iki yana birer
    adim genisletilir ve KATEGORININ dogal penceresini asamaz: cirakta mafya
    avukati sahnesi acmak, olu icerigi diriltmek degil sacma icerik uretmektir.
    """
    field = AXIS_FIELD.get(axis)
    if field is None or field not in event:
        return None

    if axis in ("stature", "clubTier"):
        del event[field]
        return "eksen kaldirildi"

    if axis == "era":
        order = ["rookie", "rise", "prime", "veteran", "twilight"]
        window = [e for e in order if profile_eras is None or e in profile_eras]
        current = [e for e in event[field] if e in window]
        if not current or len(current) >= len(window):
            return None
        lo = max(0, min(window.index(e) for e in current) - 1)
        hi = min(len(window) - 1, max(window.index(e) for e in current) + 1)
        widened = window[lo : hi + 1]
        if widened == current:
            return None
        event[field] = widened
        return f"{','.join(current)} -> {','.join(widened)}"

    if axis == "lifeState" and "playing" not in event[field]:
        event[field] = sorted({*event[field], "playing"})
        return "playing eklendi"

    return None


# --------------------------------------------------------------------- doctor


def cmd_doctor(args, root: Path) -> int:
    """Kurulum ve SIZINTI kontrolu."""
    load_dotenv(root / ".env")
    ok = True

    print("=== KURULUM ===")
    v = vocab.load(root)
    print(f"  sozluk       : {len(v.slots)} slot, {len(v.memory_flags)} mem_* flag")

    gemini = GeminiProvider()
    # Kac anahtar var: ucretsiz kota PROJE basinadir (gunluk 500), anahtar
    # basina degil. Ayni projedeki ikinci anahtar ayni kotayi paylasir;
    # ancak FARKLI projedeki anahtar taze kota getirir. Sayiyi gostermek,
    # "yeni anahtar ekledim ama hala 429" durumunu tanilanabilir yapar.
    count = getattr(gemini, "keyCount", 1 if gemini.available else 0)
    print(
        f"  gemini       : {'anahtar var' if gemini.available else 'ANAHTAR YOK'}"
        + (f" ({count} anahtar)" if count > 1 else "")
    )
    print(f"  model        : {gemini.model}")

    if gemini.available and args.models:
        try:
            names = gemini.models()
        except ProviderError as err:
            ok = False
            print(f"  MODEL LISTESI ALINAMADI: {err}")
        else:
            print(f"  erisilebilir : {len(names)} model")
            for name in names:
                mark = "  <- secili" if name == gemini.model else ""
                print(f"      {name}{mark}")
            if gemini.model not in names:
                ok = False
                print(f"  UYARI: secili model '{gemini.model}' listede yok.")

    gitignore = (root / ".gitignore").read_text(encoding="utf-8")
    env_ignored = ".env" in gitignore
    print(f"  .env korumasi: {'gitignore icinde' if env_ignored else 'KORUNMUYOR'}")
    ok &= env_ignored

    # Basarisiz bir uretim turu `core.json`a iz beyani birakmis olabilir.
    # Zararsizdir ama registry'yi kirletir ve gercek izleri gizler.
    dead = prune_unused(root / CORE, root / "content" / "events")
    if dead:
        print(f"  olu beyan    : {len(dead)} mem_* hicbir olayda kullanilmiyor")
        for flag in dead:
            print(f"      {flag}")
    else:
        print("  olu beyan    : yok")

    # Her anahtari AYRI AYRI sina.
    #
    # Hat anahtarlari sirayla deneyip ilk calisani kullanir -- uretimde
    # dogru, TANIDA korlestirici: "kota doldu" mesaji hangi anahtarin
    # bittigini, hangisinin hic calismadigini soylemez. Yeni bir anahtar
    # eklendiginde "gercekten calisiyor mu" sorusunun tek durust cevabi
    # her birini tek tek denemektir. Uretim kotasi harcamaz.
    print("\n=== ANAHTARLAR ===")
    try:
        from .providers.gemini import probe_keys

        rows = probe_keys()
        if not rows:
            print("  tanimli anahtar yok")
        for name, state in rows:
            print(f"  {name:22} {state}")
    except Exception as err:  # tani komutu asla cokmemeli
        print(f"  sinanamadi: {err}")

    print("\n=== SIZINTI KONTROLU ===")
    from .providers.base import env_key

    key = env_key("GEMINI_API_KEY")
    if not key:
        print("  anahtar tanimli degil, tarama atlandi")
    else:
        leaked = _scan_for_secret(root, key)
        if leaked:
            ok = False
            print("  ANAHTAR SIZMIS:")
            for p in leaked:
                print(f"    {p}")
        else:
            print("  temiz: anahtar hicbir izlenen dosyada gecmiyor")

    print("\n" + ("HAZIR" if ok else "SORUN VAR"))
    return 0 if ok else 1


def _scan_for_secret(root: Path, secret: str) -> list[str]:
    """Anahtarin repoya sizip sizmadigini arar.

    `.env` haric her yer taranir: kod, icerik, prompt ciktilari, log'lar.
    """
    hits: list[str] = []
    skip_dirs = {"node_modules", ".git", "__pycache__", ".cache"}
    for path in root.rglob("*"):
        if not path.is_file() or path.name == ".env":
            continue
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.suffix not in {".ts", ".js", ".json", ".md", ".txt", ".py", ".log"}:
            continue
        try:
            if secret in path.read_text(encoding="utf-8", errors="ignore"):
                hits.append(str(path.relative_to(root)))
        except OSError:
            continue
    return hits


# ----------------------------------------------------------------------- main


def _find_root(start: Path) -> Path:
    """Proje kokunu yukari dogru arar.

    Hat `tools/` altinda yasadigi icin `python -m authoring` cogunlukla oradan
    calistirilir; kok her seferinde elle verilmek zorunda kalmasin.
    """
    for candidate in (start, *start.parents):
        if (candidate / "package.json").exists() and (candidate / "content").is_dir():
            return candidate
    return start


def main(argv: list[str] | None = None) -> int:
    # `--root` hem komuttan once hem sonra yazilabilsin. Ortak ebeveyn
    # ayristiricinin varsayilani SUPPRESS: aksi halde alt ayristirici, komuttan
    # ONCE verilmis `--root` degerini kendi varsayilaniyla sessizce ezer.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--root", default=argparse.SUPPRESS, help="Proje koku (varsayilan: otomatik bulunur)"
    )

    parser = argparse.ArgumentParser(
        prog="authoring", description="Yazim hatti", parents=[common]
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("report", help="Defter durumu ve bosluklar", parents=[common])

    p_plan = sub.add_parser("plan", help="Brief ve prompt uret", parents=[common])
    p_plan.add_argument("--count", type=int, default=5)
    p_plan.add_argument("--category", default=None)
    p_plan.add_argument("--life-state", default=None, help="Sahneyi bu hayat durumuna kapila")
    p_plan.add_argument("--era", default=None, help="Sahne bu cagi MUTLAKA kapsasin")
    p_plan.add_argument("--seed", type=int, default=0)

    p_write = sub.add_parser("write", help="Uret, denetle, diske yaz", parents=[common])
    p_write.add_argument("--count", type=int, default=3)
    p_write.add_argument("--category", default=None)
    p_write.add_argument("--life-state", default=None, help="Sahneyi bu hayat durumuna kapila")
    # `plan`da vardi, `write`ta YOKTU -- yani bosluga nisan alarak uretmek
    # mumkun degildi. Kategori x cag matrisinde sifir hucreler var
    # (`sponsor` uc cagda hic yok, `dark` cirak ve alacakaranlikta yok);
    # onlari doldurmak icin cag secilebilmeli.
    p_write.add_argument("--era", default=None, help="Sahne bu cagi MUTLAKA kapsasin")
    p_write.add_argument("--seed", type=int, default=0)
    p_write.add_argument("--provider", default="gemini")
    p_write.add_argument("--verbose", action="store_true")

    p_arc = sub.add_parser("arc", help="Zincir uret: tohum + odemeler", parents=[common])
    p_arc.add_argument("--category", required=True)
    p_arc.add_argument("--payoffs", type=int, default=3)
    p_arc.add_argument("--seed", type=int, default=0)
    p_arc.add_argument("--provider", default="gemini")
    p_arc.add_argument("--verbose", action="store_true")
    p_arc.add_argument(
        "--dry-run", action="store_true", help="Uretme, yalnizca brief ve prompt yaz"
    )

    p_ingest = sub.add_parser("ingest", help="Disardan gelen olayi kapiya sok", parents=[common])
    p_ingest.add_argument(
        "path", nargs="+", help="Bir ya da daha COK olay dosyasi; birlikte dogrulanir"
    )

    p_enrich = sub.add_parser(
        "enrich", help="Kisa outcome metinlerini zenginlestir", parents=[common]
    )
    p_enrich.add_argument("--count", type=int, default=5)
    p_enrich.add_argument("--category", default=None)
    p_enrich.add_argument("--provider", default="gemini")
    p_enrich.add_argument("--verbose", action="store_true")

    p_self = sub.add_parser("selftest", help="Hattin kendi testleri", parents=[common])
    p_self.add_argument(
        "--hizli", action="store_true", help="Validator calistiran yavas testi atla"
    )

    p_widen = sub.add_parser(
        "widen", help="Olu olaylarin kapilamasini gevset", parents=[common]
    )
    p_widen.add_argument("--dry-run", action="store_true")

    p_var = sub.add_parser(
        "variant", help="Mevcut olaya ikinci sahne ekle", parents=[common]
    )
    p_var.add_argument("--category", default=None)
    p_var.add_argument("--count", type=int, default=3)
    p_var.add_argument("--max", type=int, default=2, help="Olay basina hedef varyant sayisi")
    p_var.add_argument("--seed", type=int, default=0)
    p_var.add_argument("--provider", default="gemini")
    p_var.add_argument("--verbose", action="store_true")

    p_unvar = sub.add_parser(
        "unvariant", help="Eklenen varyanti geri al", parents=[common]
    )
    p_unvar.add_argument(
        "--only", nargs="*", default=None, help="Yalnizca bu olay kimlikleri"
    )
    p_unvar.add_argument(
        "--keep", nargs="*", default=None, help="Bu varyant id'leri KORUNUR (silinmez)"
    )
    # VARSAYILAN GUVENLI: bayraksiz cagri hicbir sey silmez, yalnizca
    # ne silinecegini yazar. Yikici yol ACIKCA istenmelidir.
    #
    # Bu komut bir kez yanlislikla calistirildi ve 175 varyant kalici
    # olarak gitti (proje git deposu degil). Sebep: "--dry-run" bayragi
    # verildi ama kodun eski yolu hala yaziyordu. Artik yazma yolu
    # `--force` olmadan HIC calismaz.
    p_unvar.add_argument(
        "--force", action="store_true", help="GERCEKTEN sil (varsayilan: yalnizca goster)"
    )
    p_unvar.add_argument(
        "--dry-run", action="store_true", help="(varsayilan davranis; uyumluluk icin)"
    )

    p_doctor = sub.add_parser("doctor", help="Kurulum ve sizinti kontrolu", parents=[common])
    p_doctor.add_argument(
        "--models", action="store_true", help="Anahtarin erisebildigi modelleri listele"
    )

    args = parser.parse_args(argv)
    given = getattr(args, "root", None)
    root = Path(given).resolve() if given else _find_root(Path.cwd().resolve())

    handlers = {
        "report": cmd_report,
        "plan": cmd_plan,
        "write": cmd_write,
        "arc": cmd_arc,
        "ingest": cmd_ingest,
        "enrich": cmd_enrich,
        "selftest": cmd_selftest,
        "variant": cmd_variant,
        "unvariant": cmd_unvariant,
        "widen": cmd_widen,
        "doctor": cmd_doctor,
    }
    return handlers[args.command](args, root)


if __name__ == "__main__":
    raise SystemExit(main())
