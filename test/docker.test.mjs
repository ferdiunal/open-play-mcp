import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { text } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hasDocker = !process.env.OPEN_PLAY_MCP_SKIP_DOCKER && spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

test("docker smoke: image builds, /healthz is 200, search_docs works over HTTP", { skip: !hasDocker, timeout: 480_000 }, async () => {
  const tag = `open-play-mcp:smoke-${process.pid}`;
  let cid;
  const keepAlive = setInterval(() => {}, 250); // keeps the loop alive while docker-proxy resets early connections
  try {
    docker("build", "-q", "-t", tag, root);
    cid = docker("run", "-d", "--rm", "-p", "127.0.0.1::8080", tag);
    const port = docker("port", cid, "8080/tcp").split("\n")[0].split(":").pop();
    const base = `http://127.0.0.1:${port}`;
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      ok = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) }).then((r) => r.status === 200, () => false);
      if (!ok) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ok, "healthz never became 200");
    const client = new Client({ name: "docker", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    assert.match(text(await client.callTool({ name: "search_docs", arguments: { query: "guest sign in" } })), /auth\/guest/);
    await client.close();
  } finally {
    clearInterval(keepAlive);
    if (cid) spawnSync("docker", ["rm", "-f", cid], { stdio: "ignore" });
    spawnSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
  }
});
