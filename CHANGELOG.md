# Changelog

## 0.3.0 - 2026-11-12

Agent integration aids: findable answers, structured endpoint and error lookup, and scenario-specific integration plans.

### Added
- `index_info` tool: source commit, build time and age, where the index was loaded from (live site, disk cache, bundled
  snapshot or local file) and page, SDK symbol, endpoint and error counts.
- `get_endpoint` tool (`{path, method?}`): credentials, required headers and summary of a REST endpoint from the index
  `endpoints` section. Path templates, concrete paths, full URLs and `METHOD /path` input are matched as text (never fetched);
  a literal route beats a `{param}` route; wrong methods and typos get suggestions.
- `get_error` tool (`{code, lang?}`): meaning and retry advice from the index `errors` section; an HTTP status also lists
  the machine codes sent with it.
- `search_docs` and `read_doc` show a panel line for panel pages: menu path in English and Turkish, route, required panel
  capability, role and realm limits.
- `integrate_open_play` takes a `scenario`: `web-direct`, `web-bff`, `second-game`, `unity`, `server`. Each plan has steps,
  a panel checklist for a person and the pages to read (only ids present in the loaded index). `platform` still works.
- Search regression tests on real documentation pages for "create a new game", "ortam kimliği" and
  "API key environment id".

### Changed
- Search: English and Turkish stopwords are ignored; words shorter than 4 letters match only whole words (or their plural),
  longer words match as prefixes (Turkish suffixes); a small English↔Turkish synonym map (environment id, API/server/client
  key, leaderboard, trusted origin, new game, studio, player data, guest, environment, currency), with synonyms counting half
  of the typed phrase; rarer query words weigh more; titles made of query words and headings holding every query word get a
  bonus; pages covering more of the query rank higher; "Server (all games)" panel screens (platform operator) yield to
  studio-side pages.
- Server instructions mention `index_info`, `get_endpoint`, `get_error` and the prompt scenarios.
- Indexes with `endpoints`/`errors` keep them through validation; older indexes still load.


## 0.2.0 - 2026-11-04

First public release; this repository was split out of the Open Play monorepo.

### Changed
- The index is no longer built at package build time. It is fetched from
  `https://open-play.b4klabs.dev/docs/mcp/index.json` (5 s timeout, `schemaVersion` 1 required), cached on disk with its
  ETag, and falls back to a bundled snapshot.
- `--http` mode is stateless Streamable HTTP with `--host`, `--allowed-origins`, `--trust-proxy`, `--rate-limit` and `--burst`.
- Package metadata for GitHub Packages, MIT license.

### Added
- `GET /healthz`, Origin check, 64 KB body limit (413), per-IP token bucket (429 + `Retry-After`), JSON access log on stderr.
- Background index refresh every 15 minutes in HTTP mode.
- `--docs-url` / `OPEN_PLAY_MCP_INDEX_URL`, `OPEN_PLAY_MCP_CACHE_DIR`, `npm run update-snapshot`.
- Dockerfile, CI workflow (Node 20 and 22), publish workflow (GitHub Packages and GHCR).

### Removed
- The build-time index builder (it now lives in the Open Play docs pipeline).

## 0.1.0

Internal preview (not published).
