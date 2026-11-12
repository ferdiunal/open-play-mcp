import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fixtureIndex, text } from "./helpers.mjs";
import { createHttpApp, TokenBuckets, BODY_LIMIT_BYTES } from "../dist/http.js";
import { IndexStore } from "../dist/load-index.js";

const ORIGIN = "https://open-play.b4klabs.dev";

async function start(over = {}) {
  const lines = [];
  const store = new IndexStore({ index: fixtureIndex(), source: "network" });
  const app = createHttpApp({ store, allowedOrigins: [ORIGIN], trustProxy: false, perMinute: 60, burst: 20, requestTimeoutMs: 5000, log: (l) => lines.push(l), ...over });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  return { base, lines, close: () => new Promise((r) => (app.closeAllConnections(), app.close(r))) };
}
const rpc = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
const post = (url, headers = {}, body = JSON.stringify(rpc)) => fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body });

test("/healthz reports the index commit and generation time", async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/healthz`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, "ok");
    assert.equal(j.commit, "fixture");
    assert.ok(j.generatedAt);
  } finally {
    await s.close();
  }
});

test("a real MCP client over Streamable HTTP lists tools and calls search_docs", async () => {
  const s = await start();
  try {
    const client = new Client({ name: "http", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${s.base}/mcp`)));
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ["get_endpoint", "get_error", "get_sdk_symbol", "index_info", "list_docs", "read_doc", "search_docs", "search_sdk"]);
    assert.match(text(await client.callTool({ name: "search_docs", arguments: { query: "player data" } })), /Player data/);
    const info = text(await client.callTool({ name: "index_info", arguments: {} }));
    assert.match(info, /Commit: fixture/);
    assert.match(info, /Loaded from: live site — https:\/\/open-play\.b4klabs\.dev\/docs\/mcp\/index\.json/);
    await client.close();
  } finally {
    await s.close();
  }
});

test("Origin: unknown browser origin is rejected 403, allowed and missing origins pass", async () => {
  const s = await start();
  try {
    assert.equal((await post(`${s.base}/mcp`, { origin: "https://evil.example" })).status, 403);
    const ok = await post(`${s.base}/mcp`, { origin: ORIGIN });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal((await post(`${s.base}/mcp`)).status, 200);
    const pre = await fetch(`${s.base}/mcp`, { method: "OPTIONS", headers: { origin: ORIGIN } });
    assert.equal(pre.status, 204);
    assert.equal((await fetch(`${s.base}/mcp`, { method: "OPTIONS", headers: { origin: "https://evil.example" } })).status, 403);
  } finally {
    await s.close();
  }
});

test("body over 64 KB is rejected 413 and malformed JSON 400", async () => {
  const s = await start();
  try {
    const big = await post(`${s.base}/mcp`, {}, JSON.stringify({ ...rpc, pad: "x".repeat(BODY_LIMIT_BYTES) }));
    assert.equal(big.status, 413);
    assert.equal((await post(`${s.base}/mcp`, {}, "{nope")).status, 400);
  } finally {
    await s.close();
  }
});

test("rate limit: burst exhausted gives 429 with Retry-After; /healthz is exempt", async () => {
  const s = await start({ burst: 3, perMinute: 6 });
  try {
    const codes = [];
    let retry;
    for (let i = 0; i < 5; i++) {
      const r = await post(`${s.base}/mcp`);
      codes.push(r.status);
      if (r.status === 429) retry = r.headers.get("retry-after");
      await r.arrayBuffer();
    }
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    assert.ok(Number(retry) >= 1);
    assert.equal((await fetch(`${s.base}/healthz`)).status, 200);
  } finally {
    await s.close();
  }
});

test("X-Forwarded-For is ignored unless --trust-proxy; with it the last entry is the client", async () => {
  const plain = await start({ burst: 1, perMinute: 1 });
  try {
    await (await post(`${plain.base}/mcp`, { "x-forwarded-for": "1.1.1.1" })).arrayBuffer();
    assert.equal((await post(`${plain.base}/mcp`, { "x-forwarded-for": "2.2.2.2" })).status, 429);
  } finally {
    await plain.close();
  }
  const proxied = await start({ burst: 1, perMinute: 1, trustProxy: true });
  try {
    await (await post(`${proxied.base}/mcp`, { "x-forwarded-for": "9.9.9.9, 1.1.1.1" })).arrayBuffer();
    assert.equal((await post(`${proxied.base}/mcp`, { "x-forwarded-for": "9.9.9.8, 1.1.1.1" })).status, 429);
    assert.equal((await post(`${proxied.base}/mcp`, { "x-forwarded-for": "9.9.9.9, 2.2.2.2" })).status, 200);
  } finally {
    await proxied.close();
  }
});

test("only POST is served on /mcp; unknown paths 404; access log has no bodies", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/mcp`)).status, 405);
    assert.equal((await fetch(`${s.base}/mcp`, { method: "DELETE" })).status, 405);
    assert.equal((await fetch(`${s.base}/nope`)).status, 404);
    await (await post(`${s.base}/mcp`, {}, JSON.stringify({ ...rpc, secret: "TOPSECRET" }))).arrayBuffer();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(s.lines.length >= 4);
    const parsed = s.lines.map((l) => JSON.parse(l));
    assert.ok(parsed.every((l) => l.method && l.path && typeof l.status === "number" && typeof l.ms === "number"));
    assert.ok(!s.lines.join("\n").includes("TOPSECRET"));
  } finally {
    await s.close();
  }
});

test("TokenBuckets refills over time", () => {
  let now = 0;
  const b = new TokenBuckets(60, 2, () => now);
  assert.equal(b.take("a"), 0);
  assert.equal(b.take("a"), 0);
  assert.ok(b.take("a") >= 1);
  now += 1000;
  assert.equal(b.take("a"), 0);
  assert.equal(b.take("b"), 0);
});
