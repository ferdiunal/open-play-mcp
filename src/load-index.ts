/**
 * # open-play-mcp::load-index
 *
 * **Neden var:** sunucu başlarken derleme zamanı dizinini okur ve sürümünü doğrular (DESIGN.md §10.39).
 * **Kapsam:** `loadIndex`.
 * **Sahip olduğu tipler:** yok.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION, type McpIndex } from "./types.js";

/**
 * Dizin dosyasını okur.
 *
 * # Parametreler
 * - `path: string | undefined` — dizin yolu; yoksa paketin yanındaki `index.json`
 *
 * # Dönüş
 * - `McpIndex` — doğrulanmış dizin
 *
 * # Hatalar
 * - dosya yok ya da `schema_version` uyuşmuyorsa `Error` (sessiz eski dizin yok)
 */
export function loadIndex(path?: string): McpIndex {
  const file = path ?? fileURLToPath(new URL("./index.json", import.meta.url));
  let parsed: McpIndex;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as McpIndex;
  } catch (err) {
    throw new Error(`dizin okunamadı (${file}); önce "npm run build" koşun: ${(err as Error).message}`);
  }
  if (parsed.schema_version !== SCHEMA_VERSION) {
    throw new Error(`schema_version uyuşmuyor: dizinde ${String(parsed.schema_version)}, sunucu ${SCHEMA_VERSION} bekliyor`);
  }
  return parsed;
}
