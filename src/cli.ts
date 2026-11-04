#!/usr/bin/env node
/**
 * # open-play-mcp::cli
 *
 * **Neden var:** `npx @ferdiunal/open-play-mcp` (stdio) ve `--http <port>` (Streamable HTTP) giriş noktası.
 * **Kapsam:** taşıma seçimi ve açılış (argüman ayrıştırma `args.ts` içinde).
 * **Sahip olduğu tipler:** yok.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpApp } from "./http.js";
import { IndexStore, loadIndex, readIndexFile, type LoadedIndex } from "./load-index.js";
import { createServer } from "./server.js";
import { parseArgs, USAGE } from "./args.js";

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
