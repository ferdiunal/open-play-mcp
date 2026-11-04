/**
 * # open-play-mcp::build::unity
 *
 * **Neden var:** Unity SDK'sının genel API'sini DocFX/.NET olmadan dizine almak (DESIGN.md §10.39, TD-1541).
 * **Kapsam:** C# kaynağında `public` tür ve üye bildirimlerini, bitişik `/// <summary>` metnini çıkaran hafif satır tabanlı ayrıştırıcı.
 * **Sahip olduğu tipler:** yok (yalnız yardımcılar).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SdkMember, SdkSymbol, SdkSymbolKind } from "../types.js";

const SUMMARY_LIMIT = 600;
const TYPE_RE = /^\s*(public)?\s*(?:(?:static|sealed|abstract|partial|readonly|unsafe|internal|private|protected|new)\s+)*(class|struct|interface|enum|record)\s+(\w+)/;
const MODIFIER_RE = /^(?:(?:public|override|virtual|async|abstract|new|unsafe|extern)\s+)+/;

interface Scope {
  kind: "ns" | "type" | "other";
  symbol: SdkSymbol | null;
  isEnum: boolean;
  isInterface: boolean;
}

function stripLiterals(line: string): string {
  return line
    .replace(/@"(?:[^"]|"")*"/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)'/g, "''")
    .replace(/\/\/.*$/, "");
}

function parenBalance(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (ch === "(") n++;
    else if (ch === ")") n--;
  }
  return n;
}

/** XML özet etiketlerini düz metne çevirir (`<see cref="X"/>` → `X`). */
export function cleanSummary(xml: string): string {
  const m = /<summary>([\s\S]*?)<\/summary>/.exec(xml);
  if (!m?.[1]) return "";
  const text = m[1]
    .replace(/<(?:see|seealso)\s+(?:cref|langword)="([^"]*)"\s*\/?>/g, "$1")
    .replace(/<\/?(?:c|b|i|para|code|paramref|typeparamref)[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1)}…` : text;
}

/** Bildirim metnini ilk `{`, `;`, `=>` ya da parantez dışı `=` işaretinde keser. */
function declarationHead(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) {
      if (ch === "{" || ch === ";") return text.slice(0, i).trim();
      if (ch === "=" && text[i + 1] === ">") return text.slice(0, i).trim();
      if (ch === "=" && text[i + 1] !== "=" && text[i - 1] !== "=" && text[i - 1] !== "!") return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

function memberFrom(head: string, typeName: string): SdkMember | null {
  const signature = head.replace(MODIFIER_RE, "").trim();
  if (!signature) return null;
  const paren = signature.indexOf("(");
  if (paren >= 0) {
    const before = signature.slice(0, paren).trim();
    const name = /(\w+)(?:<[^>]*>)?$/.exec(before)?.[1];
    if (!name) return null;
    return { name, kind: name === typeName ? "constructor" : "method", signature, summary: "" };
  }
  const name = /(\w+)$/.exec(signature)?.[1];
  if (!name) return null;
  return { name, kind: signature.startsWith("event ") ? "event" : "property", signature, summary: "" };
}

/**
 * Tek bir C# dosyasının `public` API'sini çıkarır.
 *
 * # Parametreler
 * - `source: string` — dosya metni
 * - `file: string` — yalnız hata iletisi için dosya adı
 *
 * # Dönüş
 * - `SdkSymbol[]` — `public` türler (iç içe türler `Dış.İç` adıyla) ve `public` üyeleri; `internal`/`private` atlanır
 */
export function parseCSharp(source: string, file: string): SdkSymbol[] {
  void file;
  const lines = source.split("\n");
  const out: SdkSymbol[] = [];
  const scopes: Scope[] = [];
  let namespace = "";
  let doc: string[] = [];
  let pending: Scope | null = null;
  let pendingNs = "";

  const top = (): Scope | undefined => scopes[scopes.length - 1];
  const takeDoc = (): string => {
    const s = cleanSummary(doc.join("\n"));
    doc = [];
    return s;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed.startsWith("///")) {
      doc.push(trimmed.slice(3));
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//") || /^\[.*\]$/.test(trimmed) || trimmed.startsWith("#")) continue;

    let line = stripLiterals(raw);
    const nsMatch = /^\s*namespace\s+([\w.]+)/.exec(line);
    const current = top();
    if (nsMatch?.[1]) {
      namespace = nsMatch[1];
      pendingNs = nsMatch[1];
      doc = [];
    } else {
      const tm = TYPE_RE.exec(line);
      if (tm && (current === undefined || current.kind === "ns" || current.kind === "type")) {
        const isPublic = tm[1] === "public";
        const kindWord = tm[2] ?? "class";
        const simple = tm[3] ?? "";
        const parent = current?.kind === "type" ? current.symbol : null;
        const summary = takeDoc();
        let symbol: SdkSymbol | null = null;
        if (isPublic && (current === undefined || current.kind === "ns" || parent !== null)) {
          const kind: SdkSymbolKind = kindWord === "record" ? "class" : (kindWord as SdkSymbolKind);
          symbol = {
            sdk: "unity",
            name: parent ? `${parent.name}.${simple}` : simple,
            kind,
            module: namespace,
            signature: declarationHead(line.replace(/^\s*public\s+/, "")),
            summary,
            members: [],
          };
          out.push(symbol);
        }
        pending = { kind: "type", symbol, isEnum: kindWord === "enum", isInterface: kindWord === "interface" };
        if (symbol && pending.isEnum) {
          const inline = /\{([^{}]*)\}/.exec(line)?.[1];
          if (inline) {
            for (const part of inline.split(",")) {
              const nm = /^\s*(\w+)/.exec(part)?.[1];
              if (nm) symbol.members.push({ name: nm, kind: "enum-member", signature: nm, summary: "" });
            }
          }
        }
      } else if (current?.kind === "type" && current.symbol && !pending) {
        if (current.isEnum) {
          for (const part of line.split(",")) {
            const nm = /^\s*(\w+)\s*(?:=\s*[^,]+)?$/.exec(part)?.[1];
            if (nm && !/^[{}]$/.test(nm)) current.symbol.members.push({ name: nm, kind: "enum-member", signature: nm, summary: takeDoc() });
          }
          doc = [];
        } else {
          const isMember = current.isInterface ? /[(;]|\{\s*get/.test(line) && !trimmed.startsWith("}") : /^\s*public\s/.test(line);
          if (isMember && !/^\s*public\s+(?:\w+\s+)*?(?:class|struct|interface|enum|record)\s/.test(line)) {
            let joined = line;
            let bal = parenBalance(joined);
            while (bal > 0 && i + 1 < lines.length) {
              i++;
              const more = stripLiterals(lines[i] ?? "").trim();
              joined = `${joined} ${more}`;
              bal = parenBalance(joined);
            }
            line = joined;
            const member = memberFrom(declarationHead(line.replace(/\s+/g, " ").trim()), current.symbol.name.split(".").pop() ?? "");
            if (member) {
              member.summary = takeDoc();
              current.symbol.members.push(member);
            }
          }
          doc = [];
        }
      } else {
        doc = [];
      }
    }

    for (const ch of line) {
      if (ch === "{") {
        if (pending) {
          scopes.push(pending);
          pending = null;
        } else if (pendingNs) {
          scopes.push({ kind: "ns", symbol: null, isEnum: false, isInterface: false });
          pendingNs = "";
        } else {
          scopes.push({ kind: "other", symbol: null, isEnum: false, isInterface: false });
        }
      } else if (ch === "}") {
        scopes.pop();
      }
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".cs")) out.push(full);
  }
  return out;
}

/** `sdks/unity/Runtime` altındaki bütün `.cs` dosyalarını ayrıştırıp ad sırasıyla döndürür. */
export function buildUnitySymbols(runtimeRoot: string): SdkSymbol[] {
  const all: SdkSymbol[] = [];
  for (const file of walk(runtimeRoot)) all.push(...parseCSharp(readFileSync(file, "utf8"), file));
  return all.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}
