#!/usr/bin/env node
/**
 * # open-play-mcp::cli
 *
 * **Neden var:** `npx @ferdiunal/open-play-mcp` (stdio) ve `--http <port>` (Streamable HTTP) giriş noktası (DESIGN.md §10.39).
 * **Kapsam:** argüman ayrıştırma, taşıma seçimi, durumsuz HTTP sunucusu.
 * **Sahip olduğu tipler:** `CliOptions`.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadIndex } from "./load-index.js";
import { createServer } from "./server.js";
import type { McpIndex } from "./types.js";

/** Komut satırı seçenekleri: `http` port (yoksa stdio), `host`, `index` yolu. */
export interface CliOptions {
  http?: number;
  host: string;
  index?: string;
  help: boolean;
}

const USAGE = `open-play-mcp — Open Play docs and SDK MCP server

Usage:
  open-play-mcp                      stdio transport (default)
  open-play-mcp --http <port>        Streamable HTTP on /mcp (stateless; 0 = free port)
Options:
  --host <addr>    HTTP bind address (default 127.0.0.1)
  --index <path>   index.json to load (default: bundled)
  --help           this text
`;

/** Argümanları ayrıştırır; bilinmeyen bayrak `Error` fırlatır. */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { host: "127.0.0.1", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} bir değer ister`);
      return v;
    };
    if (a === "--http") {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--http geçerli bir port ister");
      opts.http = port;
    } else if (a === "--host") opts.host = value();
    else if (a === "--index") opts.index = value();
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`bilinmeyen argüman: ${a}`);
  }
  return opts;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("gövde çok büyük");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function serveHttp(index: McpIndex, opts: CliOptions): Promise<void> {
  const http = createHttpServer((req, res) => {
    void (async () => {
      if (req.url?.split("?")[0] !== "/mcp") return sendJson(res, 404, { error: "not found" });
      if (req.method !== "POST") return sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
      try {
        const body = await readBody(req);
        const server = createServer(index);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (err) {
        if (!res.headersSent) sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: (err as Error).message }, id: null });
      }
    })();
  });
  await new Promise<void>((resolve) => http.listen(opts.http ?? 0, opts.host, resolve));
  const address = http.address();
  const port = typeof address === "object" && address ? address.port : opts.http;
  process.stderr.write(`open-play-mcp listening on http://${opts.host}:${String(port)}/mcp\n`);
  const stop = (): void => void http.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  const index = loadIndex(opts.index);
  if (opts.http !== undefined) return serveHttp(index, opts);
  await createServer(index).connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`open-play-mcp: ${(err as Error).message}\n`);
  process.exit(1);
});
