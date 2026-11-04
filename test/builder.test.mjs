import test from "node:test";
import assert from "node:assert/strict";
import { fakeDocsRoot, fakeTypedoc, FAKE_CS } from "./helpers.mjs";
import { buildDocsIndex } from "../dist/build/docs.js";
import { typedocToSymbols } from "../dist/build/typescript.js";
import { parseCSharp } from "../dist/build/unity.js";

test("belge dizini: front matter atılır, bölüm ve URL türetilir", () => {
  const docs = buildDocsIndex(fakeDocsRoot());
  assert.equal(docs.length, 4);
  const en = docs.find((d) => d.lang === "en" && d.id === "auth/guest");
  assert.equal(en.title, "Guest sign-in");
  assert.equal(en.description, "Signs a player in without an account.");
  assert.equal(en.section, "auth");
  assert.equal(en.url, "https://open-play.b4klabs.dev/docs/en/auth/guest.html");
  assert.ok(!en.body.includes("source_sha256"));
  assert.ok(!en.body.startsWith("---"));
  assert.deepEqual(en.headings, ["Create the guest", "Errors"]);
  const tr = docs.find((d) => d.lang === "tr");
  assert.equal(tr.url, "https://open-play.b4klabs.dev/docs/tr/auth/guest.html");
});

test("belge dizini: bilinmeyen bölüm hata verir", () => {
  const root = fakeDocsRoot();
  assert.throws(() => buildDocsIndex(root, { sections: ["auth"] }), /bölüm/);
});

test("typedoc: yalnız dışa açık bildirimler, üyeler ve modül adı", () => {
  const symbols = typedocToSymbols(fakeTypedoc());
  const names = symbols.map((s) => s.name).sort();
  assert.deepEqual(names, ["ClientOptions", "CrxClient", "ErrorKind", "Mode", "PanelThing", "PlayerClient", "makeThing"]);
  const client = symbols.find((s) => s.name === "CrxClient");
  assert.equal(client.sdk, "typescript");
  assert.equal(client.kind, "class");
  assert.equal(client.module, "@ferdiunal/open-play-ts");
  assert.equal(client.summary, "Typed client.");
  const guest = client.members.find((m) => m.name === "signInGuest");
  assert.equal(guest.signature, "signInGuest(name?: string): Promise<Session>");
  assert.equal(guest.summary, "Signs in a guest.");
  assert.ok(!client.members.some((m) => m.name === "secret"));
  assert.equal(symbols.find((s) => s.name === "PlayerClient").module, "@ferdiunal/open-play-ts/player");
  assert.equal(symbols.find((s) => s.name === "PanelThing").module, "@open-play/panel-kit");
  assert.equal(symbols.find((s) => s.name === "Mode").signature, 'type Mode = "a" | "b"');
  assert.equal(symbols.find((s) => s.name === "makeThing").signature, "makeThing(n: number): string[]");
  assert.equal(symbols.find((s) => s.name === "ErrorKind").kind, "enum");
});

test("C#: public türler ve üyeler, özet etiketleri temizlenir, iç ve özel atlanır", () => {
  const symbols = parseCSharp(FAKE_CS, "Runtime/Core/Session/PlayerSession.cs");
  const names = symbols.map((s) => s.name).sort();
  assert.deepEqual(names, ["ISecretStore", "PlayerSession", "PlayerSession.Nested", "SessionState"]);
  const ps = symbols.find((s) => s.name === "PlayerSession");
  assert.equal(ps.sdk, "unity");
  assert.equal(ps.kind, "class");
  assert.equal(ps.module, "OpenPlay.Session");
  assert.equal(ps.summary, "Oyuncu oturumu: misafir girişi (ErrorKind.Network).");
  assert.deepEqual(ps.members.map((m) => m.name), ["State", "SignInGuestAsync"]);
  assert.equal(ps.members[1].signature, "Task<SessionProfile> SignInGuestAsync(string name = null, CancellationToken ct = default)");
  assert.equal(ps.members[1].summary, "Misafir olarak girer.");
  const en = symbols.find((s) => s.name === "SessionState");
  assert.equal(en.kind, "enum");
  assert.deepEqual(en.members.map((m) => m.name), ["Signed", "Anonymous", "Expired"]);
  const iface = symbols.find((s) => s.name === "ISecretStore");
  assert.deepEqual(iface.members.map((m) => m.name), ["Read"]);
});
