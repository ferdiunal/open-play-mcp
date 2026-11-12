# open-play-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants the official **Open Play** developer
documentation and SDK API (TypeScript and Unity C#). Ask "how do I sign a guest in?" and the answer comes from the
real docs at <https://open-play.b4klabs.dev/docs/>, not from guesswork.

It is read-only: every tool only reads a documentation index. No tool fetches a URL you give it; `get_endpoint` matches a path
as text.

## Use the hosted server (easiest)

```bash
claude mcp add --transport http open-play https://open-play.b4klabs.dev/mcp
```

Cursor (`~/.cursor/mcp.json`) and VS Code (`.vscode/mcp.json`, under `servers`):

```json
{ "mcpServers": { "open-play": { "url": "https://open-play.b4klabs.dev/mcp" } } }
```

Claude Desktop (via the `mcp-remote` bridge):

```json
{ "mcpServers": { "open-play": { "command": "npx", "args": ["-y", "mcp-remote", "https://open-play.b4klabs.dev/mcp"] } } }
```

## Run it locally

The package is published to GitHub Packages. Add this line to your `~/.npmrc` (or a project `.npmrc`) and use a
personal access token with `read:packages`:

```
@ferdiunal:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<YOUR_TOKEN>
```

Then register it with your client, for example:

```bash
claude mcp add open-play -- npx -y @ferdiunal/open-play-mcp
```

or in a JSON config: `{ "command": "npx", "args": ["-y", "@ferdiunal/open-play-mcp"] }`.

## Tools, resources, prompt

| Kind | Name | What it does |
|---|---|---|
| tool | `search_docs` | Searches the developer docs (English or Turkish) and returns the best pages with their URLs; panel pages also show their menu path, route and required panel capability. |
| tool | `read_doc` | Returns one page as markdown by id, such as `auth/guest` (with the panel line for panel pages). |
| tool | `list_docs` | Lists page ids and titles, optionally for one section. |
| tool | `search_sdk` | Searches TypeScript and Unity SDK symbols by name, member, signature or summary. |
| tool | `get_sdk_symbol` | Returns one SDK type or function with signature, summary and members (`Type.Member` works). |
| tool | `get_endpoint` | `{path, method?}` → credentials (server key, client key, player session), required headers (`Idempotency-Key`, `If-Match`, `x-crx-env`, `x-csrf-token`) and summary of a REST endpoint; templates (`/v1/leaderboards/{key}/scores`), concrete paths and full URLs all work. |
| tool | `get_error` | `{code, lang?}` → meaning, HTTP status and retry advice of an error code (`module_disabled`, `409`, ...). |
| tool | `index_info` | Source commit, build time and age, where the index was loaded from, and page/symbol/endpoint/error counts. |
| resource | `open-play-docs://<lang>/<page>` | One doc page as markdown. |
| prompt | `integrate_open_play` | A plan for one `scenario`: `web-direct` (web game on its own domain, SDK token mode), `web-bff` (static game + backend holding the server key), `second-game` (add a game to an existing studio), `unity`, `server`; with the panel checklist and the pages to read. The older `platform` argument (`web`, `unity`, `server`) still works. |

Search folds Turkish letters, ignores English and Turkish stopwords, matches short words only as whole words, and knows a
small set of English↔Turkish synonyms (for example `environment id` ↔ `ortam kimliği` ↔ `x-crx-env`, `leaderboard` ↔
`skor tablosu`, `new game` ↔ `yeni oyun`).

## Flags and environment

```text
open-play-mcp                      stdio transport (default)
open-play-mcp --http <port>        stateless Streamable HTTP on /mcp (0 = free port)

--docs-url <url>          index URL (env OPEN_PLAY_MCP_INDEX_URL)
--index <path>            use a local index.json only, no network
--host <addr>             HTTP bind address (default 127.0.0.1)
--allowed-origins <list>  comma-separated browser Origins allowed (default https://open-play.b4klabs.dev)
--trust-proxy             take the client IP from X-Forwarded-For (only behind a trusted reverse proxy)
--rate-limit <n>          requests per minute per client IP (default 60)
--burst <n>               rate-limit burst size (default 20)
```

Other environment variables: `OPEN_PLAY_MCP_CACHE_DIR` (default `$XDG_CACHE_HOME/open-play-mcp`, else `~/.cache/open-play-mcp`).

HTTP mode serves `POST /mcp` and `GET /healthz` (index commit and generation time). It rejects browser requests whose
`Origin` is not allowed (403), bodies over 64 KB (413) and clients over the rate limit (429 with `Retry-After`).
Requests without an `Origin` header (CLI clients) are allowed. Logs are one JSON line per request on stderr, without bodies.

## Self-host with Docker

```bash
docker run -d --name open-play-mcp --restart unless-stopped \
  -p 127.0.0.1:18490:8080 ghcr.io/ferdiunal/open-play-mcp:0.3.0
```

Put a reverse proxy in front for TLS. Behind a proxy that sets `X-Forwarded-For` (the image already starts with
`--trust-proxy`), make sure the proxy appends the real client address; do not expose the container port directly.
Nginx needs `proxy_buffering off;` and a long `proxy_read_timeout` for streamed responses. Build it yourself with
`docker build -t open-play-mcp .`.

## How the index is refreshed

The docs site publishes one file, `https://open-play.b4klabs.dev/docs/mcp/index.json`, rebuilt with every docs release
(`schemaVersion`, `generatedAt`, `commit`, `docs[]`, `symbols[]`, and since the 0.3.0-era docs pipeline `endpoints[]`,
`errors[]` and a `panel` object on panel pages). An older index without those parts still loads; `get_endpoint` and
`get_error` then say so and point to the reference pages. `index_info` shows which index is being served. On start the
server loads, in this order:

1. the live index (5 s timeout, validated; `schemaVersion` must be 1),
2. the on-disk cache (used with `If-None-Match`, so unchanged indexes cost a `304`),
3. the snapshot bundled in the package (`snapshot/index.json`).

Network problems never crash the server and are logged to stderr only (stdout carries the stdio protocol). In `--http`
mode the index is re-checked in the background every 15 minutes; a failed check keeps serving the previous index.
Maintainers refresh the bundled snapshot with `npm run update-snapshot` (optionally `-- --from <file|url>`).

## Release

Pushing a `v*` tag runs `.github/workflows/publish.yml`: it builds and tests, publishes the npm package to GitHub Packages,
then builds the Docker image and pushes `ghcr.io/ferdiunal/open-play-mcp:<version>` and `:latest`. Before tagging, refresh
the bundled snapshot from the published index so offline installs carry the same data.

## Develop

```bash
npm ci
npm run build
npm test          # includes a Docker smoke test when Docker is available (skip: OPEN_PLAY_MCP_SKIP_DOCKER=1)
```

## License

[MIT](LICENSE) © 2026 Ferdi ÜNAL
