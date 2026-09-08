/**
 * `node:sqlite` koprusu -- motor tarafi.
 *
 * `tools/roster/sqlite.ts` ile ayni cozumu tasir ama BILEREK ayri duruyor:
 * katman kurali `src` -> `tools` importunu yasaklar. Iki dosya da Vite'in
 * `node:sqlite`i tanidigi gun tek satira duser.
 *
 * SORUN: `node:sqlite` `module.builtinModules` icinde yalnizca ONEKLI
 * ('node:sqlite') duruyor. Vite 5.4 oneki soyup ciplak 'sqlite' ariyor,
 * bulamiyor ve diskten paket yuklemeye calisip patliyor. `createRequire`
 * CommonJS yoludur; paketleyicinin ESM grafigine hic girmez. Tip tarafi
 * `import type` ile gelir ve derlemede silinir -- tip guvenligi kaybi yok.
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncClass } from 'node:sqlite';

const nodeRequire = createRequire(import.meta.url);

const sqlite = nodeRequire('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncClass;
};

export const DatabaseSync = sqlite.DatabaseSync;
export type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
