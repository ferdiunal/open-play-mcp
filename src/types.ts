/**
 * # open-play-mcp::types
 *
 * **Neden var:** dizin biçimi ve sınırlı değer kümeleri tek yerde tanımlanır; sunucu, arama ve
 * dizin üreticisi aynı tipleri kullanır. Serbest metinle enum karşılaştırması yapılmaz.
 * **Kapsam:** `DocLang`, `SdkKind`, `DocSection`, `SdkSymbolKind` kümeleri; `DocPage`, `PanelMeta`, `SdkMember`, `SdkSymbol`,
 * `ApiEndpoint`, `EndpointHeader`, `ApiError`, `McpIndex` biçimleri.
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

/**
 * Panel page navigation (only on `panel/*` pages of a newer index).
 * Fields: `route` (hash route, e.g. `#/settings/api-keys`), `kind` (`page`, `tab`, `sub-screen`, `plugin`), `area` (sidebar area
 * key; `server` = "Server (all games)", platform operator screens), `menu` (sidebar path in English and Turkish labels; a
 * sub-screen carries its parent's path), `capability` (panel capability needed to see the page), `roles` (only these panel roles
 * see it), `realms` (only in these realms), `inMenu: false` (not in the sidebar).
 */
export interface PanelMeta {
  route: string;
  kind?: string;
  area?: string;
  menu?: { en: string[]; tr: string[] };
  capability?: string;
  roles?: string[];
  realms?: string[];
  inMenu?: false;
}

/** Dizindeki bir belge sayfası. Alanlar: kimlik, dil, başlık, açıklama, bölüm, genel URL, ara başlıklar, markdown gövdesi, panel sayfasında `panel`. */
export interface DocPage {
  id: string;
  lang: DocLang;
  title: string;
  description: string;
  section: DocSection;
  url: string;
  headings: string[];
  body: string;
  panel?: PanelMeta;
}

/** A request header an endpoint expects; `note` explains a conditional requirement. */
export interface EndpointHeader {
  name: string;
  required: boolean;
  note?: string;
}

/**
 * One REST endpoint from the index `endpoints` section (built from the generated endpoint reference, optionally enriched with
 * the curated OpenAPI). `auth` is the credential label ("Server key", "Player session", ...); `summary` is in Turkish at the source.
 */
export interface ApiEndpoint {
  method: string;
  path: string;
  module: string;
  group: string;
  auth: string;
  headers: EndpointHeader[];
  summary: string;
  operationId?: string;
  security?: string[];
}

/** One error code from the index `errors` section (tables of `reference/errors`). `code` is a machine code or an HTTP status. */
export interface ApiError {
  lang: DocLang;
  code: string;
  status?: number;
  family: string;
  meaning: string;
  page: string;
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
 * `docs` (documentation pages), `symbols` (SDK API symbols), `endpoints` and `errors` (absent in indexes built before
 * open-play-mcp 0.3.0; tools then say so instead of failing).
 */
export interface McpIndex {
  schemaVersion: 1;
  generatedAt: string;
  commit: string;
  docs: DocPage[];
  symbols: SdkSymbol[];
  endpoints?: ApiEndpoint[];
  errors?: ApiError[];
}

/** Index contract version; consumers reject any other value and fall back. */
export const SCHEMA_VERSION = 1 as const;

/** Default location of the published index. */
export const DEFAULT_INDEX_URL = "https://open-play.b4klabs.dev/docs/mcp/index.json";

/** Genel belge sitesinin kökü (mdBook düzeni, scripts/build_docs_site.py). */
export const SITE_ROOT = "https://open-play.b4klabs.dev/docs";
