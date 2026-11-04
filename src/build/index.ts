/**
 * # open-play-mcp::build
 *
 * **Neden var:** üç kaynağı (belgeler, TypeDoc JSON, C# kaynağı) tek `McpIndex` olarak birleştirir (DESIGN.md §10.39).
 * **Kapsam:** `buildIndex`.
 * **Sahip olduğu tipler:** `BuildIndexInput`.
 */
import { SCHEMA_VERSION, type McpIndex } from "../types.js";
import { buildDocsIndex } from "./docs.js";
import { typedocToSymbols } from "./typescript.js";
import { buildUnitySymbols } from "./unity.js";

/** Dizin girdisi: belge kökü, TypeDoc JSON nesnesi, Unity `Runtime` dizini. */
export interface BuildIndexInput {
  docsRoot: string;
  typedoc: object;
  unityRuntimeRoot: string;
}

/** Üç kaynaktan `McpIndex` üretir. */
export function buildIndex(input: BuildIndexInput): McpIndex {
  return {
    schema_version: SCHEMA_VERSION,
    docs: buildDocsIndex(input.docsRoot),
    symbols: [...typedocToSymbols(input.typedoc), ...buildUnitySymbols(input.unityRuntimeRoot)],
  };
}
