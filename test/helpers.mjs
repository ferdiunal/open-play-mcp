// Test helpers: the fixture index is a small checked-in JSON (docs in en/tr + TypeScript and Unity symbols).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(here, "fixtures", "index.json");

/** Fresh copy of the fixture index. */
export function fixtureIndex() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

/** Text of an MCP tool result. */
export const text = (r) => r.content.map((c) => c.text).join("\n");
