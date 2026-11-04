/**
 * # open-play-mcp::build::docs
 *
 * **Neden var:** `docs/developer/{tr,en}/**` markdown sayfalarını arama dizinine çevirir (DESIGN.md §10.39).
 * **Kapsam:** front matter ayrıştırma, bölüm türetme, ara başlık çıkarma, genel URL.
 * **Sahip olduğu tipler:** `BuildDocsOptions`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { DOC_LANGS, DOC_SECTIONS, SITE_ROOT, type DocLang, type DocPage, type DocSection } from "../types.js";

/** Belge dizini seçenekleri. `sections`: izinli bölümler (varsayılan hepsi). */
export interface BuildDocsOptions {
  sections?: readonly string[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Başı `---` ile çevrili basit `anahtar: değer` front matter'ı ayırır. */
export function splitFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    let value = line.slice(i + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    meta[line.slice(0, i).trim()] = value;
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n+/, "") };
}

/** `##` ve `###` başlıklarını (kod blokları dışında) sırayla çıkarır. */
export function extractHeadings(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{2,3}\s+(.+?)\s*#*$/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Belge ağacından sayfa dizini üretir.
 *
 * **Neden yazıldı:** MCP araçları yalnız bu dizini okur; çalışma zamanında dosya sistemi ya da ağ yoktur.
 * **Kullanım:** `scripts/build-index.mjs` derleme sırasında çağırır.
 *
 * # Parametreler
 * - `docsRoot: string` — `docs/developer` dizini (altında `tr/` ve `en/`)
 * - `options: BuildDocsOptions` — izinli bölüm kümesi
 *
 * # Dönüş
 * - `DocPage[]` — dile ve kimliğe göre sıralı sayfalar
 *
 * # Hatalar
 * - bilinmeyen bölüm ya da eksik `title` içeren sayfa `Error` fırlatır (sessiz geçilmez)
 */
export function buildDocsIndex(docsRoot: string, options: BuildDocsOptions = {}): DocPage[] {
  const allowed: readonly string[] = options.sections ?? DOC_SECTIONS;
  const pages: DocPage[] = [];
  for (const lang of DOC_LANGS) {
    const langRoot = join(docsRoot, lang);
    for (const file of walk(langRoot)) {
      const rel = relative(langRoot, file).split(sep).join("/");
      if (rel === "README.md") continue;
      const { meta, body } = splitFrontMatter(readFileSync(file, "utf8"));
      const id = meta["id"] ?? rel.replace(/\.md$/, "");
      const section = id.split("/")[0] ?? "";
      if (!allowed.includes(section)) throw new Error(`bilinmeyen bölüm "${section}": ${rel}`);
      const title = meta["title"];
      if (!title) throw new Error(`title eksik: ${rel}`);
      pages.push({
        id,
        lang: lang as DocLang,
        title,
        description: meta["description"] ?? "",
        section: section as DocSection,
        url: `${SITE_ROOT}/${lang}/${id}.html`,
        headings: extractHeadings(body),
        body,
      });
    }
  }
  return pages.sort((a, b) => (a.lang === b.lang ? a.id.localeCompare(b.id) : a.lang.localeCompare(b.lang)));
}
