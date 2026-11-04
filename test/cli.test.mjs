import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FIXTURE_PATH, text } from "./helpers.mjs";
import { parseArgs } from "../dist/args.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");
const cacheDir = mkdtempSync(join(tmpdir(), "opmcp-cli-cache-"));
const env = { ...process.env, OPEN_PLAY_MCP_CACHE_DIR: cacheDir };
const DEAD_URL = "http://127.0.0.1:9/docs/mcp/index.json";

test("parseArgs: defaults, flags and env override", () => {
  const d = parseArgs([], {});
  assert.equal(d.host, "127.0.0.1");
  assert.equal(d.docsUrl, "https://open-play.b4klabs.dev/docs/mcp/index.json");
  assert.deepEqual(d.allowedOrigins, ["https://open-play.b4klabs.dev"]);
  assert.equal(d.rateLimit, 60);
  assert.equal(d.burst, 20);
  assert.equal(parseArgs([], { OPEN_PLAY_MCP_INDEX_URL: "http://x/i.json" }).docsUrl, "http://x/i.json");
  const o = parseArgs(["--http", "8080", "--host", "0.0.0.0", "--trust-proxy", "--allowed-origins", "https://a.example, https://b.example", "--rate-limit", "5", "--burst", "2", "--docs-url", "http://y"], {});
  assert.equal(o.http, 8080);
  assert.equal(o.trustProxy, true);
  assert.deepEqual(o.allowedOrigins, ["https://a.example", "https://b.example"]);
  assert.equal(o.docsUrl, "http://y");
  assert.throws(() => parseArgs(["--nope"], {}), /unknown argument/);
  assert.throws(() => parseArgs(["--http", "99999"], {}), /port/);
});

test("stdio with --index: initialize and search_docs work", async () => {
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "--index", FIXTURE_PATH], env }));
  try {
    assert.match(text(await client.callTool({ name: "search_docs", arguments: { query: "player data" } })), /Player data/);
  } finally {
    await client.close();
  }
});

test("stdio with an unreachable index URL: stdout stays clean (client works), snapshot serves real answers, stderr explains", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "--docs-url", DEAD_URL], env, stderr: "pipe" });
  let err = "";
  transport.stderr?.on("data", (d) => (err += d));
  const client = new Client({ name: "offline", version: "0.0.0" });
  await client.connect(transport);
  try {
    assert.match(text(await client.callTool({ name: "search_docs", arguments: { query: "guest sign in" } })), /auth\/guest/);
    assert.match(text(await client.callTool({ name: "get_sdk_symbol", arguments: { name: "PlayerSession", sdk: "unity" } })), /SignInGuestAsync/);
    assert.match(err, /from snapshot/);
  } finally {
    await client.close();
  }
});

test("--http: starts on a free port, serves MCP and /healthz", async () => {
  const child = spawn(process.execPath, [cli, "--index", FIXTURE_PATH, "--http", "0"], { stdio: ["ignore", "ignore", "pipe"], env });
  try {
    const url = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("no listen line: " + buf)), 10000);
      child.stderr.on("data", (d) => {
        buf += d;
        const m = /listening on (http:\/\/127\.0\.0\.1:\d+)\/mcp/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      child.on("exit", (c) => reject(new Error("exited early " + c + buf)));
    });
    const client = new Client({ name: "http", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    assert.match(text(await client.callTool({ name: "search_sdk", arguments: { query: "CrxClient" } })), /CrxClient/);
    await client.close();
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    assert.equal((await fetch(`${url}/mcp`)).status, 405);
  } finally {
    child.kill("SIGTERM");
  }
});

test("bundled snapshot answers real questions", async () => {
  const client = new Client({ name: "real", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "--docs-url", DEAD_URL], env }));
  try {
    assert.match(text(await client.callTool({ name: "search_docs", arguments: { query: "save player data" } })), /guides\/player-data/);
    assert.match(text(await client.callTool({ name: "search_docs", arguments: { query: "call a plugin" } })), /plugins\/calling-plugins/);
  } finally {
    await client.close();
  }
});
