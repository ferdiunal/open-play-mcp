import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fakeDocsRoot, fakeTypedoc, FAKE_CS } from "./helpers.mjs";
import { buildDocsIndex } from "../dist/build/docs.js";
import { typedocToSymbols } from "../dist/build/typescript.js";
import { parseCSharp } from "../dist/build/unity.js";
import { createServer } from "../dist/server.js";

const index = {
  schema_version: 1,
  docs: buildDocsIndex(fakeDocsRoot()),
  symbols: [...typedocToSymbols(fakeTypedoc()), ...parseCSharp(FAKE_CS, "a.cs")],
};

async function connect() {
  const server = createServer(index);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}
const text = (r) => r.content.map((c) => c.text).join("\n");

test("altı araç, kaynak şablonu ve bir istem listelenir", async () => {
  const { client } = await connect();
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["get_sdk_symbol", "list_docs", "read_doc", "search_docs", "search_sdk"]);
  for (const t of (await client.listTools()).tools) assert.ok(t.description && t.description.length > 20, t.name);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  assert.deepEqual(prompts, ["integrate_open_play"]);
  const res = (await client.listResources()).resources.map((r) => r.uri).sort();
  assert.equal(res.length, 4);
  assert.ok(res.includes("open-play-docs://en/auth/guest"));
  assert.ok(res.includes("open-play-docs://tr/auth/guest"));
});

test("search_docs: varsayılan dil en, tr ile Türkçe", async () => {
  const { client } = await connect();
  const en = text(await client.callTool({ name: "search_docs", arguments: { query: "guest" } }));
  assert.match(en, /Guest sign-in/);
  assert.match(en, /https:\/\/open-play\.b4klabs\.dev\/docs\/en\/auth\/guest\.html/);
  const tr = text(await client.callTool({ name: "search_docs", arguments: { query: "misafir", lang: "tr" } }));
  assert.match(tr, /Misafir girişi/);
  const none = await client.callTool({ name: "search_docs", arguments: { query: "zzzznothing" } });
  assert.ok(!none.isError);
  assert.match(text(none), /No pages matched/);
});

test("read_doc: gövde, bulunamayan sayfa öneriyle isError, kesme", async () => {
  const { client } = await connect();
  const ok = await client.callTool({ name: "read_doc", arguments: { page: "auth/guest" } });
  assert.ok(!ok.isError);
  assert.match(text(ok), /signInGuest\(\)/);
  const miss = await client.callTool({ name: "read_doc", arguments: { page: "auth/gest" } });
  assert.equal(miss.isError, true);
  assert.match(text(miss), /auth\/guest/);
  const big = createServer({ ...index, docs: [{ ...index.docs[0], id: "auth/big", lang: "en", body: "x".repeat(50000) }] });
  const c2 = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([big.connect(a), c2.connect(b)]);
  const r = text(await c2.callTool({ name: "read_doc", arguments: { page: "auth/big" } }));
  assert.ok(r.length < 41000);
  assert.match(r, /truncated/);
});

test("list_docs: bölüm süzgeci ve geçersiz bölüm reddi", async () => {
  const { client } = await connect();
  const all = text(await client.callTool({ name: "list_docs", arguments: {} }));
  assert.match(all, /auth\/guest/);
  assert.match(all, /guides\/player-data/);
  const auth = text(await client.callTool({ name: "list_docs", arguments: { section: "auth" } }));
  assert.match(auth, /auth\/guest/);
  assert.doesNotMatch(auth, /player-data/);
  const bad = await client.callTool({ name: "list_docs", arguments: { section: "nope" } }).catch((e) => e);
  assert.ok(bad instanceof Error || bad.isError === true);
});

test("search_sdk ve get_sdk_symbol", async () => {
  const { client } = await connect();
  const found = text(await client.callTool({ name: "search_sdk", arguments: { query: "signInGuest", sdk: "typescript" } }));
  assert.match(found, /CrxClient/);
  const sym = text(await client.callTool({ name: "get_sdk_symbol", arguments: { name: "CrxClient", sdk: "typescript" } }));
  assert.match(sym, /signInGuest\(name\?: string\): Promise<Session>/);
  const member = text(await client.callTool({ name: "get_sdk_symbol", arguments: { name: "PlayerSession.SignInGuestAsync", sdk: "unity" } }));
  assert.match(member, /Task<SessionProfile> SignInGuestAsync/);
  const miss = await client.callTool({ name: "get_sdk_symbol", arguments: { name: "Nope", sdk: "unity" } });
  assert.equal(miss.isError, true);
  const ci = text(await client.callTool({ name: "get_sdk_symbol", arguments: { name: "crxclient", sdk: "typescript" } }));
  assert.match(ci, /CrxClient/);
});

test("kaynak okuma ve istem", async () => {
  const { client } = await connect();
  const r = await client.readResource({ uri: "open-play-docs://tr/auth/guest" });
  assert.match(r.contents[0].text, /Misafir/);
  await assert.rejects(client.readResource({ uri: "open-play-docs://en/nope/page" }));
  const p = await client.getPrompt({ name: "integrate_open_play", arguments: { platform: "unity" } });
  const body = p.messages.map((m) => m.content.text).join("\n");
  assert.match(body, /search_docs/);
  assert.match(body, /https:\/\/open-play\.b4klabs\.dev\/docs\/en\/getting-started\/quickstart\.html/);
});
