# Changelog

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
