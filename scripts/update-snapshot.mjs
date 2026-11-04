#!/usr/bin/env node
// Refreshes the bundled fallback snapshot (snapshot/index.json) from the published index or a local file.
// Usage: node scripts/update-snapshot.mjs [--from <file|url>]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "https://open-play.b4klabs.dev/docs/mcp/index.json";
const args = process.argv.slice(2);
const at = args.indexOf("--from");
const from = at >= 0 ? args[at + 1] : DEFAULT_URL;
if (!from) {
  console.error("--from needs a file path or URL");
  process.exit(2);
}

const raw = /^https?:\/\//.test(from)
  ? await fetch(from, { signal: AbortSignal.timeout(30_000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${from}`);
      return r.text();
    })
  : readFileSync(from, "utf8");

const index = JSON.parse(raw);
if (index.schemaVersion !== 1) throw new Error(`unsupported schemaVersion ${String(index.schemaVersion)}`);
if (!Array.isArray(index.docs) || !Array.isArray(index.symbols)) throw new Error("index needs docs[] and symbols[]");
if (index.docs.length < 100 || index.symbols.length < 200) throw new Error(`index looks too small (${index.docs.length} docs, ${index.symbols.length} symbols)`);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "snapshot", "index.json");
writeFileSync(out, JSON.stringify(index));
console.log(`snapshot/index.json: ${index.docs.length} docs, ${index.symbols.length} symbols, commit ${index.commit}, generated ${index.generatedAt}`);
