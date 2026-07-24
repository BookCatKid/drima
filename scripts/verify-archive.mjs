import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_PATH, REQUIRED, VERSIONS_DIR } from "./archive-lib.mjs";

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
assert.ok(manifest.versions.length > 0, "Manifest has no versions");
assert.equal(new Set(manifest.versions.map((version) => version.id)).size, manifest.versions.length, "Duplicate version IDs");
assert.equal(manifest.versions.filter((version) => version.latest).length, 1, "Manifest must have exactly one latest build");

let totalBytes = 0;
for (const version of manifest.versions) {
  for (const asset of REQUIRED) {
    const target = path.join(VERSIONS_DIR, version.id, asset);
    const info = await stat(target);
    assert.ok(info.size > 100, `${version.id}/${asset} is unexpectedly small`);
    const head = (await readFile(target)).subarray(0, 2);
    assert.notDeepEqual([...head], [31, 139], `${version.id}/${asset} still contains gzip transport bytes`);
    totalBytes += info.size;
  }
  const wasm = await readFile(path.join(VERSIONS_DIR, version.id, "webapp/index.wasm"));
  assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109], `${version.id} has an invalid WebAssembly header`);
  const html = await readFile(path.join(VERSIONS_DIR, version.id, "index.html"), "utf8");
  assert.match(html, /\.\.\/\.\.\/poki-sdk\.js/, `${version.id} is missing the relative offline SDK shim`);
  assert.doesNotMatch(html, /src=["'](?:https?:)?\/\/game-cdn\.poki\.com/i, `${version.id} still loads the online Poki SDK`);
}

console.log(`Verified ${manifest.versions.length} playable builds (${(totalBytes / 1024 / 1024).toFixed(1)} MB of required assets).`);
