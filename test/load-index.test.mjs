import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureIndex } from "./helpers.mjs";
import { IndexStore, loadIndex, validateIndex } from "../dist/load-index.js";

const quiet = () => {};
const tmp = () => mkdtempSync(join(tmpdir(), "opmcp-cache-"));
const reply = (body, init = {}) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init);

test("validateIndex: rejects another schemaVersion and malformed bodies", () => {
  assert.throws(() => validateIndex({ ...fixtureIndex(), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateIndex({ schemaVersion: 1, docs: {}, symbols: [] }), /docs\[\]/);
  assert.throws(() => validateIndex(null), /not an object/);
  assert.equal(validateIndex(fixtureIndex()).commit, "fixture");
});

test("validateIndex: keeps endpoints/errors arrays, drops malformed ones, accepts an older index without them", () => {
  const old = validateIndex(fixtureIndex());
  assert.equal("endpoints" in old, false);
  assert.equal("errors" in old, false);
  const rich = validateIndex({ ...fixtureIndex(), endpoints: [{ method: "GET", path: "/v1/x" }], errors: [] });
  assert.equal(rich.endpoints.length, 1);
  assert.deepEqual(rich.errors, []);
  const bad = validateIndex({ ...fixtureIndex(), endpoints: {}, errors: "x" });
  assert.equal(bad.endpoints, undefined);
  assert.equal(bad.errors, undefined);
});

test("200: fresh index is used and cached with its ETag", async () => {
  const cacheDir = tmp();
  const r = await loadIndex({ cacheDir, log: quiet, fetchImpl: reply(fixtureIndex(), { status: 200, headers: { etag: '"v1"' } }) });
  assert.equal(r.source, "network");
  assert.equal(r.index.docs.length, fixtureIndex().docs.length);
  assert.equal(JSON.parse(readFileSync(join(cacheDir, "index.meta.json"), "utf8")).etag, '"v1"');
});

test("304: the cached copy is used and If-None-Match is sent", async () => {
  const cacheDir = tmp();
  await loadIndex({ cacheDir, log: quiet, fetchImpl: reply(fixtureIndex(), { headers: { etag: '"v1"' } }) });
  let sent;
  const r = await loadIndex({
    cacheDir,
    log: quiet,
    fetchImpl: async (_u, init) => {
      sent = init.headers["if-none-match"];
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(sent, '"v1"');
  assert.equal(r.source, "cache");
});

test("network error: disk cache first, then the bundled snapshot", async () => {
  const fail = async () => {
    throw new Error("offline");
  };
  const empty = tmp();
  const snap = await loadIndex({ cacheDir: empty, log: quiet, fetchImpl: fail });
  assert.equal(snap.source, "snapshot");
  assert.ok(snap.index.docs.length >= 100);

  const cacheDir = tmp();
  await loadIndex({ cacheDir, log: quiet, fetchImpl: reply(fixtureIndex()) });
  const cached = await loadIndex({ cacheDir, log: quiet, fetchImpl: fail });
  assert.equal(cached.source, "cache");
  assert.equal(cached.index.commit, "fixture");
});

test("HTTP 500, bad JSON and wrong schemaVersion all fall back", async () => {
  for (const fetchImpl of [reply("boom", { status: 500 }), reply("not json"), reply({ ...fixtureIndex(), schemaVersion: 2 })]) {
    const cacheDir = tmp();
    const r = await loadIndex({ cacheDir, log: quiet, fetchImpl });
    assert.equal(r.source, "snapshot");
    assert.equal(existsSync(join(cacheDir, "index.json")), false, "a bad body must not be cached");
  }
});

test("a corrupt cache file is ignored", async () => {
  const cacheDir = tmp();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "index.json"), "{broken");
  const r = await loadIndex({ cacheDir, log: quiet, fetchImpl: async () => Promise.reject(new Error("offline")) });
  assert.equal(r.source, "snapshot");
});

test("timeout: a hanging server falls back within the timeout", async () => {
  const keepAlive = setInterval(() => {}, 100); // AbortSignal.timeout is unref'd; real sockets keep the loop alive, a fake does not
  after(() => clearInterval(keepAlive));
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("timed out"))));
  const t0 = Date.now();
  const r = await loadIndex({ cacheDir: tmp(), log: quiet, timeoutMs: 100, fetchImpl: hang });
  assert.equal(r.source, "snapshot");
  assert.ok(Date.now() - t0 < 3000);
});

test("IndexStore.refresh: success swaps the index, failure keeps the old one", async () => {
  const cacheDir = tmp();
  const first = await loadIndex({ cacheDir, log: quiet, fetchImpl: reply(fixtureIndex()) });
  const next = { ...fixtureIndex(), commit: "newer" };
  let mode = "ok";
  const store = new IndexStore(first, {
    cacheDir,
    log: quiet,
    fetchImpl: async () => {
      if (mode === "fail") throw new Error("offline");
      return new Response(JSON.stringify(next), { status: 200 });
    },
  });
  await store.refresh();
  assert.equal(store.current.commit, "newer");
  mode = "fail";
  await store.refresh();
  assert.equal(store.current.commit, "newer");
});
