import test from "node:test";
import assert from "node:assert/strict";
import { fixtureIndex, regressionIndex } from "./helpers.mjs";
import { rankDocs, rankSymbols, foldText, tokenize, queryConcepts } from "../dist/search.js";

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

test("durak sözcükleri ve tam sözcük: kısa terim alt dizgeyle eşleşmez, uzun terim önekle eşleşir", () => {
  const page = (id, title, body) => ({ id, lang: "en", title, description: "", section: "guides", url: `https://x/${id}`, headings: [], body });
  const idx = { docs: [page("a/renew", "Renewals", "renew the newsletter index often"), page("b/new", "New things", "a new game"), page("c/keys", "API keys", "keys")], symbols: [] };
  assert.deepEqual(rankDocs(idx, { query: "in the of", lang: "en", limit: 5 }), []);
  assert.deepEqual(rankDocs(idx, { query: "new", lang: "en", limit: 5 }).map((h) => h.page.id), ["b/new"]);
  assert.deepEqual(rankDocs(idx, { query: "renewal", lang: "en", limit: 5 }).map((h) => h.page.id), ["a/renew"]);
  assert.deepEqual(rankDocs(idx, { query: "key", lang: "en", limit: 5 }).map((h) => h.page.id), ["c/keys"]);
});

test("eş anlamlılar: misafir ↔ guest, x-crx-env ↔ environment id; yazılan ifade eş anlamlıdan ağır basar", () => {
  assert.equal(rankDocs(index, { query: "misafir", lang: "en", limit: 5 })[0].page.id, "auth/guest");
  assert.equal(rankDocs(index, { query: "cloud save", lang: "en", limit: 5 })[0].page.id, "guides/player-data");
  const concepts = queryConcepts("create a new game");
  assert.equal(concepts.length, 2);
  assert.deepEqual(concepts[1].alts[concepts[1].typed], ["new", "game"]);
  assert.deepEqual(queryConcepts("x-crx-env")[0].alts, queryConcepts("ortam kimliği")[0].alts);
  const page = (id, body) => ({ id, lang: "en", title: id, description: "", section: "guides", url: `https://x/${id}`, headings: [], body });
  const idx = { docs: [page("p/typed", "new game"), page("p/synonym", "yeni oyun")], symbols: [] };
  assert.deepEqual(rankDocs(idx, { query: "new game", lang: "en", limit: 5 }).map((h) => h.page.id), ["p/typed", "p/synonym"]);
});

// Gerçek belge sayfalarıyla (Open Play e07055673) arama gerilemesi: denetimde yanıltan üç sorgu.
const real = regressionIndex();
const ids = (query, lang) => rankDocs(real, { query, lang, limit: 5 }).map((h) => h.page.id);

test("gerileme: 'create a new game' Stüdyo ayarlarını operatör ekranı (tenancy) önünde ilk ikide verir", () => {
  const en = ids("create a new game", "en");
  assert.ok(en.indexOf("panel/studio-settings") >= 0 && en.indexOf("panel/studio-settings") < 2, en.join(", "));
  assert.ok(en.indexOf("panel/studio-settings") < en.indexOf("panel/tenancy") || !en.includes("panel/tenancy"), en.join(", "));
  const tr = ids("yeni oyun oluştur", "tr");
  assert.notEqual(tr[0], "panel/tenancy", tr.join(", "));
  assert.ok(tr.indexOf("panel/studio-settings") >= 0 && tr.indexOf("panel/studio-settings") < tr.indexOf("panel/tenancy"), tr.join(", "));
});

test("gerileme: 'ortam kimliği' API anahtarları sayfasını verir, erişilemeyen Ortamlar sekmesini değil", () => {
  for (const lang of ["tr", "en"]) {
    const r = ids("ortam kimliği", lang);
    assert.equal(r[0], "panel/game-settings-api-keys", `${lang}: ${r.join(", ")}`);
    assert.ok(!r.slice(0, 3).includes("panel/game-settings-environments"), `${lang}: ${r.join(", ")}`);
  }
});

test("gerileme: 'API key environment id' API anahtarları sayfasını kavramlar sayfasının önünde verir", () => {
  const hits = rankDocs(real, { query: "API key environment id", lang: "en", limit: 5 });
  assert.equal(hits[0].page.id, "panel/game-settings-api-keys");
  assert.ok(hits[0].score >= 1.5 * hits[1].score, hits.map((h) => `${h.page.id}(${h.score})`).join(", "));
});
