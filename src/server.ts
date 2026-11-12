/**
 * # open-play-mcp::server
 *
 * **Neden var:** belge ve SDK dizinini MCP araçları, kaynakları ve istemi olarak sunar.
 * **Kapsam:** `createServer(index, meta)`; sekiz araç (belge, SDK, uç, hata, dizin bilgisi), belge kaynak şablonu, `integrate_open_play` istemi.
 * **Sahip olduğu tipler:** `IndexMeta`.
 *
 * Every tool only reads the in-memory index. No tool takes a URL to fetch: `get_endpoint` matches the given path as text.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { integrationPrompt, PLATFORM_SCENARIO, SCENARIOS, scenarioFor } from "./integration.js";
import type { IndexSource } from "./load-index.js";
import { findEndpoints, findErrors, formatEndpoint, formatError } from "./reference.js";
import { DEFAULT_LIMIT, MAX_LIMIT, rankDocs, rankSymbols, foldText } from "./search.js";
import { DEFAULT_INDEX_URL, DOC_LANGS, DOC_SECTIONS, SDK_KINDS, SITE_ROOT, type DocLang, type DocPage, type McpIndex, type SdkSymbol } from "./types.js";

/** Server version reported to MCP clients. */
export const SERVER_VERSION = "0.3.0";

/** `read_doc` çıktısının üst sınırı (karakter). */
export const READ_DOC_MAX_CHARS = 40000;

/** Where the served index came from: `source` (network, cache, snapshot, file) and the index URL for network/cache. */
export interface IndexMeta {
  source?: IndexSource;
  url?: string;
}
const MEMBER_LIST_MAX = 80;
const RESOURCE_SCHEME = "open-play-docs";

const langSchema = z.enum(DOC_LANGS).default("en").describe('Documentation language: "en" (default) or "tr" (the Turkish source).');
const limitSchema = z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe(`Maximum number of results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function findPage(index: McpIndex, lang: DocLang, page: string): DocPage | undefined {
  const id = page.replace(/^\/+/, "").replace(/\.(md|html)$/, "");
  return index.docs.find((d) => d.lang === lang && d.id === id);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Bulunamayan sayfa kimliği için en çok 5 öneri: önce arama isabetleri, sonra düzenleme uzaklığı en küçük kimlikler. */
function suggestIds(index: McpIndex, lang: DocLang, page: string): string[] {
  const out = rankDocs(index, { query: page.replace(/[/_-]+/g, " "), lang, limit: 5 }).map((h) => h.page.id);
  const near = index.docs
    .filter((d) => d.lang === lang && !out.includes(d.id))
    .map((d) => ({ id: d.id, dist: editDistance(foldText(d.id), foldText(page)) }))
    .filter((c) => c.dist <= Math.max(3, Math.floor(page.length / 3)))
    .sort((x, y) => x.dist - y.dist || x.id.localeCompare(y.id));
  return [...out, ...near.map((c) => c.id)].slice(0, 5);
}

function describeSymbol(s: SdkSymbol): string {
  const lines = [`${s.name} (${s.kind}, ${s.sdk}, ${s.module})`, `Signature: ${s.signature}`];
  if (s.summary) lines.push(`Summary: ${s.summary}`);
  if (s.members.length > 0) {
    lines.push("Members:");
    for (const m of s.members.slice(0, MEMBER_LIST_MAX)) lines.push(`- ${m.signature}${m.summary ? ` — ${m.summary}` : ""}`);
    if (s.members.length > MEMBER_LIST_MAX) lines.push(`… ${s.members.length - MEMBER_LIST_MAX} more members`);
  }
  return lines.join("\n");
}

function findSymbol(index: McpIndex, sdk: string, name: string): { symbol: SdkSymbol; member?: string } | undefined {
  const pool = index.symbols.filter((s) => s.sdk === sdk);
  const exact = pool.find((s) => s.name === name) ?? pool.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (exact) return { symbol: exact };
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const owner = findSymbol(index, sdk, name.slice(0, dot));
    const memberName = name.slice(dot + 1);
    const member = owner?.symbol.members.find((m) => m.name.toLowerCase() === memberName.toLowerCase());
    if (owner && member) return { symbol: owner.symbol, member: member.name };
  }
  return undefined;
}

/**
 * One line telling where a panel page is and who sees it, e.g.
 * `Panel: Settings › Game settings › API keys (TR UI: Ayarlar › Oyun ayarları › API anahtarları) · route #/settings/api-keys · needs panel capability api_keys_read`.
 */
export function panelLine(page: DocPage): string | undefined {
  const p = page.panel;
  if (!p || typeof p.route !== "string") return undefined;
  const parts: string[] = [];
  if (p.menu && Array.isArray(p.menu.en) && Array.isArray(p.menu.tr)) {
    const [own, other, otherLang] = page.lang === "tr" ? [p.menu.tr, p.menu.en, "EN"] : [p.menu.en, p.menu.tr, "TR"];
    const where = `${own.join(" › ")} (${otherLang} UI: ${other.join(" › ")})`;
    parts.push(p.kind === "sub-screen" || p.kind === "plugin" ? `opened from ${where}` : where);
  }
  parts.push(`route ${p.route}`);
  if (p.capability) parts.push(`needs panel capability ${p.capability}`);
  if (p.roles?.length) parts.push(`only for roles ${p.roles.join(", ")}`);
  if (p.realms?.length) parts.push(`only in the ${p.realms.join("/")} realm`);
  if (p.inMenu === false) parts.push("not in the sidebar");
  return `Panel: ${parts.join(" · ")}`;
}

const SOURCE_LABEL: Record<IndexSource, string> = { network: "live site", cache: "disk cache", snapshot: "snapshot bundled with this server", file: "local file (--index)" };

function ageText(generatedAt: string): string {
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return "unknown age";
  const days = (Date.now() - t) / 86_400_000;
  return days < 1 ? `${Math.max(0, Math.round(days * 24))} h old` : `${days.toFixed(1)} days old`;
}

const OLD_INDEX = (index: McpIndex, what: string, page: string): string =>
  `This docs index (commit ${index.commit}, generated ${index.generatedAt}) has no ${what} table; it was built before that data was added to the index. Read the "${page}" page with read_doc instead, or call index_info.`;

/**
 * Dizinden bir MCP sunucusu kurar (taşıma bağlamaz).
 *
 * # Parametreler
 * - `index: McpIndex` — belge ve SDK dizini
 *
 * # Dönüş
 * - `McpServer` — araçları, kaynak şablonunu ve istemi kayıtlı sunucu; çağıran `connect` eder
 */
export function createServer(index: McpIndex, meta: IndexMeta = {}): McpServer {
  const server = new McpServer(
    { name: "open-play-mcp", version: SERVER_VERSION },
    {
      instructions:
        "Open Play developer documentation, SDK API, REST endpoint table and error codes. Start with search_docs and read pages with read_doc " +
        "(panel pages also show the menu path, route and required panel capability). Use get_endpoint for the credentials and headers of a REST call " +
        "and get_error for an error code. Call index_info to see how fresh the index is (source commit and build time). " +
        `The integrate_open_play prompt has scenarios: ${SCENARIOS.join(", ")}. Public site: ${SITE_ROOT}/`,
    },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search Open Play docs",
      description: "Searches the official Open Play developer documentation (guest sign-in, player data, plugins, realtime, store, panel...). Returns the best matching pages with a short description and the public URL. Follow up with read_doc.",
      inputSchema: { query: z.string().min(1).describe("Search words, e.g. 'guest sign in' or 'save player data'."), lang: langSchema, limit: limitSchema },
    },
    async ({ query, lang, limit }) => {
      const hits = rankDocs(index, { query, lang, limit });
      if (hits.length === 0) return ok(`No pages matched "${query}" in ${lang}. Try other words or call list_docs.`);
      const lines = hits.map((h, i) => {
        const panel = panelLine(h.page);
        return `${i + 1}. ${h.page.title} (${h.page.id})\n   ${h.page.description}${panel ? `\n   ${panel}` : ""}\n   ${h.page.url}`;
      });
      return ok(lines.join("\n"));
    },
  );

  server.registerTool(
    "read_doc",
    {
      title: "Read an Open Play doc page",
      description: `Returns the full markdown of one documentation page by its id (for example "auth/guest" or "guides/player-data"; ids come from search_docs or list_docs). Output is cut at ${READ_DOC_MAX_CHARS} characters with a link to the full page.`,
      inputSchema: { page: z.string().min(1).describe("Page id such as 'auth/guest'."), lang: langSchema },
    },
    async ({ page, lang }) => {
      const found = findPage(index, lang, page);
      if (!found) {
        const hints = suggestIds(index, lang, page);
        return fail(`No page "${page}" in ${lang}.${hints.length > 0 ? ` Did you mean: ${hints.join(", ")}?` : ""} Call list_docs for all ids.`);
      }
      const panel = panelLine(found);
      const header = `# ${found.title}\nURL: ${found.url}\n${panel ? `${panel}\n` : ""}\n`;
      if (found.body.length <= READ_DOC_MAX_CHARS) return ok(header + found.body);
      return ok(`${header}${found.body.slice(0, READ_DOC_MAX_CHARS)}\n\n[truncated; full page: ${found.url}]`);
    },
  );

  server.registerTool(
    "list_docs",
    {
      title: "List Open Play doc pages",
      description: `Lists documentation page ids and titles, optionally for one section (${DOC_SECTIONS.join(", ")}).`,
      inputSchema: { section: z.enum(DOC_SECTIONS).optional().describe("Only this section."), lang: langSchema },
    },
    async ({ section, lang }) => {
      const pages = index.docs.filter((d) => d.lang === lang && (section === undefined || d.section === section));
      if (pages.length === 0) return ok(`No pages in ${lang}${section ? ` / ${section}` : ""}.`);
      const lines: string[] = [];
      let current = "";
      for (const p of pages) {
        if (p.section !== current) {
          current = p.section;
          lines.push(`## ${current}`);
        }
        lines.push(`- ${p.id} — ${p.title}`);
      }
      return ok(lines.join("\n"));
    },
  );

  server.registerTool(
    "search_sdk",
    {
      title: "Search the Open Play SDK API",
      description: "Searches the public API of the TypeScript SDK (@ferdiunal/open-play-ts) and the Unity C# SDK by symbol name, member name, signature and summary. Returns matching types/functions; use get_sdk_symbol for full details.",
      inputSchema: { query: z.string().min(1).describe("Symbol or member words, e.g. 'signInGuest' or 'PlayerSession'."), sdk: z.enum(SDK_KINDS).optional().describe("Only this SDK; default both."), limit: limitSchema },
    },
    async ({ query, sdk, limit }) => {
      const hits = rankSymbols(index, { query, sdk, limit });
      if (hits.length === 0) return ok(`No SDK symbol matched "${query}".`);
      return ok(hits.map((h, i) => `${i + 1}. ${h.symbol.name} (${h.symbol.kind}, ${h.symbol.sdk}, ${h.symbol.module})\n   ${h.symbol.signature}${h.symbol.summary ? `\n   ${h.symbol.summary}` : ""}`).join("\n"));
    },
  );

  server.registerTool(
    "get_sdk_symbol",
    {
      title: "Get one SDK symbol",
      description: "Returns one SDK type or function with its signature, summary and members. The name is matched exactly (case-insensitive); a member can be addressed as 'Type.Member'.",
      inputSchema: { name: z.string().min(1).describe("Symbol name, e.g. 'CrxClient' or 'PlayerSession.SignInGuestAsync'."), sdk: z.enum(SDK_KINDS).describe("Which SDK to look in.") },
    },
    async ({ name, sdk }) => {
      const found = findSymbol(index, sdk, name);
      if (!found) {
        const hints = rankSymbols(index, { query: name, sdk, limit: 5 }).map((h) => h.symbol.name);
        return fail(`No ${sdk} symbol "${name}".${hints.length > 0 ? ` Did you mean: ${hints.join(", ")}?` : ""}`);
      }
      if (found.member) {
        const m = found.symbol.members.find((x) => x.name === found.member);
        return ok(`${found.symbol.name}.${found.member} (${m?.kind ?? "member"}, ${sdk}, ${found.symbol.module})\nSignature: ${m?.signature ?? ""}${m?.summary ? `\nSummary: ${m.summary}` : ""}`);
      }
      return ok(describeSymbol(found.symbol));
    },
  );

  server.registerTool(
    "index_info",
    {
      title: "About the Open Play docs index",
      description: "Tells how fresh the documentation index behind these tools is: source commit, build time and age, where it was loaded from, and how many pages, SDK symbols, endpoints and error codes it holds. Call it when an answer looks outdated.",
      inputSchema: {},
    },
    async () => {
      const count = (lang: DocLang): number => index.docs.filter((d) => d.lang === lang).length;
      const ts = index.symbols.filter((s) => s.sdk === "typescript").length;
      const panel = index.docs.filter((d) => d.panel?.menu).length;
      const lines = [
        `Commit: ${index.commit}`,
        `Generated: ${index.generatedAt} (${ageText(index.generatedAt)})`,
        `Loaded from: ${meta.source ? SOURCE_LABEL[meta.source] : "unknown"}${meta.url && meta.source !== "file" ? ` — ${meta.url}` : ""}`,
        `Published index: ${DEFAULT_INDEX_URL} (rebuilt with every docs release)`,
        `Pages: ${index.docs.length} (en ${count("en")}, tr ${count("tr")}); panel pages with menu paths: ${panel}`,
        `SDK symbols: ${ts} TypeScript, ${index.symbols.length - ts} Unity`,
        index.endpoints ? `Endpoints: ${index.endpoints.length} (${index.endpoints.filter((e) => e.operationId).length} with an OpenAPI operationId)` : "Endpoints: not in this index (built before endpoint data was added)",
        index.errors ? `Error codes: ${index.errors.filter((e) => e.lang === "en").length} (en), ${index.errors.filter((e) => e.lang === "tr").length} (tr)` : "Error codes: not in this index (built before error data was added)",
        `Server: open-play-mcp ${SERVER_VERSION}`,
      ];
      return ok(lines.join("\n"));
    },
  );

  server.registerTool(
    "get_endpoint",
    {
      title: "Look up an Open Play REST endpoint",
      description:
        "Returns the credentials (server key, client key, player session...), required headers (Idempotency-Key, If-Match, x-crx-env, x-csrf-token) and summary of a REST endpoint. " +
        "The path may be a template ('/v1/leaderboards/{key}/scores'), a concrete path ('/v1/leaderboards/weekly/scores') or a full URL; it is matched as text, never fetched.",
      inputSchema: {
        path: z.string().min(1).max(500).describe("Endpoint path, e.g. '/v1/leaderboards/{key}/scores' or 'POST /v1/transfers'."),
        method: z.string().regex(/^[A-Za-z]{3,7}$/).optional().describe("HTTP method (GET, POST, PUT, PATCH, DELETE); default all methods of the path."),
      },
    },
    async ({ path, method }) => {
      if (!index.endpoints) return ok(OLD_INDEX(index, "endpoint", "reference/endpoints"));
      const found = findEndpoints(index.endpoints, path, method);
      const reference = `Reference: ${SITE_ROOT}/en/reference/endpoints.html`;
      if (found.matches.length > 0) return ok([...found.matches.map(formatEndpoint), reference].join("\n\n"));
      if (found.otherMethods.length > 0) return fail(`No ${(method ?? path.split(/\s+/)[0] ?? "").toUpperCase()} endpoint at "${path}"; that path has: ${found.otherMethods.join(", ")}.`);
      const hints = found.suggestions.map((e) => `${e.method} ${e.path}`);
      return fail(`No endpoint matches "${path}".${hints.length > 0 ? ` Closest: ${hints.join("; ")}.` : ""} Plugin endpoints (/v1/plugins/...) are described by each plugin's schema; see read_doc plugins/calling-plugins.`);
    },
  );

  server.registerTool(
    "get_error",
    {
      title: "Explain an Open Play error code",
      description: "Explains an error code from the error reference: a machine code such as 'module_disabled', 'idempotency_in_flight', 'out_of_stock', or an HTTP status such as '409' (also lists machine codes sent with that status). Says when to retry.",
      inputSchema: { code: z.string().min(1).max(100).describe("Error code or HTTP status, e.g. 'module_disabled' or '429'."), lang: langSchema },
    },
    async ({ code, lang }) => {
      if (!index.errors) return ok(OLD_INDEX(index, "error code", "reference/errors"));
      const found = findErrors(index.errors, code, lang);
      const source = `Source: ${SITE_ROOT}/${lang}/reference/errors.html`;
      if (found.matches.length > 0 || found.sameStatus.length > 0) {
        const parts = found.matches.map(formatError);
        if (found.sameStatus.length > 0) parts.push(`Machine codes sent with HTTP ${found.code}:\n${found.sameStatus.map((e) => `- ${formatError(e)}`).join("\n")}`);
        return ok([...parts, source].join("\n\n"));
      }
      return fail(
        `No documented error code "${found.code}" in ${lang}.${found.suggestions.length > 0 ? ` Did you mean: ${found.suggestions.join(", ")}?` : ""} ` +
          "Codes of single features (player data, store, realtime, plugins) may be on their own pages: try search_docs with the code.",
      );
    },
  );

  server.registerResource(
    "docs",
    new ResourceTemplate(`${RESOURCE_SCHEME}://{lang}/{+page}`, {
      list: async () => ({
        resources: index.docs.map((d) => ({ uri: `${RESOURCE_SCHEME}://${d.lang}/${d.id}`, name: `${d.lang}/${d.id}`, title: d.title, description: d.description, mimeType: "text/markdown" })),
      }),
    }),
    { title: "Open Play documentation page", description: "One documentation page as markdown.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const lang = String(variables["lang"]);
      const page = String(variables["page"]);
      const found = (DOC_LANGS as readonly string[]).includes(lang) ? findPage(index, lang as DocLang, page) : undefined;
      if (!found) throw new Error(`Resource not found: ${uri.href}`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: found.body }] };
    },
  );

  server.registerPrompt(
    "integrate_open_play",
    {
      title: "Integrate Open Play",
      description:
        "Step-by-step plan to integrate a game with Open Play for one scenario, with the panel checklist for a person and the doc pages to read. " +
        "Scenarios: web-direct (web game on its own domain, SDK token mode), web-bff (static game + backend holding the server key), " +
        "second-game (add a game to an existing studio), unity, server.",
      argsSchema: {
        scenario: z.enum(SCENARIOS).optional().describe(`Integration scenario: ${SCENARIOS.join(", ")}. Default: from platform, else web-direct.`),
        platform: z.enum(Object.keys(PLATFORM_SCENARIO) as ["web", "unity", "server"]).optional().describe("Older argument: web (= web-direct), unity or server. Ignored when scenario is set."),
      },
    },
    ({ scenario, platform }) => {
      const text = integrationPrompt(index, scenarioFor(scenario, platform));
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    },
  );

  return server;
}
