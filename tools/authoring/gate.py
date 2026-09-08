# -*- coding: utf-8 -*-
"""KALITE KAPISI -- uretilen sahne diske YAZILMADAN once denetlenir.

Hattin en onemli parcasi. Uretilen JSON gecici bir dosyaya konur, projenin
kendi validator'u (25 kural) calistirilir, hata varsa dosya SILINIR ve hata
listesi prompt'a geri beslenir.

Boylece "LLM iyi yazsin" umuduna dayanmayiz: korpusa yalnizca kuralları gecen
sahne girer. Klon metin, bedelsiz secim, isimsiz NPC, sonucsuz olay ve kirik
hedef kapida durur.
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .flags import collect_memory_flags, ensure_declared


@dataclass
class GateResult:
    ok: bool
    errors: list[str]
    warnings: list[str]

    def summary(self) -> str:
        if self.ok:
            return f"gecti ({len(self.warnings)} uyari)"
        return f"REDDEDILDI: {len(self.errors)} hata"


class QualityGate:
    """`npm run validate` etrafinda ince bir sarmalayici."""

    def __init__(self, project_root: Path, events_dir: Path | None = None) -> None:
        self.root = project_root
        self.events_dir = events_dir or (project_root / "content" / "events")

    def check(
        self,
        event: dict,
        category: str,
        pending_traces: frozenset[str] = frozenset(),
    ) -> GateResult:
        """Olayi GECICI olarak yazar, dogrular, sonra her seyi geri alir.

        Yeni `mem_*` izleri denetimden ONCE registry'ye kaydedilir; aksi halde
        her yeni sahne `UndeclaredFlagRule`a takilir ve kapi asil aradigi
        seyleri (klon metin, bedelsiz secim) hic goremez. Ama bu kayit da
        GECICIDIR: reddedilen bir sahnenin izi `core.json`da kalirsa her
        basarisiz denemede bir yetim beyan birikir.

        Ne olay dosyasi ne flag beyani kalici olur; yayimlama karari cagirana
        aittir (`commit`). Kapinin isi denetlemek, yayimlamak degil.
        """
        core = self.root / "content" / "orchestrator" / "core.json"
        core_backup = core.read_text(encoding="utf-8")
        ensure_declared(core, collect_memory_flags(event), event.get("id", ""))

        target = self.events_dir / category / f"{event.get('id', 'tmp')}.json"
        existed = target.exists()
        backup = target.read_text(encoding="utf-8") if existed else None

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(event, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        try:
            return self._run_validator(pending_traces)
        finally:
            core.write_text(core_backup, encoding="utf-8")
            if backup is not None:
                target.write_text(backup, encoding="utf-8")
            elif target.exists():
                target.unlink()

    def check_corpus(self) -> GateResult:
        """Diskteki korpusu OLDUGU GIBI dogrular -- hicbir sey yazmadan.

        Zincir uretiminin son adimi. Ara adimlarda zincirin kendi izleri
        hos gorulur (okuyuculari henuz yazilmamistir); burada tolerans
        YOKTUR. Yarim zincir, oyuncunun verdigi bir kararin faturasinin
        hic gelmemesi demektir.
        """
        return self._run_validator()

    def commit(self, event: dict, category: str) -> Path:
        """Kapidan gecmis olayi kalici olarak yazar ve izlerini beyan eder."""
        ensure_declared(
            self.root / "content" / "orchestrator" / "core.json",
            collect_memory_flags(event),
            event.get("id", ""),
        )
        target = self.events_dir / category / f"{event['id']}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(event, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return target

    # ------------------------------------------------------------ ic isleyis

    def _run_validator(self, pending_traces: frozenset[str] = frozenset()) -> GateResult:
        proc = subprocess.run(
            ["npm", "run", "validate", "--silent", "--", "--warnings"],
            cwd=self.root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=True,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        errors = _collect(output, "HATA")

        # ZINCIR KILIDI.
        #
        # Bir zincirin TOHUMU izi yazmak zorundadir (brief sozlesmesi) ama
        # o izi okuyan ODEME sahneleri henuz uretilmemistir. Sonuc:
        # `OrphanMemoryFlagRule` tohumu her denemede reddediyordu ve HICBIR
        # zincir uretilemiyordu -- kapi kendi kendini kilitliyordu.
        #
        # `pending_traces` zincirin ILAN ETTIGI izlerdir. Yalnizca o adlari
        # tasiyan yetim hatalari tolere edilir; baska her sey aynen gecerli.
        # Guvenli olmasinin sebebi zincirin ya butun halinde girmesi ya da
        # hic girmemesi ve SONUNDA tam dogrulama yapilmasidir.
        if pending_traces:
            errors = [
                e
                for e in errors
                if not (
                    "OrphanMemoryFlagRule" in e
                    and any(f'"{t}"' in e for t in pending_traces)
                )
            ]
        # DIKKAT: bu yedek, yukaridaki tolerans filtresinden SONRA gelir.
        # `pending_traces` verildiginde filtre `errors`i bosaltabilir ve
        # cikis kodu yine 1'dir (dogrulayici yetimi hala hata sayar); yedegi
        # kosulsuz calistirmak o durumda listeyi UYARI satirlariyla
        # dolduruyordu ve model "8 hata" gorup ayni sahneyi bosuna yeniden
        # yaziyordu. Tolerans varken yedek devreye girmemeli.
        if proc.returncode != 0 and not errors and not pending_traces:
            # Validator kurallara HIC gelemeden dusmus olabilir (ayristirma
            # hatasi, eksik orkestratör dosyasi): o satirlar "HATA" ile
            # baslamaz. Bos hata listesi dondurmek modele "reddedildin ama
            # sebebini soylemeyecegim" demektir; tekrar denemesi anlamsizlasir.
            errors = [line.strip() for line in output.splitlines() if line.strip()][-8:]

        return GateResult(
            # Tolere edilen yetimler kalmissa cikis kodu 1 olsa da GECER;
            # baska hata varsa yine duser.
            ok=proc.returncode == 0 or (bool(pending_traces) and not errors),
            errors=errors,
            warnings=_collect(output, "UYARI"),
        )


def _collect(output: str, tag: str) -> list[str]:
    """Validator ciktisindan `tag` satirlarini ve aciklamalarini toplar."""
    lines = output.splitlines()
    out: list[str] = []
    for i, line in enumerate(lines):
        if not line.strip().startswith(tag):
            continue
        rule = line.strip()
        detail = lines[i + 1].strip() if i + 1 < len(lines) else ""
        out.append(f"{rule} -- {detail}".strip())
    return out


def extract_json(raw: str) -> dict:
    """Model ciktisindan JSON'u ayiklar.

    Modeller talimata ragmen ```json cercevesi ya da onsoz ekleyebiliyor;
    bunun icin uretim reddedilmez, temizlenir. Gercek hata JSON'un GECERSIZ
    olmasidir, cerceveli olmasi degil.
    """
    text = raw.strip()

    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Cikti icinde JSON nesnesi bulunamadi")

    return json.loads(text[start : end + 1])
