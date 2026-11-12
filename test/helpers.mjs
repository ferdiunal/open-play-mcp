// Test helpers: the fixture index is a small checked-in JSON (docs in en/tr + TypeScript and Unity symbols).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(here, "fixtures", "index.json");

/** Fresh copy of the fixture index. */
export function fixtureIndex() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

/** Text of an MCP tool result. */
export const text = (r) => r.content.map((c) => c.text).join("\n");

/** Real documentation pages (Open Play docs at e07055673, English and Turkish) that competed for the search regression queries. */
export const REGRESSION_PATH = join(here, "fixtures", "regression-docs.json");

/** Fresh copy of the search regression corpus. */
export function regressionIndex() {
  return JSON.parse(readFileSync(REGRESSION_PATH, "utf8"));
}

/** The fixture index plus what a 0.3.0-era index carries: panel metadata on a panel page, `endpoints` and `errors`. */
export function richIndex() {
  const index = fixtureIndex();
  index.docs.push(
    {
      id: "panel/game-settings-api-keys",
      lang: "en",
      title: "API keys",
      description: "Create the keys your game uses to connect to Open Play.",
      section: "panel",
      url: "https://open-play.b4klabs.dev/docs/en/panel/game-settings-api-keys.html",
      headings: ["Environment ID for the SDK"],
      body: "# API keys\n\nThe card shows the environment ID.\n",
      panel: { route: "#/settings/api-keys", kind: "tab", area: "settings", menu: { en: ["Settings", "Game settings", "API keys"], tr: ["Ayarlar", "Oyun ayarları", "API anahtarları"] }, capability: "api_keys_read" },
    },
    {
      id: "panel/studio-settings",
      lang: "tr",
      title: "Stüdyo ayarları",
      description: "Stüdyonun oyunlarını yönetin.",
      section: "panel",
      url: "https://open-play.b4klabs.dev/docs/tr/panel/studio-settings.html",
      headings: ["Oyunlar"],
      body: "# Stüdyo ayarları\n\n**Yeni oyun** düğmesi.\n",
      panel: { route: "#/studio", kind: "page", area: "settings", menu: { en: ["Settings", "Studio settings"], tr: ["Ayarlar", "Stüdyo ayarları"] }, capability: "platform_read", roles: ["studio_owner", "studio_admin"], realms: ["studio"] },
    },
  );
  index.endpoints = [
    { method: "POST", path: "/v1/leaderboards/{key}/scores", module: "competition", group: "Competition", auth: "Server key", headers: [{ name: "Idempotency-Key", required: true }], summary: "Oyuncu skoru gönderir.", operationId: "submitLeaderboardScore", security: ["LeaderboardServerKey"] },
    { method: "GET", path: "/v1/leaderboards/{key}/top", module: "competition", group: "Competition", auth: "Server or client key", headers: [], summary: "En iyi skorlar." },
    { method: "GET", path: "/v1/leaderboards/{key}", module: "competition", group: "Competition", auth: "Server or client key", headers: [], summary: "Tanımı okur." },
    { method: "GET", path: "/v1/leaderboards/mine", module: "competition", group: "Competition", auth: "Player session", headers: [{ name: "x-crx-env", required: true }], summary: "Oyuncunun sıraları." },
    { method: "POST", path: "/v1/player/store/listings/{listing_id}/buy", module: "store", group: "Store", auth: "Player session", headers: [{ name: "x-crx-env", required: true }, { name: "x-csrf-token", required: false, note: "required with a cookie session" }, { name: "Idempotency-Key", required: true }], summary: "Satın alır." },
  ];
  index.errors = [
    { lang: "en", code: "404", status: 404, family: "Core REST: status table", meaning: "Body: `not found`; When: The resource does not exist; Retry?: No", page: "reference/errors" },
    { lang: "en", code: "module_disabled", status: 404, family: "Core REST: status table", meaning: "When: The product module is disabled in the environment; Retry?: No", page: "reference/errors" },
    { lang: "en", code: "idempotency_in_flight", status: 409, family: "Plugin endpoints", meaning: "retryable: **yes**; Note: A request with the same key is being processed", page: "reference/errors" },
    { lang: "tr", code: "module_disabled", status: 404, family: "Çekirdek REST: durum tablosu", meaning: "Ne zaman: Modül kapalı", page: "reference/errors" },
  ];
  return index;
}
