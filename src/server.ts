/**
 * # open-play-mcp::server
 *
 * **Neden var:** belge ve SDK dizinini MCP araçları, kaynakları ve istemi olarak sunar (DESIGN.md §10.39, MERMAID M258, M259).
 * **Kapsam:** `createServer(index)`; beş araç, belge kaynak şablonu, `integrate_open_play` istemi.
 * **Sahip olduğu tipler:** yok.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { DEFAULT_LIMIT, MAX_LIMIT, rankDocs, rankSymbols, foldText } from "./search.js";
import { DOC_LANGS, DOC_SECTIONS, SDK_KINDS, SITE_ROOT, type DocLang, type DocPage, type McpIndex, type SdkSymbol } from "./types.js";

/** `read_doc` çıktısının üst sınırı (karakter). */
export const READ_DOC_MAX_CHARS = 40000;
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

const INTEGRATION_STEPS: Record<string, string[]> = {
  web: ["Read getting-started/quickstart and sdk/typescript.", "Sign the player in as a guest (auth/guest), then read auth/sessions-and-csrf.", "Use createPlayerClient from the TypeScript SDK; look up exact signatures with get_sdk_symbol."],
  unity: ["Read getting-started/quickstart and sdk/unity.", "Sign the player in as a guest (auth/guest) with PlayerSession.SignInGuestAsync.", "Look up exact C# signatures with get_sdk_symbol (sdk: unity)."],
  server: ["Read getting-started/quickstart and sdk/typescript.", "Use a server key with CrxClient only on your own server (auth/server-verification).", "Read reference/errors and reference/idempotency-and-concurrency before writing data."],
};

/**
 * Dizinden bir MCP sunucusu kurar (taşıma bağlamaz).
 *
 * # Parametreler
 * - `index: McpIndex` — belge ve SDK dizini
 *
 * # Dönüş
 * - `McpServer` — araçları, kaynak şablonunu ve istemi kayıtlı sunucu; çağıran `connect` eder
 */
export function createServer(index: McpIndex): McpServer {
  const server = new McpServer({ name: "open-play-mcp", version: "0.2.0" }, { instructions: `Open Play developer documentation and SDK API. Start with search_docs; read pages with read_doc. Public site: ${SITE_ROOT}/` });

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
      const lines = hits.map((h, i) => `${i + 1}. ${h.page.title} (${h.page.id})\n   ${h.page.description}\n   ${h.page.url}`);
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
      const header = `# ${found.title}\nURL: ${found.url}\n\n`;
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
      description: "Step-by-step plan to integrate a game with Open Play (web, unity or server), with links to the right docs.",
      argsSchema: { platform: z.enum(["web", "unity", "server"]).optional().describe("Target platform; default web.") },
    },
    ({ platform }) => {
      const steps = INTEGRATION_STEPS[platform ?? "web"] ?? [];
      const url = (id: string): string => `${SITE_ROOT}/en/${id}.html`;
      const text = [
        `Help me integrate my game with Open Play (${platform ?? "web"}). Use the open-play MCP tools (search_docs, read_doc, search_sdk, get_sdk_symbol) instead of guessing.`,
        ...steps.map((s, i) => `${i + 1}. ${s}`),
        `Start here: ${url("getting-started/quickstart")}`,
        `Auth: ${url("auth/guest")} · Errors: ${url("reference/errors")}`,
      ].join("\n");
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    },
  );

  return server;
}
