// Test yardımcıları: küçük sahte belge ağacı, typedoc JSON'u ve C# kaynağı üretir.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeDoc(root, lang, id, meta, body) {
  const file = join(root, lang, `${id}.md`);
  mkdirSync(join(file, ".."), { recursive: true });
  const fm = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  writeFileSync(file, `---\nid: ${id}\n${fm}\nlang: ${lang}\n---\n\n${body}\n`);
}

/** İki dilli, üç sayfalık sahte belge ağacı. */
export function fakeDocsRoot() {
  const root = mkdtempSync(join(tmpdir(), "opmcp-docs-"));
  writeDoc(
    root,
    "en",
    "auth/guest",
    { title: "Guest sign-in", description: "Signs a player in without an account." },
    "# Guest sign-in\n\nA guest player gets a session without e-mail.\n\n## Create the guest\n\nCall `signInGuest()`.\n\n### Errors\n\nSee the error table.\n",
  );
  writeDoc(
    root,
    "tr",
    "auth/guest",
    { title: "Misafir girişi", description: "Oyuncuyu hesapsız girdirir." },
    "# Misafir girişi\n\nMisafir oyuncu e-posta olmadan oturum alır.\n\n## Misafiri oluştur\n\n`signInGuest()` çağrılır.\n",
  );
  writeDoc(
    root,
    "en",
    "guides/player-data",
    { title: "Player data", description: "Saves cloud data blobs for a player." },
    "# Player data\n\nSave player data as an opaque JSON blob with a version.\n\n## Save\n\nUse `saveData`. The guest word appears once here.\n",
  );
  writeDoc(
    root,
    "en",
    "plugins/calling-plugins",
    { title: "Calling plugins", description: "Calls a plugin command." },
    "# Calling plugins\n\nCall a plugin with `callPlugin`.\n",
  );
  return root;
}

/** typedoc --json biçiminde küçük modül ağacı. */
export function fakeTypedoc() {
  const text = (t) => ({ summary: [{ kind: "text", text: t }] });
  return {
    schemaVersion: "2.0",
    name: "x",
    kind: 1,
    children: [
      {
        name: "typescript/src",
        kind: 2,
        children: [
          {
            name: "CrxClient",
            kind: 128,
            comment: text("Typed client."),
            children: [
              { name: "constructor", kind: 512, signatures: [{ name: "CrxClient", kind: 16384, parameters: [{ name: "options", type: { type: "reference", name: "ClientOptions" } }], type: { type: "reference", name: "CrxClient" } }] },
              {
                name: "signInGuest",
                kind: 2048,
                signatures: [
                  {
                    name: "signInGuest",
                    kind: 4096,
                    comment: text("Signs in a guest."),
                    parameters: [{ name: "name", flags: { isOptional: true }, type: { type: "intrinsic", name: "string" } }],
                    type: { type: "reference", name: "Promise", typeArguments: [{ type: "reference", name: "Session" }] },
                  },
                ],
              },
              { name: "secret", kind: 1024, flags: { isPrivate: true }, type: { type: "intrinsic", name: "string" } },
            ],
          },
          {
            name: "ClientOptions",
            kind: 256,
            comment: text("Options for the client."),
            children: [{ name: "baseUrl", kind: 1024, comment: text("Server address."), type: { type: "intrinsic", name: "string" } }],
          },
          { name: "Reexported", kind: 4194304, target: 1 },
          {
            name: "ErrorKind",
            kind: 8,
            comment: text("Error kinds."),
            children: [{ name: "Network", kind: 16, type: { type: "literal", value: "network" } }],
          },
          { name: "Mode", kind: 2097152, comment: text("Mode union."), type: { type: "union", types: [{ type: "literal", value: "a" }, { type: "literal", value: "b" }] } },
          { name: "makeThing", kind: 64, signatures: [{ name: "makeThing", kind: 4096, comment: text("Makes a thing."), parameters: [{ name: "n", type: { type: "intrinsic", name: "number" } }], type: { type: "array", elementType: { type: "intrinsic", name: "string" } } }] },
        ],
      },
      {
        name: "typescript/src/player",
        kind: 2,
        children: [{ name: "PlayerClient", kind: 256, comment: text("Player client."), children: [] }],
      },
      { name: "panel-kit/src", kind: 2, children: [{ name: "PanelThing", kind: 256, comment: text("Panel."), children: [] }] },
    ],
  };
}

export const FAKE_CS = `using System;
namespace OpenPlay.Session
{
    /// <summary>
    /// Oyuncu oturumu: <b>misafir</b> girişi (<see cref="ErrorKind.Network"/>).
    /// </summary>
    public sealed class PlayerSession
    {
        private const string Hidden = "}{";
        /// <summary>Oturum durumu.</summary>
        public SessionState State { get; }

        /// <summary>Misafir olarak girer.</summary>
        public Task<SessionProfile> SignInGuestAsync(string name = null, CancellationToken ct = default)
        {
            var x = "{ not a brace }";
            return null;
        }

        private void Internal() { }

        public sealed class Nested { public int Value; }
    }

    /// <summary>Oturum durumları.</summary>
    public enum SessionState { Signed, Anonymous, Expired }

    internal class Skipped { public void Foo() { } }

    /// <summary>Okuma arayüzü.</summary>
    public interface ISecretStore
    {
        /// <summary>Okur.</summary>
        string Read(string key);
    }
}
`;
