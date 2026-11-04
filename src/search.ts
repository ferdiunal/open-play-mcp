/**
 * # open-play-mcp::search
 *
 * **Neden var:** deterministik, gömmesiz arama (DESIGN.md §10.39): başlık > ara başlık > gövde; SDK'da ad > imza > özet.
 * **Kapsam:** Türkçe harf katlama, sözcük bölme, belge ve sembol puanlama.
 * **Sahip olduğu tipler:** `DocQuery`, `SymbolQuery`, `DocHit`, `SymbolHit`.
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

function countOccurrences(haystack: string, needle: string, cap: number): number {
  let n = 0;
  let from = 0;
  while (n < cap) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    n++;
    from = i + needle.length;
  }
  return n;
}

const BODY_CAP = 5;

function scoreDoc(page: DocPage, terms: string[], phrase: string): number {
  const title = foldText(page.title);
  const desc = foldText(page.description);
  const heads = foldText(page.headings.join("\n"));
  const body = foldText(page.body);
  let score = 0;
  for (const t of terms) {
    if (title.includes(t)) score += 10;
    if (desc.includes(t)) score += 4;
    if (heads.includes(t)) score += 5;
    score += countOccurrences(body, t, BODY_CAP);
  }
  if (score > 0 && phrase.length > 0 && title.includes(phrase)) score += 20;
  return score;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Belge sayfalarını puanlar; puanı 0 olanlar elenir, eşit puanda kimlik sırası uygulanır. */
export function rankDocs(index: McpIndex, q: DocQuery): DocHit[] {
  const terms = tokenize(q.query);
  if (terms.length === 0) return [];
  const phrase = terms.join(" ");
  return index.docs
    .filter((d) => d.lang === q.lang)
    .map((page) => ({ page, score: scoreDoc(page, terms, phrase) }))
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
