/**
 * # open-play-mcp::load-index
 *
 * **Neden var:** dizini canlı siteden alır; ağ yoksa disk önbelleğine, o da yoksa pakete gömülü anlık görüntüye düşer.
 * **Kapsam:** `validateIndex`, `loadIndex`, `IndexStore`, `readIndexFile`.
 * **Sahip olduğu tipler:** `LoadOptions`, `LoadedIndex`.
 *
 * Fallback order: fresh fetch (ETag) -> disk cache -> bundled `snapshot/index.json`.
 * All diagnostics go to stderr; stdout belongs to the stdio transport.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_INDEX_URL, SCHEMA_VERSION, type McpIndex } from "./types.js";

/** Where the loaded index came from. */
export type IndexSource = "network" | "cache" | "snapshot" | "file";

/** Loader options: `url` (index URL), `cacheDir`, `timeoutMs` (default 5000), `fetchImpl` (tests), `log` (stderr line writer). */
export interface LoadOptions {
  url?: string;
  cacheDir?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

/** A validated index plus where it came from. */
export interface LoadedIndex {
  index: McpIndex;
  source: IndexSource;
}

const MAX_BYTES = 32 * 1024 * 1024;

const defaultLog = (line: string): void => void process.stderr.write(`open-play-mcp: ${line}\n`);

/**
 * Checks the index contract.
 *
 * # Parameters
 * - `value: unknown` — parsed JSON
 *
 * # Returns
 * - `McpIndex` — the same object, typed
 *
 * # Errors
 * - `Error` when `schemaVersion` is not 1 or `docs`/`symbols` are not arrays
 *
 * Optional sections (`endpoints`, `errors`) are kept only when they are arrays; an older index without them stays valid.
 */
export function validateIndex(value: unknown): McpIndex {
  const v = value as Partial<McpIndex> | null;
  if (typeof v !== "object" || v === null) throw new Error("index is not an object");
  if (v.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported schemaVersion ${String(v.schemaVersion)} (expected ${SCHEMA_VERSION})`);
  if (!Array.isArray(v.docs) || !Array.isArray(v.symbols)) throw new Error("index needs docs[] and symbols[]");
  const index: McpIndex = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: typeof v.generatedAt === "string" ? v.generatedAt : "unknown",
    commit: typeof v.commit === "string" ? v.commit : "unknown",
    docs: v.docs,
    symbols: v.symbols,
  };
  if (Array.isArray(v.endpoints)) index.endpoints = v.endpoints;
  if (Array.isArray(v.errors)) index.errors = v.errors;
  return index;
}

/** Reads and validates an index file (used for `--index`, the cache and the snapshot). Throws on any problem. */
export function readIndexFile(file: string): McpIndex {
  return validateIndex(JSON.parse(readFileSync(file, "utf8")));
}

/** Default cache directory: `$OPEN_PLAY_MCP_CACHE_DIR`, else `$XDG_CACHE_HOME/open-play-mcp`, else `~/.cache/open-play-mcp`. */
export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["OPEN_PLAY_MCP_CACHE_DIR"] ?? join(env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "open-play-mcp");
}

/** Path of the bundled snapshot (`<package>/snapshot/index.json`). */
export function snapshotPath(): string {
  return fileURLToPath(new URL("../snapshot/index.json", import.meta.url));
}

function readCache(dir: string): { index: McpIndex; etag?: string } | undefined {
  try {
    const index = readIndexFile(join(dir, "index.json"));
    let etag: string | undefined;
    try {
      etag = (JSON.parse(readFileSync(join(dir, "index.meta.json"), "utf8")) as { etag?: string }).etag;
    } catch {
      etag = undefined;
    }
    return etag === undefined ? { index } : { index, etag };
  } catch {
    return undefined;
  }
}

function writeCache(dir: string, raw: string, etag: string | null): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `index.json.${process.pid}.tmp`);
  writeFileSync(tmp, raw);
  renameSync(tmp, join(dir, "index.json"));
  writeFileSync(join(dir, "index.meta.json"), JSON.stringify({ etag }));
}

/**
 * Loads the index: fresh fetch -> disk cache -> bundled snapshot. Never throws on network problems.
 *
 * # Parameters
 * - `opts: LoadOptions` — URL, cache directory, timeout, injected fetch, logger
 *
 * # Returns
 * - `LoadedIndex` — validated index and its source
 *
 * # Errors
 * - `Error` only when all three sources are unusable (a broken installation)
 */
export async function loadIndex(opts: LoadOptions = {}): Promise<LoadedIndex> {
  const log = opts.log ?? defaultLog;
  const url = opts.url ?? DEFAULT_INDEX_URL;
  const dir = opts.cacheDir ?? defaultCacheDir();
  const cached = readCache(dir);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (cached?.etag) headers["if-none-match"] = cached.etag;
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 5000), redirect: "follow" });
    if (res.status === 304 && cached) return { index: cached.index, source: "cache" };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error("index too large");
    const raw = await res.text();
    if (raw.length > MAX_BYTES) throw new Error("index too large");
    const index = validateIndex(JSON.parse(raw));
    try {
      writeCache(dir, raw, res.headers.get("etag"));
    } catch (err) {
      log(`cannot write cache: ${(err as Error).message}`);
    }
    return { index, source: "network" };
  } catch (err) {
    log(`index fetch failed (${(err as Error).message}); using ${cached ? "disk cache" : "bundled snapshot"}`);
  }
  if (cached) return { index: cached.index, source: "cache" };
  try {
    return { index: readIndexFile(snapshotPath()), source: "snapshot" };
  } catch (err) {
    throw new Error(`no usable index (network, cache and bundled snapshot all failed): ${(err as Error).message}`);
  }
}

/**
 * Holds the current index and refreshes it in the background; a failed refresh keeps the old index.
 *
 * Fields: `current` (index served right now), `source` (where it came from).
 */
export class IndexStore {
  current: McpIndex;
  source: IndexSource;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    initial: LoadedIndex,
    private readonly opts: LoadOptions = {},
  ) {
    this.current = initial.index;
    this.source = initial.source;
  }

  /** The index URL this store refreshes from. */
  get url(): string {
    return this.opts.url ?? DEFAULT_INDEX_URL;
  }

  /** Re-fetches once (ETag); keeps the old index when only a fallback source answers. */
  async refresh(): Promise<void> {
    const next = await loadIndex(this.opts).catch(() => undefined);
    if (next && next.source === "network") {
      this.current = next.index;
      this.source = "network";
    } else if (next && next.source === "cache" && next.index.generatedAt !== this.current.generatedAt && this.source !== "network") {
      this.current = next.index;
      this.source = "cache";
    }
  }

  /** Starts periodic refresh (default every 15 minutes); the timer never keeps the process alive. */
  start(intervalMs = 15 * 60 * 1000): void {
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref();
  }

  /** Stops periodic refresh. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

