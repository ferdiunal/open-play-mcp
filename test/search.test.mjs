import test from "node:test";
import assert from "node:assert/strict";
import { fixtureIndex } from "./helpers.mjs";
import { rankDocs, rankSymbols, foldText, tokenize } from "../dist/search.js";

const index = fixtureIndex();

test("foldText Türkçe harfleri katlar", () => {
  assert.equal(foldText("Misafır GİRİŞİ Şifre"), "misafir girisi sifre");
  assert.deepEqual(tokenize("a, guest-sign in!"), ["guest", "sign", "in"]);
});

test("başlık gövdeden önce gelir", () => {
  const r = rankDocs(index, { query: "guest", lang: "en", limit: 5 });
  assert.equal(r[0].page.id, "auth/guest");
  assert.equal(r[1].page.id, "guides/player-data");
});

test("dil süzgeci ve Türkçe katlama", () => {
  const r = rankDocs(index, { query: "misafır", lang: "tr", limit: 5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].page.lang, "tr");
});

test("ara başlık ve limit; boş sorgu boş döner", () => {
  assert.equal(rankDocs(index, { query: "create guest", lang: "en", limit: 1 }).length, 1);
  assert.deepEqual(rankDocs(index, { query: "  ", lang: "en", limit: 5 }), []);
  assert.deepEqual(rankDocs(index, { query: "zzzznothing", lang: "en", limit: 5 }), []);
});

test("sıralama deterministik (eşit puanda kimlik sırası)", () => {
  const a = rankDocs(index, { query: "plugin", lang: "en", limit: 5 }).map((r) => r.page.id);
  const b = rankDocs(index, { query: "plugin", lang: "en", limit: 5 }).map((r) => r.page.id);
  assert.deepEqual(a, b);
  assert.equal(a[0], "plugins/calling-plugins");
});

test("SDK araması: tam ad, üye adı, sdk süzgeci", () => {
  const exact = rankSymbols(index, { query: "CrxClient", limit: 5 });
  assert.equal(exact[0].symbol.name, "CrxClient");
  const member = rankSymbols(index, { query: "signInGuest", sdk: "typescript", limit: 5 });
  assert.equal(member[0].symbol.name, "CrxClient");
  const unity = rankSymbols(index, { query: "SignInGuestAsync", sdk: "unity", limit: 5 });
  assert.equal(unity[0].symbol.name, "PlayerSession");
  assert.deepEqual(rankSymbols(index, { query: "SignInGuestAsync", sdk: "typescript", limit: 5 }), []);
});
