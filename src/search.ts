/**
 * # open-play-mcp::search
 *
 * **Neden var:** deterministik, gömmesiz arama: başlık > ara başlık > gövde; SDK'da ad > imza > özet.
 * **Kapsam:** Türkçe harf katlama, sözcük bölme, durak sözcükleri (EN+TR), küçük EN↔TR eş anlamlı haritası, belge ve sembol puanlama.
 * **Sahip olduğu tipler:** `DocQuery`, `SymbolQuery`, `DocHit`, `SymbolHit`.
 *
 * Document matching works on whole tokens: a query token shorter than 4 characters must equal a page token or its plural ("in"
 * does not hit "index", "new" does not hit "renew", "key" hits "keys"); a longer one matches a page token that starts with it, so Turkish suffixes still match
 * ("kimliği" → "kimliğini", "oyun" → "oyunlar"). Each query concept (a word, or a phrase from the synonym map with all its
 * alternatives) scores once per field, and pages that cover more of the query's concepts rank higher.
 */
import type { DocLang, DocPage, McpIndex, SdkKind, SdkSymbol } from "./types.js";

/** Varsayılan ve üst sonuç sayıları. */
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

/** Belge araması girdisi. */
export interface DocQuery {
  query: string;
  lang: DocLang;
  limit: number;
}
/** SDK araması girdisi. `sdk` yoksa ikisi de aranır. */
export interface SymbolQuery {
  query: string;
  sdk?: SdkKind;
  limit: number;
}
/** Puanlı belge sonucu. */
export interface DocHit {
  page: DocPage;
  score: number;
}
/** Puanlı sembol sonucu. */
export interface SymbolHit {
  symbol: SdkSymbol;
  score: number;
}

const FOLD: Record<string, string> = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c" };

/** Küçük harfe çevirir ve Türkçe harfleri ASCII karşılığına katlar (`Misafır` → `misafir`). */
export function foldText(text: string): string {
  let out = "";
  for (const ch of text) out += FOLD[ch] ?? ch;
  return out.toLowerCase();
}

/** Katlanmış metni en az 2 karakterli harf/rakam sözcüklerine böler. */
export function tokenize(text: string): string[] {
  return foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/** English and Turkish function words (folded) that never decide a match. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  tokenize(
    "a an the and or of to in on at by for from with without into onto about as is are was were be been being it its this that these those " +
      "there here how do does did i me my we our us you your can could should would will shall may might must what which who whom whose " +
      "where when why not if then than so such via " +
      "ve ile bir bu şu da de mi mı mu mü için ne nasıl nerede neden hangi gibi olarak veya ya ki çok daha en her ama ise değil var yok " +
      "ben biz sen siz benim bizim sizin nedir kadar",
  ),
);

/** Tokens of a text without stopwords (used for both queries and pages). */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

/**
 * Small EN↔TR synonym map: every line is one concept, `|` separates its alternative phrases. A query that contains any
 * alternative is matched against all of them; when a phrase is in several lines, the first line wins ("api key" is its own
 * concept, but a "server key" query also finds the API keys page). Long words are stems on purpose ("anahtar" matches
 * "anahtarı", "anahtarları").
 */
const SYNONYM_SOURCE = [
  "environmentId | environment id | env id | environment uuid | ortam kimlig | ortam uuid | x-crx-env",
  "api key | api anahtar",
  "server key | sunucu anahtar | api key",
  "client key | istemci anahtar | api key",
  "leaderboard | skor tablo | sıralama tablo | scoreboard",
  "trusted origin | allowed origin | origin allowlist | alan adı | alan adlar | cors",
  "new game | yeni oyun | oyun oluştur | create game | add game",
  "studio | stüdyo",
  "player data | oyuncu veri | cloud save | save data | bulut kayıt",
  "guest | misafir",
  "environment | ortam",
  "currency | para birim",
];

const SYNONYMS: string[][][] = SYNONYM_SOURCE.map((line) => line.split("|").map((alt) => contentTokens(alt)).filter((alt) => alt.length > 0));

/** Short tokens must match a whole token (or its plural: "key" → "keys"); longer ones match a token that starts with them. */
const MIN_PREFIX = 4;
function tokenMatches(pageToken: string, term: string): boolean {
  return term.length < MIN_PREFIX ? pageToken === term || pageToken === `${term}s` : pageToken.startsWith(term);
}

/**
 * A query concept: alternative phrases (token lists) and which of them the user actually typed. The typed phrase counts in
 * full; a synonym counts half (it widens recall without outranking pages that use the user's own words).
 */
interface Concept {
  alts: string[][];
  typed: number;
}

/** Weight of a match through a synonym instead of the typed phrase. */
const SYNONYM_WEIGHT = 0.5;

/**
 * Splits a query into concepts: the longest synonym phrase at each position wins, other tokens are concepts of their own.
 *
 * # Returns
 * - `Concept[]` — empty when the query has only stopwords
 */
export function queryConcepts(query: string): Concept[] {
  const tokens = contentTokens(query);
  const out: Concept[] = [];
  for (let i = 0; i < tokens.length; ) {
    let best: { alts: string[][]; typed: number; len: number } | undefined;
    for (const alts of SYNONYMS) {
      alts.forEach((alt, typed) => {
        if (alt.length > tokens.length - i || (best && alt.length <= best.len)) return;
        if (alt.every((t, k) => tokenMatches(tokens[i + k] ?? "", t))) best = { alts, typed, len: alt.length };
      });
    }
    if (best) {
      out.push({ alts: best.alts, typed: best.typed });
      i += best.len;
    } else {
      out.push({ alts: [[tokens[i] ?? ""]], typed: 0 });
      i++;
    }
  }
  return out;
}

interface Prepared {
  title: string[];
  desc: string[];
  heads: string[][];
  body: string[];
  bodyIndex: Map<string, number[]>;
}

const prepared = new WeakMap<DocPage, Prepared>();

/** Tokenizes a page once; the index object is reused across requests, so the cache lives as long as the index. */
function prepare(page: DocPage): Prepared {
  const hit = prepared.get(page);
  if (hit) return hit;
  const menu = page.panel?.menu ? [...page.panel.menu.en, ...page.panel.menu.tr].join(" ") : "";
  const body = contentTokens(page.body);
  const bodyIndex = new Map<string, number[]>();
  body.forEach((t, i) => {
    const list = bodyIndex.get(t);
    if (list) list.push(i);
    else bodyIndex.set(t, [i]);
  });
  const p: Prepared = { title: contentTokens(page.title), desc: contentTokens(`${page.description} ${menu}`), heads: page.headings.map(contentTokens), body, bodyIndex };
  prepared.set(page, p);
  return p;
}

function phraseAt(tokens: string[], at: number, phrase: string[]): boolean {
  return phrase.every((t, k) => tokenMatches(tokens[at + k] ?? "", t));
}

/** 1 when the typed phrase occurs in the tokens, `SYNONYM_WEIGHT` when only a synonym does, else 0. */
function hit(tokens: string[], c: Concept): number {
  let best = 0;
  for (let i = 0; i < tokens.length && best < 1; i++) {
    c.alts.forEach((alt, k) => {
      if (phraseAt(tokens, i, alt)) best = Math.max(best, k === c.typed ? 1 : SYNONYM_WEIGHT);
    });
  }
  return best;
}

/** Body occurrences of the concept (typed phrase 1, synonym `SYNONYM_WEIGHT`), found via the token index, capped. */
function bodyCount(p: Prepared, c: Concept, cap: number): number {
  const starts = new Map<number, number>();
  c.alts.forEach((alt, k) => {
    const first = alt[0] ?? "";
    const value = k === c.typed ? 1 : SYNONYM_WEIGHT;
    const lists = first.length < MIN_PREFIX ? [p.bodyIndex.get(first) ?? [], p.bodyIndex.get(`${first}s`) ?? []] : [...p.bodyIndex].filter(([t]) => t.startsWith(first)).map(([, l]) => l);
    for (const list of lists) for (const at of list) if (phraseAt(p.body, at, alt)) starts.set(at, Math.max(starts.get(at) ?? 0, value));
  });
  let sum = 0;
  for (const v of starts.values()) sum += v;
  return Math.min(sum, cap);
}

const BODY_CAP = 8;

/** Per-concept field hits of one page: `raw` is the unweighted field score (0 = the concept is absent). */
interface PageMatch {
  page: DocPage;
  raw: number[];
  inTitle: number;
  titleCovered: boolean;
  headingAll: boolean;
}

function matchDoc(page: DocPage, concepts: Concept[]): PageMatch {
  const p = prepare(page);
  let inTitle = 0;
  const raw = concepts.map((c) => {
    const t = hit(p.title, c);
    if (t > 0) inTitle++;
    return 10 * t + 4 * hit(p.desc, c) + 5 * Math.max(0, ...p.heads.map((h) => hit(h, c))) + bodyCount(p, c, BODY_CAP);
  });
  // A title made only of query concepts ("API keys" for "API key environment id"): the page is about the query.
  const titleCovered = p.title.length > 0 && p.title.every((tok) => concepts.some((c) => c.alts.some((alt) => alt.some((t) => tokenMatches(tok, t)))));
  // Every concept in one heading: the page has a section on exactly this.
  const headingAll = concepts.length > 1 && p.heads.some((head) => concepts.every((c) => hit(head, c) > 0));
  return { page, raw, inTitle, titleCovered, headingAll };
}

/**
 * Panel screens of the "Server (all games)" area (studios, platform settings) are for platform operators; the people using this
 * server integrate a game, so such pages yield to studio-side pages with a similar score.
 */
const OPERATOR_AREA = "server";
const OPERATOR_AREA_FACTOR = 0.6;

/**
 * Scores a page: each concept's field score is weighted by how rare the concept is among the pages (`log(1 + N/df)`), so a
 * common word ("create") counts less than the specific one ("new game"); title and heading bonuses use the mean weight; the sum
 * is scaled by the share of concepts the page covers.
 */
function scoreMatch(m: PageMatch, weights: number[]): number {
  let score = 0;
  let matched = 0;
  m.raw.forEach((r, i) => {
    if (r > 0) matched++;
    score += r * (weights[i] ?? 1);
  });
  if (matched === 0) return 0;
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  if (m.titleCovered) score += (m.inTitle === m.raw.length ? 30 : 15) * mean;
  if (m.headingAll) score += 8 * mean;
  if (m.page.panel?.area === OPERATOR_AREA) score *= OPERATOR_AREA_FACTOR;
  return Math.round((score * matched * 100) / m.raw.length) / 100;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Belge sayfalarını puanlar; puanı 0 olanlar elenir, eşit puanda kimlik sırası uygulanır. */
export function rankDocs(index: McpIndex, q: DocQuery): DocHit[] {
  const concepts = queryConcepts(q.query);
  if (concepts.length === 0) return [];
  const matches = index.docs.filter((d) => d.lang === q.lang).map((page) => matchDoc(page, concepts));
  const weights = concepts.map((_, i) => Math.log(1 + matches.length / Math.max(1, matches.filter((m) => (m.raw[i] ?? 0) > 0).length)));
  return matches
    .map((m) => ({ page: m.page, score: scoreMatch(m, weights) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.page.id.localeCompare(b.page.id))
    .slice(0, clampLimit(q.limit));
}

function scoreSymbol(s: SdkSymbol, terms: string[], rawQuery: string): number {
  const name = foldText(s.name);
  const sig = foldText(s.signature);
  const summary = foldText(s.summary);
  const memberNames = s.members.map((m) => foldText(m.name));
  const memberText = foldText(s.members.map((m) => `${m.signature} ${m.summary}`).join("\n"));
  let score = 0;
  for (const t of terms) {
    if (name.includes(t)) score += 10;
    if (memberNames.some((m) => m.includes(t))) score += 6;
    if (sig.includes(t)) score += 3;
    if (summary.includes(t)) score += 2;
    if (memberText.includes(t)) score += 1;
  }
  const exact = foldText(rawQuery.trim());
  if (score > 0 && (name === exact || memberNames.includes(exact))) score += 30;
  return score;
}

/** SDK sembollerini puanlar; `sdk` verilmişse yalnız o SDK'ya bakar. */
export function rankSymbols(index: McpIndex, q: SymbolQuery): SymbolHit[] {
  const terms = tokenize(q.query);
  if (terms.length === 0) return [];
  return index.symbols
    .filter((s) => q.sdk === undefined || s.sdk === q.sdk)
    .map((symbol) => ({ symbol, score: scoreSymbol(symbol, terms, q.query) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.name.localeCompare(b.symbol.name) || a.symbol.sdk.localeCompare(b.symbol.sdk))
    .slice(0, clampLimit(q.limit));
}
