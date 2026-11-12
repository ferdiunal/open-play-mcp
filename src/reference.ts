/**
 * # open-play-mcp::reference
 *
 * **Neden var:** `get_endpoint` ve `get_error` araçlarının saf arama mantığı; dizinin `endpoints` ve `errors` bölümlerini okur,
 * hiçbir ağ çağrısı yapmaz (verilen yol yalnız metin olarak eşlenir, asla istenmez).
 * **Kapsam:** `normalizePath`, `findEndpoints`, `formatEndpoint`, `normalizeErrorCode`, `findErrors`, `formatError`.
 * **Sahip olduğu tipler:** `EndpointLookup`, `ErrorLookup`.
 */
import type { ApiEndpoint, ApiError, DocLang } from "./types.js";

/** Most endpoints returned by one lookup. */
export const MAX_ENDPOINT_MATCHES = 10;

/** Result of an endpoint lookup: matches (best first), other methods on the same path, suggestions when nothing matched. */
export interface EndpointLookup {
  matches: ApiEndpoint[];
  otherMethods: string[];
  suggestions: ApiEndpoint[];
}

const isParam = (segment: string): boolean => /^\{[^}]*\}$/.test(segment);
const isPlaceholder = (segment: string): boolean => isParam(segment) || /^:[^/]+$/.test(segment) || /^<[^>]+>$/.test(segment);

/**
 * Turns user input into candidate request paths: drops a leading method, scheme and host, query and fragment, a trailing slash,
 * and also tries the part from `/v1/` on (so `https://x.open-play.tech/api/v1/...` and `/api/<slug>/v1/...` both work).
 * Pure string handling; nothing is fetched.
 */
export function normalizePath(raw: string): { method?: string; paths: string[] } {
  let text = raw.trim();
  let method: string | undefined;
  const withMethod = /^(get|post|put|patch|delete|head|options)\s+(\S.*)$/i.exec(text);
  if (withMethod) {
    method = (withMethod[1] ?? "").toUpperCase();
    text = withMethod[2] ?? "";
  }
  let path = text.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "") || "/";
  const paths = [path];
  const v1 = path.indexOf("/v1/");
  if (v1 > 0) paths.push(path.slice(v1));
  return method ? { method, paths } : { paths };
}

/** Literal segments shared with the template when the path fits it (`{param}` takes any one segment), else `undefined`. */
function fit(template: string, path: string): number | undefined {
  const a = template.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return undefined;
  let literal = 0;
  for (let i = 0; i < a.length; i++) {
    const t = a[i] ?? "";
    const p = b[i] ?? "";
    if (isParam(t)) {
      if (p === "") return undefined;
      continue;
    }
    if (isPlaceholder(p) || t.toLowerCase() !== p.toLowerCase()) return undefined;
    literal++;
  }
  return literal;
}

function similarity(template: string, path: string): number {
  const a = template.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  let lead = 0;
  while (lead < Math.min(a.length, b.length) && (a[lead] === b[lead] || isParam(a[lead] ?? "") || isPlaceholder(b[lead] ?? ""))) lead++;
  const shared = b.filter((s) => !isPlaceholder(s) && a.includes(s)).length;
  return lead * 2 + shared - Math.abs(a.length - b.length) * 0.5;
}

/**
 * Finds endpoints for a path (concrete like `/v1/leaderboards/weekly/scores` or a template like `/v1/leaderboards/{key}/scores`).
 *
 * # Parameters
 * - `endpoints: ApiEndpoint[]` — the index `endpoints` section
 * - `path: string` — request path or URL, optionally prefixed with a method (`POST /v1/...`)
 * - `method?: string` — HTTP method filter (case-insensitive); wins over a method inside `path`
 *
 * # Returns
 * - `EndpointLookup` — routes with more literal segments first (a literal route beats a `{param}` route)
 */
export function findEndpoints(endpoints: ApiEndpoint[], path: string, method?: string): EndpointLookup {
  const input = normalizePath(path);
  const wanted = (method ?? input.method)?.toUpperCase();
  const fits: { e: ApiEndpoint; literal: number }[] = [];
  for (const e of endpoints) {
    const literal = Math.max(-1, ...input.paths.map((p) => fit(e.path, p) ?? -1));
    if (literal >= 0) fits.push({ e, literal });
  }
  fits.sort((x, y) => y.literal - x.literal || x.e.path.localeCompare(y.e.path) || x.e.method.localeCompare(y.e.method));
  const best = fits.length > 0 ? (fits[0]?.literal ?? 0) : 0;
  const top = fits.filter((f) => f.literal === best).map((f) => f.e);
  const matches = (wanted ? top.filter((e) => e.method === wanted) : top).slice(0, MAX_ENDPOINT_MATCHES);
  const otherMethods = wanted && matches.length === 0 ? [...new Set(top.map((e) => e.method))] : [];
  const target = input.paths[input.paths.length - 1] ?? "/";
  const suggestions =
    matches.length > 0
      ? []
      : endpoints
          .map((e) => ({ e, s: similarity(e.path, target) }))
          .filter((x) => x.s > 0)
          .sort((x, y) => y.s - x.s || x.e.path.localeCompare(y.e.path))
          .slice(0, 5)
          .map((x) => x.e);
  return { matches, otherMethods, suggestions };
}

/** How the credential label is sent on the wire. */
function credentialHint(auth: string): string | undefined {
  const a = auth.toLowerCase();
  const key = a.includes("key") ? "Authorization: Bearer crx_live_<prefix>_<secret>" : undefined;
  const session = a.includes("session") ? "a player session (session cookie, or Authorization: Bearer <opaque session token>)" : undefined;
  return [key, session].filter(Boolean).join("; or ") || undefined;
}

/** Text block for one endpoint. */
export function formatEndpoint(e: ApiEndpoint): string {
  const lines = [`${e.method} ${e.path}`];
  lines.push(`Module: ${e.module}${e.group && e.group !== e.module ? ` (${e.group})` : ""}${e.operationId ? ` · operationId: ${e.operationId}` : ""}`);
  lines.push(`Credentials: ${e.auth}${e.security?.length ? ` (OpenAPI security: ${e.security.join(", ")})` : ""}`);
  const hint = credentialHint(e.auth);
  if (hint) lines.push(`Send: ${hint}`);
  lines.push(`Headers: ${e.headers.length > 0 ? e.headers.map((h) => `${h.name} (${h.required ? "required" : "optional"}${h.note ? `; ${h.note}` : ""})`).join(", ") : "none beyond credentials"}`);
  if (e.summary) lines.push(`Summary (source language): ${e.summary}`);
  return lines.join("\n");
}

/** Result of an error lookup: entries for the code, other codes with the same HTTP status, suggestions when nothing matched. */
export interface ErrorLookup {
  code: string;
  matches: ApiError[];
  sameStatus: ApiError[];
  suggestions: string[];
}

/** `"HTTP 404 Not Found"` → `404`, `` `module_disabled` `` → `module_disabled`. */
export function normalizeErrorCode(raw: string): string {
  const text = raw.trim().replace(/^[`'"]+|[`'"]+$/g, "").toLowerCase();
  const status = /^(?:http\s*)?(\d{3})\b/.exec(text);
  return status ? (status[1] ?? text) : text;
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

/**
 * Looks up an error code (machine code such as `module_disabled`, or an HTTP status such as `409`).
 *
 * # Returns
 * - `ErrorLookup` — for a status, `sameStatus` lists machine codes documented with that status
 */
export function findErrors(errors: ApiError[], code: string, lang: DocLang): ErrorLookup {
  const norm = normalizeErrorCode(code);
  const pool = errors.filter((e) => e.lang === lang);
  const matches = pool.filter((e) => e.code.toLowerCase() === norm);
  const status = /^\d{3}$/.test(norm) ? Number(norm) : undefined;
  const sameStatus = status === undefined ? [] : pool.filter((e) => e.status === status && e.code.toLowerCase() !== norm);
  const codes = [...new Set(pool.map((e) => e.code))];
  const suggestions =
    matches.length > 0 || sameStatus.length > 0
      ? []
      : codes
          .map((c) => ({ c, d: c.toLowerCase().includes(norm) || norm.includes(c.toLowerCase()) ? 0 : editDistance(c.toLowerCase(), norm) }))
          .filter((x) => x.d <= Math.max(2, Math.floor(norm.length / 3)))
          .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
          .slice(0, 5)
          .map((x) => x.c);
  return { code: norm, matches, sameStatus, suggestions };
}

/** Text block for one documented error. */
export function formatError(e: ApiError): string {
  return `${e.code}${e.status !== undefined && String(e.status) !== e.code ? ` — HTTP ${e.status}` : ""} · ${e.family}\n  ${e.meaning}`;
}
