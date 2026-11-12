import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fixtureIndex, richIndex, text } from "./helpers.mjs";
import { createServer } from "../dist/server.js";

const index = fixtureIndex();

async function connect(idx = index, meta) {
  const server = createServer(idx, meta);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

test("eight tools, a resource template and one prompt are listed", async () => {
  const { client } = await connect();
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["get_endpoint", "get_error", "get_sdk_symbol", "index_info", "list_docs", "read_doc", "search_docs", "search_sdk"]);
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
  assert.match(body, /Scenario: unity/);
  assert.match(body, /search_docs/);
  assert.match(body, /- auth\/guest — Guest sign-in: https:\/\/open-play\.b4klabs\.dev\/docs\/en\/auth\/guest\.html/);
  assert.doesNotMatch(body, /getting-started\/quickstart/, "pages missing from the index are not offered");
});

const promptText = async (client, args) => (await client.getPrompt({ name: "integrate_open_play", arguments: args })).messages.map((m) => m.content.text).join("\n");

test("istem senaryoları: web-direct, web-bff, second-game; platform eski argümanı; geçersiz senaryo reddi", async () => {
  const { client } = await connect(richIndex());
  const args = (await client.listPrompts()).prompts[0].arguments.map((a) => a.name).sort();
  assert.deepEqual(args, ["platform", "scenario"]);
  const direct = await promptText(client, { scenario: "web-direct" });
  assert.match(direct, /auth: \{ mode: "token" \}/);
  assert.match(direct, /platform operator to bind/);
  assert.match(direct, /Panel checklist/);
  assert.match(direct, /panel\/game-settings-api-keys|auth\/guest/);
  assert.equal(await promptText(client, { platform: "web" }), direct);
  assert.equal(await promptText(client, {}), direct);
  const bff = await promptText(client, { scenario: "web-bff" });
  for (const needle of [/session_token/, /refresh_token/, /expires_in_secs \(900 s\) is only the access JWT lifetime/, /per client IP/, /one IP/, /Never apply currency amounts stated by the client/, /Allow-list leaderboard keys/, /Never delete a player's bootstrap secret on 429, 5xx/]) assert.match(bff, needle);
  const second = await promptText(client, { scenario: "second-game" });
  assert.match(second, /Ayarlar › Stüdyo ayarları › Oyunlar › Yeni oyun/);
  assert.match(second, /same player API base/);
  assert.match(second, /new API keys/);
  assert.match(second, /read-only for studio roles/);
  assert.match(second, /- panel\/game-settings-api-keys — API keys/);
  assert.match(await promptText(client, { scenario: "server" }), /Scenario: server/);
  await assert.rejects(client.getPrompt({ name: "integrate_open_play", arguments: { scenario: "nope" } }));
});

test("index_info: commit, yaş, kaynak, sayılar; eski dizinde eksik bölümleri söyler", async () => {
  const rich = await connect(richIndex(), { source: "snapshot" });
  const info = text(await rich.client.callTool({ name: "index_info", arguments: {} }));
  assert.match(info, /Commit: fixture/);
  assert.match(info, /Generated: 2026-11-04T00:00:00Z \(\d/);
  assert.match(info, /Loaded from: snapshot bundled with this server/);
  assert.match(info, /Pages: 6 \(en 4, tr 2\); panel pages with menu paths: 2/);
  assert.match(info, /Endpoints: 5 \(1 with an OpenAPI operationId\)/);
  assert.match(info, /Error codes: 3 \(en\), 1 \(tr\)/);
  assert.match(info, /open-play-mcp 0\.3\.0/);
  const old = text(await (await connect()).client.callTool({ name: "index_info", arguments: {} }));
  assert.match(old, /Endpoints: not in this index/);
  assert.match(old, /Error codes: not in this index/);
  assert.match(old, /Loaded from: unknown/);
});

test("get_endpoint: şablon, somut yol, tam URL, yöntem süzgeci, başka yöntem, öneri, eski dizin", async () => {
  const { client } = await connect(richIndex());
  const call = (args) => client.callTool({ name: "get_endpoint", arguments: args });
  const tpl = text(await call({ path: "/v1/leaderboards/{key}/scores", method: "post" }));
  assert.match(tpl, /POST \/v1\/leaderboards\/\{key\}\/scores/);
  assert.match(tpl, /Credentials: Server key \(OpenAPI security: LeaderboardServerKey\)/);
  assert.match(tpl, /Authorization: Bearer crx_live_<prefix>_<secret>/);
  assert.match(tpl, /Idempotency-Key \(required\)/);
  assert.match(tpl, /operationId: submitLeaderboardScore/);
  assert.equal(text(await call({ path: "https://lantern.open-play.tech/api/v1/leaderboards/weekly/scores?x=1" })), tpl);
  assert.equal(text(await call({ path: "POST /api/arena/v1/leaderboards/weekly/scores/" })), tpl);
  const literal = text(await call({ path: "/v1/leaderboards/mine" }));
  assert.match(literal, /GET \/v1\/leaderboards\/mine/);
  assert.doesNotMatch(literal, /\{key\}/, "a literal route wins over a {param} route");
  assert.match(literal, /x-crx-env \(required\)/);
  const buy = text(await call({ path: "/v1/player/store/listings/abc/buy" }));
  assert.match(buy, /x-csrf-token \(optional; required with a cookie session\)/);
  assert.match(buy, /player session/);
  const wrong = await call({ path: "/v1/leaderboards/{key}/scores", method: "DELETE" });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /that path has: POST/);
  const miss = await call({ path: "/v1/leaderbords/{key}/scores" });
  assert.equal(miss.isError, true);
  assert.match(text(miss), /Closest: POST \/v1\/leaderboards\/\{key\}\/scores/);
  const old = await (await connect()).client.callTool({ name: "get_endpoint", arguments: { path: "/v1/x" } });
  assert.ok(!old.isError);
  assert.match(text(old), /has no endpoint table/);
  assert.match(text(old), /reference\/endpoints/);
});

test("get_error: makine kodu, HTTP durumu ve o durumdaki kodlar, dil, öneri, eski dizin", async () => {
  const { client } = await connect(richIndex());
  const call = (args) => client.callTool({ name: "get_error", arguments: args });
  const md = text(await call({ code: "`module_disabled`" }));
  assert.match(md, /module_disabled — HTTP 404 · Core REST: status table/);
  assert.match(md, /reference\/errors\.html/);
  const status = text(await call({ code: "HTTP 404 Not Found" }));
  assert.match(status, /^404 · Core REST/m);
  assert.match(status, /Machine codes sent with HTTP 404:\n- module_disabled/);
  assert.match(text(await call({ code: "module_disabled", lang: "tr" })), /Çekirdek REST/);
  const near = await call({ code: "idempotency_inflight" });
  assert.equal(near.isError, true);
  assert.match(text(near), /Did you mean: idempotency_in_flight/);
  const old = await (await connect()).client.callTool({ name: "get_error", arguments: { code: "409" } });
  assert.ok(!old.isError);
  assert.match(text(old), /has no error code table/);
});

test("panel sayfası: search_docs ve read_doc menü yolu, rota ve yetki gösterir", async () => {
  const { client } = await connect(richIndex());
  const hit = text(await client.callTool({ name: "search_docs", arguments: { query: "api keys environment id" } }));
  assert.match(hit, /Panel: Settings › Game settings › API keys \(TR UI: Ayarlar › Oyun ayarları › API anahtarları\) · route #\/settings\/api-keys · needs panel capability api_keys_read/);
  const tr = text(await client.callTool({ name: "read_doc", arguments: { page: "panel/studio-settings", lang: "tr" } }));
  assert.match(tr, /Panel: Ayarlar › Stüdyo ayarları \(EN UI: Settings › Studio settings\) · route #\/studio · needs panel capability platform_read · only for roles studio_owner, studio_admin · only in the studio realm/);
  assert.doesNotMatch(text(await client.callTool({ name: "read_doc", arguments: { page: "auth/guest" } })), /Panel:/);
});

test("server instructions mention index_info and the scenarios", async () => {
  const { client } = await connect();
  const instructions = client.getInstructions();
  assert.match(instructions, /index_info/);
  assert.match(instructions, /web-direct, web-bff, second-game, unity, server/);
});
