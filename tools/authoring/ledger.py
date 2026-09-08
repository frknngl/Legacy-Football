# -*- coding: utf-8 -*-
"""SAHNE DEFTERI -- tekrari uretim aninda engeller.

Anti-tekrar mekanizmasinin kalbi burasi. Kelime karistirmak ya da LLM'e
"tekrar etme" demek yetmez; ikisi de olculemez. Bunun yerine her sahnenin
kombinasyon imzasi tutulur:

    (kategori, birincil slot, duygusal beat, era, sohret, kulup, hayat durumu)

Planlayici bu imzayi tekrar eden bir brief URETMEZ. Boylece "ayni sahnenin
farkli ismi" yapisal olarak imkansizlasir -- yazarin ya da modelin iyi
niyetine birakilmaz.

Defter iki kaynaktan beslenir:
  1. `content/events/` altindaki MEVCUT icerik (tarama ile)
  2. Bu hattin urettigi sahneler (kalici kayit)
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .brief import BEATS, Brief, GatingCell

# Mevcut icerigin beat'i beyan edilmemis olabilir; taramada bu isaret kullanilir.
UNKNOWN_BEAT = "?"


@dataclass
class Occupancy:
    """Bir kapilama hucresinin doluluk raporu."""

    cell: tuple[str, ...]
    count: int
    beats: tuple[str, ...]


class SceneLedger:
    """Kullanilmis kombinasyonlarin kaydi."""

    def __init__(self, cache_path: Path) -> None:
        self._cache_path = cache_path
        self._signatures: set[tuple[str, ...]] = set()
        self._by_category: Counter[str] = Counter()
        self._by_slot: Counter[str] = Counter()
        self._by_beat: Counter[str] = Counter()
        self._event_ids: set[str] = set()
        self._load_cache()

    # ------------------------------------------------------------ kalicilik

    def _load_cache(self) -> None:
        if not self._cache_path.exists():
            return
        data = json.loads(self._cache_path.read_text(encoding="utf-8"))
        for row in data.get("signatures", []):
            signature = tuple(row)
            self._signatures.add(signature)
            # Sayaclar imzadan YENIDEN kurulur, ayrica saklanmaz: iki kaynak
            # olsa biri eskir. Bunlar kurulmazsa planlayici her oturumda
            # "hicbir beat kullanilmamis" sanir ve cesitlilik sifirlanir.
            #
            # Varyant imzasi daha uzundur ve sayilmaz: varyant yeni bir slot
            # kullanimi degil, mevcut bir sahnenin ikinci anlatimidir.
            if len(signature) == 7:
                self._by_category[signature[0]] += 1
                self._by_slot[signature[1]] += 1
                self._by_beat[signature[2]] += 1
        self._event_ids.update(data.get("eventIds", []))

    def save(self) -> None:
        self._cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "_note": (
                "Sahne Defteri onbellegi. Silinirse defter mevcut icerikten "
                "yeniden kurulur; uretilmis ama silinmis sahnelerin izi kaybolur."
            ),
            "signatures": sorted(list(s) for s in self._signatures),
            "eventIds": sorted(self._event_ids),
        }
        self._cache_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    # ------------------------------------------------------------ tarama

    def scan_existing(self, events_dir: Path) -> int:
        """Mevcut icerigi deftere isler.

        Elle yazilmis olaylar `beat` beyan etmez; imzaya `?` girer. Bu, ayni
        (kategori, slot, hucre) uclusunun ikinci kez planlanmasini engellemez
        ama planlayiciya doluluk bilgisi verir -- bos hucreleri once o hedefler.
        """
        found = 0
        for path in sorted(events_dir.rglob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            event_id = data.get("id")
            if not event_id or event_id in self._event_ids:
                continue  # onbellekte zaten var, gercek beat'iyle sayildi

            self._event_ids.add(event_id)
            category = data.get("category", "?")
            self._by_category[category] += 1

            slot = _primary_slot(data)
            self._by_slot[slot] += 1
            self._by_beat[UNKNOWN_BEAT] += 1

            cell = (
                _axis(data, "eras"),
                _axis(data, "stature"),
                _axis(data, "clubTiers"),
                _axis(data, "lifeStates"),
            )
            self._signatures.add((category, slot, UNKNOWN_BEAT, *cell))

            # VARYANT IMZALARI da kurulmali.
            #
            # Eskiden yalnizca olay basina TEK 7'li imza yaziliyordu;
            # varyantlarin 8'li imzalari (`variant_of` onekli) hic
            # uretilmiyordu. Sonuc: onbellek silinip yeniden kuruldugunda
            # 90 varyantli olayin varyant imzalari kayboluyor ve ayni
            # (olay, beat) ikilisi ikinci kez uretilebiliyordu. Tekrar
            # engelini fiilen dosya-tabanli bir kontrol tasiyordu, defter
            # degil -- oysa tasarimin niyeti tersiydi.
            #
            # Varyant id'si `v_<beat>` bicimindeyse beat oradan okunur;
            # elle yazilmis `v_asil` gibi id'ler `?` ile girer.
            for variant in data.get("variants", ()):
                vid = variant.get("id", "")
                beat = vid[2:] if vid.startswith("v_") and len(vid) > 2 else UNKNOWN_BEAT
                self._signatures.add((event_id, category, slot, beat, *cell))

            found += 1
        return found

    def scan_pending(self, prompts_dir: Path) -> int:
        """Planlanmis ama henuz korpusa girmemis brief'leri deftere isler.

        `plan` brief uretip diske birakir. O brief yayimlanmadan `plan` yeniden
        calistirilirsa ayni imza ikinci kez uretilebilirdi. Bekleyeni saymak
        bunu engeller; brief dosyasi silinince imza serbest kalir -- kalici
        onbellege yazmak yerine bu geri alinabilir davranis secildi.
        """
        if not prompts_dir.exists():
            return 0

        found = 0
        for path in sorted(prompts_dir.glob("*.brief.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            cell = GatingCell(
                **{k: tuple(v) for k, v in (data.get("cell") or {}).items()}
            )
            self._signatures.add(
                (
                    data.get("category", "?"),
                    data.get("primary_slot", "-"),
                    data.get("beat", UNKNOWN_BEAT),
                )
                + cell.signature()
            )
            if data.get("event_id"):
                self._event_ids.add(data["event_id"])
            found += 1
        return found

    # ------------------------------------------------------------ sorgu

    def is_taken(self, brief: Brief) -> bool:
        return brief.signature() in self._signatures

    def has_event_id(self, event_id: str) -> bool:
        return event_id in self._event_ids

    def register(self, brief: Brief) -> None:
        """Brief'i deftere isler. Ayni imza ikinci kez kabul EDILMEZ."""
        signature = brief.signature()
        if signature in self._signatures:
            raise ValueError(
                f"Bu imza zaten kullanilmis: {signature}. "
                "Planlayici tekrar eden brief uretmemeli."
            )
        self._signatures.add(signature)
        self._event_ids.add(brief.event_id)
        self._by_category[brief.category] += 1
        self._by_slot[brief.primary_slot] += 1
        self._by_beat[brief.beat] += 1

    # ------------------------------------------------------------ rapor

    def report(self) -> dict:
        used_beats = {b: self._by_beat.get(b, 0) for b in BEATS}
        return {
            "toplam_sahne": len(self._signatures),
            "olay": len(self._event_ids),
            "kategori": dict(self._by_category.most_common()),
            "slot_kullanimi": dict(self._by_slot.most_common(12)),
            "hic_kullanilmamis_beat": sorted(b for b, n in used_beats.items() if n == 0),
            "beat_kullanimi": {b: n for b, n in used_beats.items() if n},
        }

    def unused_slots(self, all_slot_ids: tuple[str, ...]) -> tuple[str, ...]:
        """Hic sahneye cikmamis slotlar -- planlayicinin ilk hedefi."""
        return tuple(s for s in all_slot_ids if self._by_slot.get(s, 0) == 0)

    def thin_categories(self, categories: tuple[str, ...], floor: int) -> tuple[str, ...]:
        """Esigin altinda kalan kategoriler."""
        return tuple(c for c in categories if self._by_category.get(c, 0) < floor)


def _axis(data: dict, key: str) -> str:
    values = data.get(key)
    if not values:
        return "*"
    return ",".join(sorted(values))


def _primary_slot(data: dict) -> str:
    """Olayin merkezindeki slotu metinden cikarir.

    Icerik ozel isim yazamadigi icin (`HardcodedNameRule`) her sahnedeki kisi
    `{actor.<slot>.*}` bicimindedir; en cok gecen slot sahnenin merkezidir.
    """
    blob = json.dumps(data, ensure_ascii=False)
    hits = Counter(
        part.split(".")[1]
        for part in _ACTOR_TOKENS(blob)
        if len(part.split(".")) > 1
    )
    if not hits:
        return "-"
    return hits.most_common(1)[0][0]


def _ACTOR_TOKENS(blob: str) -> list[str]:
    import re

    return re.findall(r"\{(actor\.[a-z_]+\.[a-z]+)\}", blob)
