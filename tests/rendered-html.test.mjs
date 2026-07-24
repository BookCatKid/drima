import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the offline archive launcher", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Drive Mad — Offline Archive<\/title>/i);
  assert.match(html, /Drive Mad/);
  assert.match(html, /Drive Mad archive/i);
  assert.match(html, />Build</i);
});

test("ships a populated version manifest and offline SDK", async () => {
  const [manifestText, sdk] = await Promise.all([
    readFile(new URL("../public/versions/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../public/poki-sdk.js", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.ok(manifest.versions.length >= 30);
  assert.equal(manifest.versions.filter((version) => version.latest).length, 1);
  assert.ok(manifest.versions.every((version) => version.wasmSha256 && version.runtimeSha256));
  assert.match(sdk, /rewardedBreak/);
  assert.match(sdk, /commercialBreak/);
});
