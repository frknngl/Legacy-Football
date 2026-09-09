import { defineConfig } from 'vitest/config';

/**
 * Test kosum yapilandirmasi.
 *
 * NEDEN ISCI SINIRI VAR: her test dosyasi motoru ve TUM icerigi
 * yukluyor (~1,7 sn, 215 olay). Vitest varsayilan olarak cekirdek
 * sayisi kadar isci acar ve her isci bu yuku ayri ayri tasir.
 *
 * Olculdu: 8 GB bellekli bir makinede 0,9 GB bos kalmisken kume 22
 * saniyeden 198 saniyeye cikti ve 18 test ZAMAN ASIMINDAN dustu --
 * hicbiri gercek bir hata degildi. `real` sure 44 sn iken `user` sure
 * 0,5 sn'ydi: sureyi CPU degil takas/IO yiyordu.
 *
 * Dort isci, bellek baskisi altinda bile kumeyi yesil tutuyor ve bos
 * bir makinede kayda deger bir yavaslama getirmiyor.
 */
export default defineConfig({
  test: {
    maxWorkers: 4,
    minWorkers: 1,
    // Kariyer boyu kosan olcum testleri (MediaEra, FailurePath) 5 sn'lik
    // varsayilana sigmiyor; bu bir yavaslama degil, olcumun boyutu.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
