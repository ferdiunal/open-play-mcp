#!/usr/bin/env node
// Derleme zamanı dizin üreticisi (DESIGN.md §10.39): belgeler + TypeDoc JSON + C# kaynağı -> dist/index.json.
// Önce `tsc` koşmuş olmalı (dist/build/*.js). Ağ yalnız `npm ci` gerektiğinde (tools/sdk-reference) kullanılır.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../dist/build/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const tools = join(repo, "tools", "sdk-reference");
const out = join(here, "..", "dist", "index.json");

if (!existsSync(join(tools, "node_modules", ".bin", "typedoc"))) {
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tools, stdio: "inherit" });
}
const tmp = mkdtempSync(join(tmpdir(), "opmcp-typedoc-"));
const jsonPath = join(tmp, "typedoc.json");
try {
  execFileSync("npx", ["--no-install", "typedoc", "--json", jsonPath, "--skipErrorChecking", "--logLevel", "Warn"], { cwd: tools, stdio: "inherit" });
  const typedoc = JSON.parse(readFileSync(jsonPath, "utf8"));
  const index = buildIndex({ docsRoot: join(repo, "docs", "developer"), typedoc, unityRuntimeRoot: join(repo, "sdks", "unity", "Runtime") });
  writeFileSync(out, JSON.stringify(index));
  const unity = index.symbols.filter((s) => s.sdk === "unity").length;
  const ts = index.symbols.filter((s) => s.sdk === "typescript").length;
  console.log(`index.json: ${index.docs.length} sayfa, ${ts} TypeScript + ${unity} Unity sembol`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
