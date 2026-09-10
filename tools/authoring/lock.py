"""SURECLER ARASI KILIT -- paralel uretim icin.

NEDEN GEREKLI: uretim hatti tek surec varsayimiyla yazilmisti. Iki
`variant` kosusu ayni anda calisirsa PAYLASIMLI DURUMU bozarlar:

  `core.json`   `ensure_declared` oku-degistir-yaz yapar. Iki surec ayni
                anda okursa biri otekinin ekledigi beyani siler. Bu
                oturumda tam olarak bu tur bir KAYIP GUNCELLEME olctuk:
                elle eklenen iki bayrak sessizce yok oldu.
  `ledger.json` Ayni desen; imza defteri kaybolursa ayni beat iki kez
                uretilir.

Kilit KABA ama dogru: kritik bolum saniyeler surer, cekisme maliyeti
onemsiz. Ince taneli kilitlemek, kazanci olmayan bir karmasiklik olurdu.

Windows'ta `fcntl` yok; `O_CREAT|O_EXCL` ile atomik dosya olusturma her
iki platformda da calisir.
"""

from __future__ import annotations

import os
import time
from contextlib import contextmanager
from pathlib import Path

#: Kilit bu kadar eskiyse sahibi olmus sayilir (surec oldurulmus olabilir).
STALE_SECONDS = 120
#: Bu kadar bekledikten sonra kilitsiz devam edilir -- uretim durmamali.
MAX_WAIT_SECONDS = 60


@contextmanager
def file_lock(path: Path, label: str = ""):
    """Kritik bolumu sureclerarasi kilitle.

    Kilit alinamazsa uretim DURMAZ: `MAX_WAIT_SECONDS` sonunda uyari
    basip devam eder. Bir kilit yuzunden gece boyu suren bir uretimin
    olmesi, ara sira bir yaris kosulundan daha kotudur.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    waited = 0.0
    acquired = False
    while waited < MAX_WAIT_SECONDS:
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode("utf-8"))
            os.close(fd)
            acquired = True
            break
        except FileExistsError:
            # Sahibi olmus bir kilit butun hatti kilitlemesin.
            try:
                if time.time() - path.stat().st_mtime > STALE_SECONDS:
                    path.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            time.sleep(0.25)
            waited += 0.25

    if not acquired:
        print(f"   UYARI: {label or path.name} kilidi alinamadi, kilitsiz devam ediliyor")

    try:
        yield acquired
    finally:
        if acquired:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
