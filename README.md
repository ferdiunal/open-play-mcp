# @ferdiunal/open-play-mcp

Open Play geliştirici belgelerini ve SDK API'sini (TypeScript + Unity) MCP aracı olarak sunar; yapay zekâ yardımcıları
("misafir girişi nasıl yapılır?") cevabı resmî belgeden alır. Yalnız okur, çalışırken ağ kullanmaz.
Tasarım: `DESIGN.md` §10.39, diyagramlar `MERMAID.md` M258–M259. Kullanıcı belgesi: `docs/developer/{tr,en}/getting-started/ai-tools.md`.

## Derleme ve test

```bash
npm ci
npm run build   # tsc + scripts/build-index.mjs -> dist/cli.js, dist/index.json
npm test        # birim + MCP istemcisiyle entegrasyon + stdio/--http duman testleri
```

`build-index.mjs` belgeleri (`docs/developer/{tr,en}`), TypeDoc JSON'unu (`tools/sdk-reference`, ilk koşuda `npm ci`) ve
`sdks/unity/Runtime` C# kaynağını tek `dist/index.json` dosyasında toplar.

## Çalıştırma

```bash
node dist/cli.js                 # stdio (varsayılan)
node dist/cli.js --http 8787     # Streamable HTTP, http://127.0.0.1:8787/mcp (durumsuz)
node dist/cli.js --index x.json  # başka dizin dosyası
```

## Araçlar

`search_docs`, `read_doc`, `list_docs`, `search_sdk`, `get_sdk_symbol`; kaynak `open-play-docs://<dil>/<sayfa>`; istem `integrate_open_play`.

## Yayın

Paket GitHub Packages'a (`https://npm.pkg.github.com/@ferdiunal`) yayımlanacak şekilde hazırdır, ancak yayın bir kullanıcı adımıdır
(`docs/TECHNICAL-DEBT.md` TD-1540); bu depodan hiçbir şey yayımlanmaz.
