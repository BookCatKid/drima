import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GAME_ID, NEW_HOST, REQUIRED, VERSIONS_DIR, directoryStats, fetchRetry,
  formatArchiveLabel, installDirectory, patchIndexHtml, patchSourceMinJs,
  readManifest, writeManifest,
} from "./archive-lib.mjs";

const WRAPPER = `https://games.poki.com/458768/${GAME_ID}?site_id=3&poki_url=https%3A%2F%2Fpoki.com%2Fen%2Fg%2Fdrive-mad`;

async function main() {
  const wrapper = await (await fetchRetry(WRAPPER, { headers: { Referer: "https://poki.com/" } })).text();
  const gameUri = wrapper.match(/"gameUri":"([^"]+)"/)?.[1]?.replaceAll("\\/", "/");
  const versionId = wrapper.match(/"gameVersion":"([0-9a-f-]{36})"/)?.[1];
  if (!gameUri || !versionId) throw new Error("Poki wrapper no longer exposes gameUri/gameVersion in the expected format.");

  // Check if this version is already the latest in the manifest
  const manifest = await readManifest();
  const currentLatest = manifest.versions.find((item) => item.latest);
  if (currentLatest && currentLatest.id === versionId) {
    console.log(`Drive Mad is already up-to-date (${versionId}).`);
    return;
  }

  const baseUrl = new URL("./", gameUri).href;
  const temp = path.join(VERSIONS_DIR, `.tmp-${versionId}`);
  const finalDirectory = path.join(VERSIONS_DIR, versionId);
  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });

  const optional = ["webapp/cover.jpg", "webapp/baloo2.woff"];
  const downloaded = [];
  const assetOptions = { headers: { Referer: "https://games.poki.com/", "User-Agent": "Mozilla/5.0 Drive-Mad-Offline-Archiver" } };
  try {
    for (const asset of REQUIRED) {
      const response = await fetchRetry(new URL(asset, baseUrl), assetOptions);
      const target = path.join(temp, asset);
      await mkdir(path.dirname(target), { recursive: true });
      const body = Buffer.from(await response.arrayBuffer());
      await writeFile(target, asset === "index.html" ? patchIndexHtml(body.toString("utf8")) : asset === "webapp/source_min.js" ? patchSourceMinJs(body.toString("utf8")) : body);
      downloaded.push(asset);
    }
    for (const asset of optional) {
      try {
        const response = await fetchRetry(new URL(asset, baseUrl), assetOptions, 2);
        const target = path.join(temp, asset);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(await response.arrayBuffer()));
        downloaded.push(asset);
      } catch { /* Optional in some releases. */ }
    }

    // Discover additional assets referenced in the downloaded files
    const discovered = new Set();
    const html = await readFile(path.join(temp, "index.html"), "utf8");
    for (const ref of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const asset = ref[1];
      if (asset.startsWith("webapp/") && !asset.includes("poki-sdk")) discovered.add(asset);
    }
    const sourceMinPath = path.join(temp, "webapp", "source_min.js");
    try {
      const sourceMin = await readFile(sourceMinPath, "utf8");
      for (const ref of sourceMin.matchAll(/["']([^"']+\.(?:js|css|png|jpg|gif|woff|ico))["']/g)) {
        const asset = ref[1];
        if (asset.startsWith("webapp/")) discovered.add(asset);
      }
    } catch { /* some versions may not have source_min.js yet */ }
    for (const asset of discovered) {
      if (downloaded.includes(asset)) continue;
      try {
        const response = await fetchRetry(new URL(asset, baseUrl), assetOptions, 2);
        const target = path.join(temp, asset);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(await response.arrayBuffer()));
        downloaded.push(asset);
      } catch { /* Extra asset unavailable, skip */ }
    }

    await installDirectory(temp, finalDirectory);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }

  const stats = await directoryStats(finalDirectory);
  const capturedAt = new Date().toISOString();
  const version = {
    id: versionId,
    label: formatArchiveLabel("", true),
    capturedAt,
    sourceHost: NEW_HOST,
    sourceUrl: baseUrl,
    fileCount: stats.fileCount,
    bytes: stats.bytes,
    latest: true,
  };
  const otherVersions = manifest.versions.filter((item) => item.id !== versionId).map((item) => ({ ...item, latest: false }));
  await writeManifest([version, ...otherVersions]);
  console.log(`Updated Drive Mad to ${versionId} (${downloaded.length} files, ${(stats.bytes / 1024 / 1024).toFixed(1)} MB).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
