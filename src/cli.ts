#!/usr/bin/env node
/**
 * # open-play-mcp::cli
 *
 * **Neden var:** `npx @ferdiunal/open-play-mcp` (stdio) ve `--http <port>` (Streamable HTTP) giriş noktası.
 * **Kapsam:** argüman ayrıştırma, taşıma seçimi.
 * **Sahip olduğu tipler:** `CliOptions`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpApp } from "./http.js";
import { IndexStore, loadIndex, readIndexFile, type LoadedIndex } from "./load-index.js";
import { createServer } from "./server.js";
import { DEFAULT_INDEX_URL } from "./types.js";

/** CLI options; see USAGE for each flag. */
export interface CliOptions {
  http?: number;
  host: string;
  index?: string;
  docsUrl: string;
  allowedOrigins: string[];
  trustProxy: boolean;
  rateLimit: number;
  burst: number;
  help: boolean;
}

const USAGE = `open-play-mcp — Open Play docs and SDK MCP server

Usage:
  open-play-mcp                      stdio transport (default)
  open-play-mcp --http <port>        Streamable HTTP on /mcp (stateless; 0 = free port)
Options:
  --docs-url <url>          index URL (default ${DEFAULT_INDEX_URL}; env OPEN_PLAY_MCP_INDEX_URL)
  --index <path>            use this local index.json only, no network
  --host <addr>             HTTP bind address (default 127.0.0.1)
  --allowed-origins <list>  comma-separated browser Origins allowed over HTTP (default https://open-play.b4klabs.dev)
  --trust-proxy             take the client IP from X-Forwarded-For (only behind a trusted reverse proxy)
  --rate-limit <n>          requests per minute per client IP (default 60)
  --burst <n>               rate-limit burst size (default 20)
  --help                    this text

Index source order: live site (ETag) -> disk cache -> bundled snapshot.
`;

/** Parses arguments; an unknown flag throws `Error`. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const opts: CliOptions = {
    host: "127.0.0.1",
    docsUrl: env["OPEN_PLAY_MCP_INDEX_URL"] ?? DEFAULT_INDEX_URL,
    allowedOrigins: ["https://open-play.b4klabs.dev"],
    trustProxy: false,
    rateLimit: 60,
    burst: 20,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    const positive = (): number => {
      const n = Number(value());
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${a} needs a positive number`);
      return n;
    };
    if (a === "--http") {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--http needs a valid port");
      opts.http = port;
    } else if (a === "--host") opts.host = value();
    else if (a === "--index") opts.index = value();
    else if (a === "--docs-url") opts.docsUrl = value();
    else if (a === "--allowed-origins") opts.allowedOrigins = value().split(",").map((o) => o.trim()).filter(Boolean);
    else if (a === "--trust-proxy") opts.trustProxy = true;
    else if (a === "--rate-limit") opts.rateLimit = positive();
    else if (a === "--burst") opts.burst = positive();
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

const log = (line: string): void => void process.stderr.write(`${line}\n`);

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  const loadOpts = { url: opts.docsUrl, log: (l: string) => log(`open-play-mcp: ${l}`) };
  const loaded: LoadedIndex = opts.index ? { index: readIndexFile(opts.index), source: "file" } : await loadIndex(loadOpts);
  log(`open-play-mcp: index ${loaded.index.commit} (${loaded.index.generatedAt}) from ${loaded.source}`);
  if (opts.http === undefined) {
    await createServer(loaded.index).connect(new StdioServerTransport());
    return;
  }
  const store = new IndexStore(loaded, loadOpts);
  if (!opts.index) store.start();
  const http = createHttpApp({ store, allowedOrigins: opts.allowedOrigins, trustProxy: opts.trustProxy, perMinute: opts.rateLimit, burst: opts.burst, requestTimeoutMs: 30_000, log });
  await new Promise<void>((resolve) => http.listen(opts.http ?? 0, opts.host, resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : opts.http;
  log(`open-play-mcp listening on http://${opts.host}:${String(port)}/mcp`);
  const stop = (): void => {
    store.stop();
    http.close(() => process.exit(0));
    http.closeAllConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err: unknown) => {
  process.stderr.write(`open-play-mcp: ${(err as Error).message}\n`);
  process.exit(1);
});
