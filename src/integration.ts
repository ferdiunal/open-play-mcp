/**
 * # open-play-mcp::integration
 *
 * **Neden var:** `integrate_open_play` istemi senaryoya göre (kendi alan adındaki web oyunu, statik oyun + BFF, stüdyoya ikinci
 * oyun, Unity, sunucu) adım adım plan, panelde bir insanın yapması gerekenler ve okunacak sayfa kimlikleri üretir.
 * **Kapsam:** `SCENARIOS`, `scenarioFor`, `integrationPrompt`.
 * **Sahip olduğu tipler:** `Scenario`.
 *
 * Page ids are filtered against the loaded index, so a page that is not published yet (or was renamed) is never offered.
 */
import { SITE_ROOT, type McpIndex } from "./types.js";

/** Integration scenarios offered by the prompt. */
export const SCENARIOS = ["web-direct", "web-bff", "second-game", "unity", "server"] as const;
/** One integration scenario. */
export type Scenario = (typeof SCENARIOS)[number];

/** Old `platform` argument values and the scenario each one means. */
export const PLATFORM_SCENARIO: Record<"web" | "unity" | "server", Scenario> = { web: "web-direct", unity: "unity", server: "server" };

interface Plan {
  title: string;
  steps: string[];
  panel: string[];
  pages: string[];
}

const PLAYER_API = "Ayarlar › Stüdyo ayarları › Genel (Settings › Studio settings › General) shows the studio's player API address, e.g. https://<slug>.open-play.tech/api; give it to the SDK or your HTTP client without a trailing /v1";
const API_KEYS = "Ayarlar › Oyun ayarları › API anahtarları (Settings › Game settings › API keys), with the right game · environment picked in the top bar";
const ORIGIN_BINDING =
  "Ask the platform operator to bind every page origin of the game to its environment (exact hosts, e.g. dev.game.example.com for dev and game.example.com for prod; no wildcards, IPs or ports). Studio roles cannot open Ayarlar › Oyun ayarları › Ortamlar ve alan adları (Environments and domains); an unbound origin fails with 403 or a CORS error in the browser";
const MODULES = "Check Ayarlar › Oyun ayarları › Modüller (Modules): it is read-only for studio roles, so ask the platform operator to turn on a module that is off (its endpoints answer 404 module_disabled)";

const PLANS: Record<Scenario, Plan> = {
  "web-direct": {
    title: "web game on its own domain calling the studio API directly (SDK token mode)",
    steps: [
      "Create the browser client in token mode, because the API is on another origin than the game page: createPlayerClient({ baseUrl: <player API>, environmentId, auth: { mode: \"token\" } }) from @ferdiunal/open-play-ts. The default cookie mode only works when the API is served from the game's own origin through a reverse proxy (for example <your origin>/api).",
      "The browser needs only the environment ID (environmentId, sent as x-crx-env); it is not secret. Never put a server key in the game client.",
      "Call client.session.restore() first and sign in as a guest only when there is no session, so a returning player keeps the same account (auth/guest).",
      "The game page origin must be bound to the environment by the platform operator before a browser sign-in works (see the panel checklist).",
      "Look up exact SDK signatures with get_sdk_symbol (sdk: typescript); check credentials and headers of any raw REST call with get_endpoint and decode failures with get_error.",
    ],
    panel: [PLAYER_API, `Create or open an API key in ${API_KEYS}; the key card and the key detail page show the environment ID to copy`, ORIGIN_BINDING, MODULES],
    pages: ["getting-started/quickstart", "getting-started/architecture-and-hosting", "auth/guest", "auth/sessions-and-csrf", "sdk/typescript", "operations/security", "reference/errors"],
  },
  "web-bff": {
    title: "static web game plus your own Node backend (BFF) that holds the server key",
    steps: [
      "Keep the server key only in the BFF: one key per environment, with an expiry; never in the browser bundle, the repository or logs.",
      "Use the server key only for work that has no player-session endpoint, for example POST /v1/leaderboards/{key}/scores, POST /v1/reward-tables/{key}/grant, POST /v1/transfers, GET /v1/wallets, GET /v1/players/{player_id}/data (read-only) and POST /v1/iap/verify. Check each one with get_endpoint: \"Server key\" means a client key or a player session gets 403; send Idempotency-Key where it is required.",
      "Server-key endpoints act on the player id you send and do not check it belongs to the caller: the BFF must know who the player is (its own session, or the Open Play session it holds); never take a player id from the browser.",
      "If the BFF opens player sessions (POST /v1/auth/sign-in/guest with x-crx-env and a bootstrap_token the BFF generates and stores per player), persist that player's opaque tokens.session_token and tokens.refresh_token server-side (encrypted) and call with Authorization: Bearer <session_token> plus x-crx-env. Do not sign in again per request.",
      "expires_in_secs (900 s) is only the access JWT lifetime, never the session lifetime: the session and refresh window is 30 days sliding, 180 days absolute. On 401 call POST /v1/auth/refresh with the refresh token, store the new pair, retry once, and serialize refreshes per player (a refresh token presented twice revokes the whole session family).",
      "Guest sign-in is rate limited per client IP (30 per 60 s); the BFF is one IP for all of its players, so signing in per request locks everyone out with 429. Rate-limit your own \"create session\" endpoint per IP or device.",
      "Never delete a player's bootstrap secret on 429, 5xx, timeouts or network errors (the player would silently get a new guest account); replace it only when sign-in explicitly rejects it with 403, and never for account_banned.",
      "Never apply currency amounts stated by the client: compute rewards on the server (fixed amounts or a reward table) with an Idempotency-Key derived from the game event (for example the match id). Allow-list leaderboard keys in the BFF instead of passing the browser's key through, sanity-check scores, and deliver real-money purchases only after receipt verification.",
      "The BFF's own server calls carry no Origin and need no domain binding; if the browser also calls Open Play directly, its page origin must be bound to the environment by the platform operator.",
    ],
    panel: [PLAYER_API, `Create one server key per environment in ${API_KEYS} (the secret is shown once; the card also shows the environment ID)`, ORIGIN_BINDING, MODULES],
    pages: ["guides/bff-pattern", "auth/server-verification", "auth/guest", "auth/sessions-and-csrf", "reference/rate-limits", "reference/idempotency-and-concurrency", "guides/competition", "guides/rewards", "guides/economy", "operations/security", "reference/endpoints"],
  },
  "second-game": {
    title: "add another game to an existing studio",
    steps: [
      "A studio owner or studio admin creates the game in the studio panel: Ayarlar › Stüdyo ayarları › Oyunlar › Yeni oyun (Settings › Studio settings › Games › New game). It comes with dev and prod environments; any extra environment is added by the platform operator.",
      "Every game of the studio uses the same player API base (https://<slug>.open-play.tech/api); games are told apart only by environment ID and API key.",
      "Pick the new game · environment in the top bar and create new API keys there: keys and environment IDs are per game and per environment; never reuse the first game's values.",
      "The platform operator binds the new game's page hosts to each of its environments (one host belongs to one environment only).",
      "Modules are read-only for studio roles; ask the platform operator to enable what the new game needs.",
      "Repeat the setup in every environment of the new game: currencies, reward tables, leaderboard definitions, store, content and rules are not copied from the first game. Players, wallets, inventories and cloud saves are per environment as well.",
      "Configure the new game's client and server with its own environment ID and keys, then verify with a guest sign-in in dev.",
    ],
    panel: [
      "Ayarlar › Stüdyo ayarları › Oyunlar › Yeni oyun (Settings › Studio settings › Games › New game); only studio owners and admins see it",
      `New keys per environment in ${API_KEYS}`,
      ORIGIN_BINDING,
      MODULES,
      "Per environment: Ekonomi › Para birimleri (Economy › Currencies), Ekonomi › Ödül tabloları (Economy › Reward tables), Oyun yönetimi › Leaderboard (Game management › Leaderboards)",
    ],
    pages: ["getting-started/multiple-games", "panel/studio-settings", "panel/game-settings-api-keys", "panel/game-settings-environments", "panel/game-settings-modules", "panel/currencies", "panel/reward-tables", "panel/leaderboards", "getting-started/concepts"],
  },
  unity: {
    title: "Unity game",
    steps: [
      "Use the studio player API as the base URL and the environment ID from the API keys page; never ship a server key in a build.",
      "Sign the player in as a guest with PlayerSession.SignInGuestAsync (auth/guest); the SDK keeps the guest secret so the player returns to the same account.",
      "A WebGL build runs in a browser, so its page origin must be bound to the environment like a web game.",
      "Look up exact C# signatures with get_sdk_symbol (sdk: unity) and decode failures with get_error.",
    ],
    panel: [PLAYER_API, `Copy the environment ID from ${API_KEYS}`, MODULES],
    pages: ["getting-started/quickstart", "sdk/unity", "auth/guest", "auth/sessions-and-csrf", "reference/errors"],
  },
  server: {
    title: "game server calling Open Play with a server key",
    steps: [
      "Use a server key with CrxClient only on your own server; verify players server-side before acting for them (auth/server-verification).",
      "Check credentials and headers of every endpoint with get_endpoint; send Idempotency-Key on writes that require it and If-Match where the endpoint supports optimistic versions.",
      "Read reference/errors and reference/idempotency-and-concurrency before writing data; decode failures with get_error.",
    ],
    panel: [PLAYER_API, `Create a server key per environment in ${API_KEYS}`, MODULES],
    pages: ["getting-started/quickstart", "sdk/typescript", "auth/server-verification", "reference/endpoints", "reference/errors", "reference/idempotency-and-concurrency"],
  },
};

/** Picks the scenario: an explicit `scenario` wins, else the old `platform` argument, else `web-direct`. */
export function scenarioFor(scenario?: Scenario, platform?: keyof typeof PLATFORM_SCENARIO): Scenario {
  return scenario ?? (platform ? PLATFORM_SCENARIO[platform] : "web-direct");
}

/**
 * Builds the prompt text for a scenario.
 *
 * # Parameters
 * - `index: McpIndex` — loaded index; page ids that are not in it (English) are left out
 * - `scenario: Scenario` — which plan
 */
export function integrationPrompt(index: McpIndex, scenario: Scenario): string {
  const plan = PLANS[scenario];
  const pages = plan.pages.map((id) => index.docs.find((d) => d.lang === "en" && d.id === id)).filter((d) => d !== undefined);
  return [
    `Help me integrate my game with Open Play. Scenario: ${scenario} (${plan.title}).`,
    "Use the open-play MCP tools (search_docs, read_doc, get_endpoint, get_error, search_sdk, get_sdk_symbol) instead of guessing; call index_info first to see how fresh the docs index is.",
    "",
    "Steps:",
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Panel checklist (a person with panel access does these; menu labels are Turkish with English in parentheses):",
    ...plan.panel.map((s) => `- ${s}.`),
    "",
    "Read these pages (read_doc ids):",
    ...pages.map((d) => `- ${d.id} — ${d.title}: ${d.url}`),
    "",
    `Docs home: ${SITE_ROOT}/en/`,
  ].join("\n");
}
