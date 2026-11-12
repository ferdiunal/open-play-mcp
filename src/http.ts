/**
 * # open-play-mcp::http
 *
 * **Neden var:** herkese açık, durumsuz Streamable HTTP sunucusu; yalnız okur, kötüye kullanıma karşı sertleştirilmiştir.
 * **Kapsam:** `createHttpApp`, `TokenBuckets`, `clientIp`.
 * **Sahip olduğu tipler:** `HttpOptions`.
 *
 * Routes: `POST /mcp` (stateless JSON-RPC), `GET /healthz`, `OPTIONS /mcp` (CORS preflight for allowed origins).
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IndexStore } from "./load-index.js";
import { createServer } from "./server.js";

/** Largest accepted request body in bytes. */
export const BODY_LIMIT_BYTES = 64 * 1024;

/** HTTP options: `store` (current index), `allowedOrigins`, `trustProxy`, `perMinute`/`burst` (rate limit), `requestTimeoutMs`, `log`. */
export interface HttpOptions {
  store: IndexStore;
  allowedOrigins: string[];
  trustProxy: boolean;
  perMinute: number;
  burst: number;
  requestTimeoutMs: number;
  log: (line: string) => void;
}

/** Per-key token buckets: `burst` tokens, refilled at `perMinute` per minute. */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Takes one token.
   *
   * # Returns
   * - `0` when allowed, otherwise the seconds to wait (for `Retry-After`)
   */
  take(key: string): number {
    const t = this.now();
    if (this.buckets.size > 10_000) this.prune(t);
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: t };
    b.tokens = Math.min(this.burst, b.tokens + ((t - b.at) / 60_000) * this.perMinute);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return 0;
    }
    this.buckets.set(key, b);
    return Math.max(1, Math.ceil(((1 - b.tokens) / this.perMinute) * 60));
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets) if (t - b.at > 120_000) this.buckets.delete(k);
  }
}

/**
 * Client IP for rate limiting. With `trustProxy` the LAST `X-Forwarded-For` entry is used (the one the trusted proxy appended);
 * without it the header is ignored entirely.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const last = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",").pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

const rpcError = (code: number, message: string): unknown => ({ jsonrpc: "2.0", error: { code, message }, id: null });

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > BODY_LIMIT_BYTES) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Builds the HTTP server (not listening yet).
 *
 * # Parameters
 * - `opts: HttpOptions` — index store, origin allowlist, proxy trust, rate limit, timeout, logger
 *
 * # Returns
 * - `Server` — Node HTTP server; the caller calls `listen`
 */
export function createHttpApp(opts: HttpOptions): Server {
  const buckets = new TokenBuckets(opts.perMinute, opts.burst);
  const http = createHttpServer((req, res) => {
    const started = Date.now();
    const ip = clientIp(req, opts.trustProxy);
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    res.on("close", () => opts.log(JSON.stringify({ t: new Date(started).toISOString(), ip, method: req.method, path, status: res.statusCode, ms: Date.now() - started })));
    const timer = setTimeout(() => {
      sendJson(res, 503, rpcError(-32000, "Request timed out."));
      req.destroy();
    }, opts.requestTimeoutMs);
    res.on("close", () => clearTimeout(timer));
    void handle(req, res, path, ip).catch((err: unknown) => sendJson(res, 500, rpcError(-32603, (err as Error).message)));
  });
  http.requestTimeout = opts.requestTimeoutMs;
  http.headersTimeout = Math.min(opts.requestTimeoutMs, 15_000);

  async function handle(req: IncomingMessage, res: ServerResponse, path: string, ip: string): Promise<void> {
    if (path === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" }, { allow: "GET, HEAD" });
      const { commit, generatedAt } = opts.store.current;
      return sendJson(res, 200, { status: "ok", commit, generatedAt, source: opts.store.source });
    }
    if (path !== "/mcp") return sendJson(res, 404, { error: "not found" });

    const origin = req.headers.origin;
    const cors: Record<string, string> = {};
    if (origin !== undefined) {
      if (!opts.allowedOrigins.includes(origin)) return sendJson(res, 403, rpcError(-32000, "Origin not allowed."));
      cors["access-control-allow-origin"] = origin;
      cors["vary"] = "Origin";
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, accept, mcp-protocol-version", "access-control-max-age": "600" }).end();
      return;
    }
    const wait = buckets.take(ip);
    if (wait > 0) return sendJson(res, 429, rpcError(-32000, "Rate limit exceeded."), { ...cors, "retry-after": String(wait) });
    if (req.method !== "POST") return sendJson(res, 405, rpcError(-32000, "Method not allowed."), { ...cors, allow: "POST, OPTIONS" });

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      if (err instanceof BodyTooLarge) return sendJson(res, 413, rpcError(-32000, "Request body too large (limit 64 KB)."), { ...cors, connection: "close" });
      return sendJson(res, 400, rpcError(-32700, "Invalid JSON."), cors);
    }
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    const server = createServer(opts.store.current, { source: opts.store.source, url: opts.store.url });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
  return http;
}
