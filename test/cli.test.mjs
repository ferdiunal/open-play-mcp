import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fakeDocsRoot, fakeTypedoc, FAKE_CS } from "./helpers.mjs";
import { buildDocsIndex } from "../dist/build/docs.js";
import { typedocToSymbols } from "../dist/build/typescript.js";
import { parseCSharp } from "../dist/build/unity.js";
import { loadIndex } from "../dist/load-index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "opmcp-cli-"));
const indexPath = join(dir, "index.json");
writeFileSync(indexPath, JSON.stringify({ schema_version: 1, docs: buildDocsIndex(fakeDocsRoot()), symbols: [...typedocToSymbols(fakeTypedoc()), ...parseCSharp(FAKE_CS, "a.cs")] }));
const text = (r) => r.content.map((c) => c.text).join("\n");

test("loadIndex: sürüm uyuşmazlığı hata verir", () => {
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ schema_version: 99, docs: [], symbols: [] }));
  assert.throws(() => loadIndex(bad), /schema_version/);
  assert.equal(loadIndex(indexPath).docs.length, 4);
});

test("stdio: süreç başlar, initialize ve search_docs çalışır", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "--index", indexPath] });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const out = text(await client.callTool({ name: "search_docs", arguments: { query: "player data" } }));
    assert.match(out, /Player data/);
  } finally {
    await client.close();
  }
});

test("--http: boş porta bağlanır, Streamable HTTP ile araç çağrılır, GET 405", async () => {
  const child = spawn(process.execPath, [cli, "--index", indexPath, "--http", "0"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const url = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("dinleme satırı gelmedi: " + buf)), 10000);
      child.stderr.on("data", (d) => {
        buf += d;
        const m = /listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      child.on("exit", (c) => reject(new Error("erken çıktı " + c + buf)));
    });
    const client = new Client({ name: "http", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const out = text(await client.callTool({ name: "search_sdk", arguments: { query: "CrxClient" } }));
    assert.match(out, /CrxClient/);
    await client.close();
    const get = await fetch(url);
    assert.equal(get.status, 405);
    const other = await fetch(url.replace("/mcp", "/nope"));
    assert.equal(other.status, 404);
  } finally {
    child.kill("SIGTERM");
  }
});

test("gerçek dizin (dist/index.json) varsa: gerçek sorular cevap bulur", { skip: !existsSync(join(here, "..", "dist", "index.json")) }, async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli] });
  const client = new Client({ name: "real", version: "0.0.0" });
  await client.connect(transport);
  try {
    const guest = text(await client.callTool({ name: "search_docs", arguments: { query: "guest sign in" } }));
    assert.match(guest, /auth\/guest/);
    const data = text(await client.callTool({ name: "search_docs", arguments: { query: "save player data" } }));
    assert.match(data, /guides\/player-data/);
    const plugin = text(await client.callTool({ name: "search_docs", arguments: { query: "call a plugin" } }));
    assert.match(plugin, /plugins\/calling-plugins/);
    const sdk = text(await client.callTool({ name: "get_sdk_symbol", arguments: { name: "PlayerSession", sdk: "unity" } }));
    assert.match(sdk, /SignInGuestAsync/);
  } finally {
    await client.close();
  }
});
