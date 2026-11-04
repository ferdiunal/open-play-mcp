/**
 * # open-play-mcp::build::typescript
 *
 * **Neden var:** `typedoc --json` çıktısını düz, küçük bir sembol listesine indirir (DESIGN.md §10.39).
 * **Kapsam:** dışa açık sınıf/arayüz/tür/fonksiyon/enum/değişken ve üyeleri; imza metni; modül adı eşlemesi.
 * **Sahip olduğu tipler:** yok (yalnız yardımcılar).
 */
import type { SdkMember, SdkSymbol, SdkSymbolKind } from "../types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** TypeDoc `ReflectionKind` sayıları. */
const TOP_KINDS: Record<number, SdkSymbolKind> = {
  4: "namespace",
  8: "enum",
  32: "variable",
  64: "function",
  128: "class",
  256: "interface",
  2097152: "type",
};

const MEMBER_KIND_NAMES: Record<number, string> = {
  16: "enum-member",
  512: "constructor",
  1024: "property",
  2048: "method",
  262144: "accessor",
};

/** TypeDoc modül adını yayımlanan paket yoluna eşler (`typescript/src/player` → `…/player`). */
function moduleName(raw: string): string {
  const parts = raw.split("/");
  const [pkg, , ...rest] = parts;
  const base = pkg === "typescript" ? "@ferdiunal/open-play-ts" : pkg === "panel-kit" ? "@open-play/panel-kit" : (pkg ?? raw);
  return rest.length > 0 ? `${base}/${rest.join("/")}` : base;
}

function summaryOf(node: Json): string {
  const parts: Json[] = node?.comment?.summary ?? [];
  return parts
    .map((p) => String(p.text ?? ""))
    .join("")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** TypeDoc tür düğümünü TypeScript söz dizimine benzer metne çevirir; tanınmayan düğüm `unknown` olur. */
export function renderType(t: Json): string {
  if (!t) return "unknown";
  switch (t.type) {
    case "intrinsic":
      return t.name;
    case "literal":
      return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
    case "reference": {
      const args: Json[] = t.typeArguments ?? [];
      return args.length > 0 ? `${t.name}<${args.map(renderType).join(", ")}>` : t.name;
    }
    case "array":
      return `${renderType(t.elementType)}[]`;
    case "union":
      return (t.types as Json[]).map(renderType).join(" | ");
    case "intersection":
      return (t.types as Json[]).map(renderType).join(" & ");
    case "tuple":
      return `[${((t.elements ?? []) as Json[]).map(renderType).join(", ")}]`;
    case "typeOperator":
      return `${t.operator} ${renderType(t.target)}`;
    case "indexedAccess":
      return `${renderType(t.objectType)}[${renderType(t.indexType)}]`;
    case "reflection": {
      const sig = t.declaration?.signatures?.[0];
      if (sig) return `(${renderParams(sig.parameters)}) => ${renderType(sig.type)}`;
      return "{ … }";
    }
    default:
      return "unknown";
  }
}

function renderParams(params: Json[] | undefined): string {
  return (params ?? [])
    .map((p) => `${p.name}${p.flags?.isOptional ? "?" : ""}: ${renderType(p.type)}`)
    .join(", ");
}

function signatureOf(name: string, sig: Json): string {
  return `${name}(${renderParams(sig.parameters)}): ${renderType(sig.type)}`;
}

function memberOf(child: Json): SdkMember | null {
  if (child.flags?.isPrivate || child.flags?.isProtected) return null;
  const kindName = MEMBER_KIND_NAMES[child.kind as number];
  if (!kindName) return null;
  const sig = child.signatures?.[0];
  if (sig) {
    const nm = kindName === "constructor" ? "constructor" : child.name;
    return { name: child.name, kind: kindName, signature: signatureOf(nm, sig), summary: summaryOf(sig) || summaryOf(child) };
  }
  const optional = child.flags?.isOptional ? "?" : "";
  const value = child.kind === 16 ? String(child.type?.value ?? "") : renderType(child.type);
  const signature = child.kind === 16 ? `${child.name} = ${JSON.stringify(child.type?.value ?? "")}` : `${child.name}${optional}: ${value}`;
  return { name: child.name, kind: kindName, signature, summary: summaryOf(child) };
}

function topSignature(kind: SdkSymbolKind, child: Json): string {
  if (kind === "function") {
    const sig = child.signatures?.[0];
    return sig ? signatureOf(child.name, sig) : child.name;
  }
  if (kind === "type") return `type ${child.name} = ${renderType(child.type)}`;
  if (kind === "variable") return `const ${child.name}: ${renderType(child.type)}`;
  return `${kind} ${child.name}`;
}

/**
 * `typedoc --json` kökünden sembol listesi üretir.
 *
 * # Parametreler
 * - `root: object` — typedoc JSON kökü; `children` modüllerdir (`entryPointStrategy: resolve`)
 *
 * # Dönüş
 * - `SdkSymbol[]` — yeniden dışa aktarımlar (`Reference`) ve özel/korumalı üyeler atlanmış semboller
 */
export function typedocToSymbols(root: Json): SdkSymbol[] {
  const out: SdkSymbol[] = [];
  for (const mod of (root.children ?? []) as Json[]) {
    const module = moduleName(String(mod.name));
    for (const child of (mod.children ?? []) as Json[]) {
      const kind = TOP_KINDS[child.kind as number];
      if (!kind) continue;
      const members = ((child.children ?? []) as Json[]).map(memberOf).filter((m): m is SdkMember => m !== null);
      const summary = summaryOf(child) || summaryOf(child.signatures?.[0]);
      out.push({ sdk: "typescript", name: child.name, kind, module, signature: topSignature(kind, child), summary, members });
    }
  }
  return out;
}
