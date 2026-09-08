# -*- coding: utf-8 -*-
"""YENI IZ KAYDI -- uretilen sahnenin birakacagi `mem_*` flag'ini beyan eder.

`UndeclaredFlagRule` beyan edilmemis flag'e yazmayi reddeder. Bu dogru bir
kural: flag registry tek dogruluk kaynagi ve oraya girmeyen bir iz motorda
sessizce yutulur.

Ama yeni sahne cogu zaman YENI bir iz birakir. Hattin bu izi kaydetmesi
gerekir; aksi halde her uretimde insanin `core.json`a elle satir eklemesi
beklenir ve otomasyon anlamsizlasir.

Yalnizca `memory` turu eklenir. `stat`, `resource`, `derived` gibi turler
KATI kalir: onlar oyunun ekonomisidir, uretim sirasinda uydurulamaz.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

# Yalnizca bu desene uyan flag'ler otomatik kaydedilir. Baska bir tur
# uretilirse kapida reddedilir -- ve reddedilmelidir.
MEMORY_PATTERN = re.compile(r"^mem_[a-z0-9_]+$")


class FlagRegistryError(RuntimeError):
    pass


def collect_memory_flags(event: dict) -> set[str]:
    """Olayin yazdigi/okudugu tum `mem_*` izlerini toplar."""
    blob = json.dumps(event, ensure_ascii=False)
    return {f for f in re.findall(r'"(mem_[a-z0-9_]+)"', blob)}


def ensure_declared(core_path: Path, flags: set[str], label_hint: str = "") -> list[str]:
    """Eksik `mem_*` izlerini `core.json`a ekler ve eklenenleri dondurur.

    Dosya bicimi KORUNUR: mevcut siralama ve girinti bozulmaz, yeni satirlar
    memory blogunun sonuna eklenir.
    """
    core = json.loads(core_path.read_text(encoding="utf-8"))
    declared = {f["key"] for f in core.get("flags", [])}

    missing = sorted(f for f in flags if f not in declared)
    if not missing:
        return []

    invalid = [f for f in missing if not MEMORY_PATTERN.match(f)]
    if invalid:
        raise FlagRegistryError(
            f"Otomatik kaydedilemeyecek flag: {invalid}. "
            "Yalnizca mem_* izleri uretim sirasinda tanimlanabilir."
        )

    for flag in missing:
        core["flags"].append(
            {
                "key": flag,
                "kind": "memory",
                "type": "boolean",
                "default": False,
                "label": _label_for(flag, label_hint),
            }
        )

    core_path.write_text(
        json.dumps(core, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return missing


def _label_for(flag: str, hint: str) -> str:
    """Insan okunur etiket -- CLI ve hata mesajlarinda gorunur."""
    body = flag[len("mem_") :].replace("_", " ")
    return f"{body}{(' -- ' + hint) if hint else ''}"


def prune_unused(core_path: Path, events_dir: Path) -> list[str]:
    """Hicbir olayin kullanmadigi `mem_*` izlerini bildirir (SILMEZ).

    Silmek tehlikeli: bir iz kaydedilmis oyunlarda yasiyor olabilir ve
    `SaveGame` bilinmeyen flag'i koruyor. Bu yuzden yalnizca raporlanir.
    """
    core = json.loads(core_path.read_text(encoding="utf-8"))
    memory = {f["key"] for f in core.get("flags", []) if f.get("kind") == "memory"}

    used: set[str] = set()
    for path in events_dir.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        used |= collect_memory_flags(data)

    return sorted(memory - used)
