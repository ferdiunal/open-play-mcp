/**
 * # open-play-mcp::types
 *
 * **Neden var:** dizin biçimi ve sınırlı değer kümeleri (DESIGN.md §10.39) tek yerde tanımlanır; sunucu, arama ve
 * dizin üreticisi aynı tipleri kullanır. Serbest metinle enum karşılaştırması yapılmaz (AGENTS.md §11).
 * **Kapsam:** `DocLang`, `SdkKind`, `DocSection`, `SdkSymbolKind` kümeleri; `DocPage`, `SdkMember`, `SdkSymbol`, `McpIndex` biçimleri.
 * **Sahip olduğu tipler:** yukarıdakilerin hepsi.
 */

/** Belge dilleri: `tr` kaynak dildir, `en` çeviridir. */
export const DOC_LANGS = ["en", "tr"] as const;
/** Bir belge dili (`en` ya da `tr`). */
export type DocLang = (typeof DOC_LANGS)[number];

/** SDK türleri: TypeScript ve Unity. */
export const SDK_KINDS = ["typescript", "unity"] as const;
/** Bir SDK türü. */
export type SdkKind = (typeof SDK_KINDS)[number];

/** Belge bölümleri: sayfa kimliğinin ilk parçası. */
export const DOC_SECTIONS = [
  "getting-started",
  "auth",
  "sdk",
  "guides",
  "realtime",
  "plugins",
  "reference",
  "operations",
  "panel",
] as const;
/** Bir belge bölümü. */
export type DocSection = (typeof DOC_SECTIONS)[number];

/** SDK sembol türleri. */
export const SDK_SYMBOL_KINDS = ["class", "interface", "struct", "enum", "type", "function", "variable", "namespace"] as const;
/** Bir SDK sembol türü. */
export type SdkSymbolKind = (typeof SDK_SYMBOL_KINDS)[number];

/** Dizindeki bir belge sayfası. Alanlar: kimlik, dil, başlık, açıklama, bölüm, genel URL, ara başlıklar, markdown gövdesi. */
export interface DocPage {
  id: string;
  lang: DocLang;
  title: string;
  description: string;
  section: DocSection;
  url: string;
  headings: string[];
  body: string;
}

/** Bir sembolün üyesi (yöntem, alan, enum üyesi). */
export interface SdkMember {
  name: string;
  kind: string;
  signature: string;
  summary: string;
}

/** Dizindeki bir SDK sembolü ve üyeleri. */
export interface SdkSymbol {
  sdk: SdkKind;
  name: string;
  kind: SdkSymbolKind;
  module: string;
  signature: string;
  summary: string;
  members: SdkMember[];
}

/**
 * The whole index as published at `/docs/mcp/index.json`.
 * Fields: `schemaVersion` (contract version), `generatedAt` (ISO-8601 UTC), `commit` (source short sha or "unknown"),
 * `docs` (documentation pages), `symbols` (SDK API symbols).
 */
export interface McpIndex {
  schemaVersion: 1;
  generatedAt: string;
  commit: string;
  docs: DocPage[];
  symbols: SdkSymbol[];
}

/** Index contract version; consumers reject any other value and fall back. */
export const SCHEMA_VERSION = 1 as const;

/** Default location of the published index. */
export const DEFAULT_INDEX_URL = "https://open-play.b4klabs.dev/docs/mcp/index.json";

/** Genel belge sitesinin kökü (mdBook düzeni, scripts/build_docs_site.py). */
export const SITE_ROOT = "https://open-play.b4klabs.dev/docs";
