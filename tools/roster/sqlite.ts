/**
 * `node:sqlite` koprusu -- TIPLI, ama ESM cozumlemesinden gecmeyen.
 *
 * SORUN:
 *   `node:sqlite` Node 22.5+ ile yerlesik. Ama `module.builtinModules`
 *   listesinde YALNIZCA onekli haliyle ('node:sqlite') duruyor, ciplak
 *   'sqlite' olarak degil. Vite 5.4 (vitest 2.x'in kullandigi surum) oneki
 *   soyup ciplak adi listede ariyor, bulamiyor ve diskten bir 'sqlite' paketi
 *   yuklemeye calisip patliyor. `tsx` ile sorun yok; yalnizca test kosucusu.
 *
 * COZUM:
 *   Calisma zamani yuklemesi `createRequire` ile yapilir -- bu bir CommonJS
 *   cagrisidir ve paketleyicinin ESM grafigine hic girmez. Tip tarafi
 *   `import type` ile gelir ve derlemede TAMAMEN silinir (`verbatimModuleSyntax`
 *   acik), dolayisiyla tip guvenligi kaybi YOK.
 *
 * NEDEN BOYLE:
 *   Alternatifler ya bagimlilik yukseltmek (vitest/vite majoru) ya da uretim
 *   kodunu test kosucusuna gore egmekti. Bu koprü ikisini de yapmiyor ve
 *   Vite bu builtin'i tanidigi gun tek satirla dusuyor:
 *     export { DatabaseSync } from 'node:sqlite';
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncClass } from 'node:sqlite';

const nodeRequire = createRequire(import.meta.url);

const sqlite = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncClass;
};

export const DatabaseSync = sqlite.DatabaseSync;

/** Diger modullerin imzalarda kullanmasi icin -- yalnizca tip. */
export type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
