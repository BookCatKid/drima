import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  GAME_ID, NEW_HOST, OLD_HOST, REQUIRED, VERSIONS_DIR, directoryStats,
  formatArchiveLabel, installDirectory, normalizeAssetPath, patchIndexHtml,
  patchSourceMinJs, readManifest, writeManifest,
} from "./archive-lib.mjs";

const CDX = "https://web.archive.org/cdx/search/cdx";
const ARQUIVO_CDX = "https://arquivo.pt/wayback/cdx";
const WRAPPER_URL = `https://games.poki.com/458768/${GAME_ID}`;
const execFileAsync = promisify(execFile);

async function queryHost(host) {
  const params = new URLSearchParams({
    url: `${host}/*`, output: "json", fl: "timestamp,original,statuscode,digest,length",
    filter: "statuscode:200", collapse: "digest",
  });
  // URLSearchParams cannot represent duplicate filter keys when constructed from an object.
  params.delete("filter");
  params.append("filter", "statuscode:200");
  const url = `${CDX}?${params}`;
  const { stdout } = await execFileAsync("curl", ["--retry", "8", "--retry-all-errors", "--connect-timeout", "20", "-fsSL", url], { maxBuffer: 20 * 1024 * 1024 });
  const rows = JSON.parse(stdout);
  const [headers, ...values] = rows;
  return values.map((valuesRow) => Object.fromEntries(headers.map((key, index) => [key, valuesRow[index]])));
}

function groupVersions(rows, host, archiveSource = "Internet Archive") {
  const groups = new Map();
  for (const row of rows) {
    const match = new URL(row.original).pathname.match(/^\/([0-9a-f-]{36})\/(.+)$/i);
    if (!match) continue;
    const [, id] = match;
    const asset = normalizeAssetPath(row.original, id);
    if (!asset) continue;
    if (!groups.has(id)) groups.set(id, { id, host, rows: new Map(), capturedAt: row.timestamp, archiveSource });
    const group = groups.get(id);
    group.capturedAt = group.capturedAt < row.timestamp ? group.capturedAt : row.timestamp;
    const existing = group.rows.get(asset);
    if (!existing || row.timestamp < existing.timestamp) group.rows.set(asset, row);
  }
  return [...groups.values()].filter((group) => REQUIRED.every((asset) => group.rows.has(asset)));
}

async function queryArquivo(url) {
  const { stdout } = await execFileAsync("curl", ["--retry", "4", "--retry-all-errors", "-fsSLG", ARQUIVO_CDX, "--data-urlencode", `url=${url}`, "--data", "output=json"], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim().split("\n").filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    return { ...row, original: row.url };
  });
}

async function queryArquivoCandidates() {
  const [oldRows, newRows, wrapperRows] = await Promise.all([
    queryArquivo(`${OLD_HOST}/*`),
    queryArquivo(`${NEW_HOST}/*`),
    queryArquivo(WRAPPER_URL),
  ]);
  const groups = [
    ...groupVersions(oldRows.filter((row) => row.status === "200"), OLD_HOST, "Arquivo.pt"),
    ...groupVersions(newRows.filter((row) => row.status === "200"), NEW_HOST, "Arquivo.pt"),
  ];
  const known = new Set(groups.map((group) => group.id));
  for (const row of wrapperRows) {
    try {
      const replay = `https://arquivo.pt/wayback/${row.timestamp}id_/${row.original}`;
      const { stdout: html } = await execFileAsync("curl", ["--retry", "3", "-fsSL", replay], { maxBuffer: 10 * 1024 * 1024 });
      const id = html.match(/"gameVersion":"([0-9a-f-]{36})"/)?.[1] ?? html.match(/game_version_id=([0-9a-f-]{36})/)?.[1];
      if (!id || known.has(id)) continue;
      const host = html.match(/https:\/\/([^/]+)\/[0-9a-f-]{36}\/index\.html/)?.[1] ?? OLD_HOST;
      groups.push({
        id,
        host,
        capturedAt: row.timestamp,
        archiveSource: "Arquivo.pt",
        rows: new Map(REQUIRED.map((asset) => [asset, { timestamp: row.timestamp, original: `https://${host}/${id}/${asset}` }])),
      });
      known.add(id);
    } catch { /* Keep checking the other wrapper captures. */ }
  }
  return groups;
}

/**
 * Discover version UUIDs from the game's wrapper page captures on the Wayback Machine.
 * Each wrapper capture embeds the "gameVersion" UUID that was current at that point in time.
 * This can reveal builds whose CDN assets were never directly archived.
 */
async function discoverUuidsFromWrapperPages(existingIds) {
  const seen = new Set(existingIds);
  const discovered = [];

  // Query Wayback CDX for all wrapper page captures
  const params = new URLSearchParams({
    url: WRAPPER_URL,
    output: "json",
    fl: "timestamp,statuscode",
    filter: "statuscode:200",
  });
  params.delete("filter");
  params.append("filter", "statuscode:200");
  const wrapperCdxUrl = `${CDX}?${params}`;

  let rows;
  try {
    const { stdout } = await execFileAsync("curl", ["--retry", "8", "--retry-all-errors", "--connect-timeout", "20", "-fsSL", wrapperCdxUrl], { maxBuffer: 10 * 1024 * 1024 });
    rows = JSON.parse(stdout);
  } catch {
    console.warn("  Wayback CDX for wrapper page unavailable, skipping");
    return [];
  }

  const [, ...values] = rows;
  const timestamps = values.map((r) => r[0]).sort();
  console.log(`  ${timestamps.length} wrapper captures in Wayback CDX, checking for version UUIDs…`);

  await mapLimit(timestamps, 3, async (timestamp) => {
    try {
      const replay = `https://web.archive.org/web/${timestamp}id_/${WRAPPER_URL}`;
      const { stdout: html } = await execFileAsync("curl", ["--compressed", "--retry", "3", "--max-time", "30", "-fsSL", replay], { maxBuffer: 10 * 1024 * 1024 });
      const uuid = html.match(/"gameVersion":"([0-9a-f-]{36})"/)?.[1];
      if (!uuid || seen.has(uuid)) return;
      seen.add(uuid);

      const host = html.match(/https:\/\/([^/]+)\/[0-9a-f-]{36}\/index\.html/)?.[1] ?? null;
      const normalizedHost = host && (host.includes("poki-gdn.com") || host.includes("gdn.poki.com")) ? host : OLD_HOST;
      discovered.push({
        id: uuid,
        host: normalizedHost,
        capturedAt: timestamp,
        archiveSource: "Internet Archive (wrapper)",
        rows: new Map(REQUIRED.map((asset) => [asset, { timestamp, original: `https://${normalizedHost}/${uuid}/${asset}` }])),
      });
      console.log(`  -> Discovered UUID from wrapper: ${uuid} (${normalizedHost}, captured ${timestamp.slice(0, 8)})`);
    } catch { /* skip captures that fail to replay */ }
  });

  return discovered;
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function downloadVersion(group) {
  const finalDirectory = path.join(VERSIONS_DIR, group.id);
  const temp = path.join(VERSIONS_DIR, `.tmp-${group.id}`);
  await rm(temp, { recursive: true, force: true });
  await mkdir(temp, { recursive: true });
  try {
    const assets = [...group.rows.entries()];
    const dirs = new Set(assets.map(([asset]) => path.dirname(path.join(temp, asset))));
    await Promise.all([...dirs].map((dir) => mkdir(dir, { recursive: true })));
    await mapLimit(assets, 2, async ([asset, row]) => {
      const replay = group.archiveSource === "Arquivo.pt"
        ? `https://arquivo.pt/wayback/${row.timestamp}id_/${row.original}`
        : `https://web.archive.org/web/${row.timestamp}id_/${row.original}`;
      const live = `https://${group.host}/${group.id}/${asset}`;
      let body;
      try {
        ({ stdout: body } = await execFileAsync("curl", ["--compressed", "--retry", "2", "--retry-all-errors", "--connect-timeout", "15", "--max-time", "60", "-fsSL", "-H", "Referer: https://games.poki.com/", live], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }));
      } catch {
        try {
          ({ stdout: body } = await execFileAsync("curl", ["--compressed", "--retry", "4", "--retry-all-errors", "--retry-max-time", "120", "--connect-timeout", "20", "--max-time", "120", "-fsSL", replay], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }));
        } catch (replayError) {
          if (REQUIRED.includes(asset)) throw replayError;
          console.warn(`  [${group.id}] ${asset} unavailable, skipping`);
          return;
        }
      }
      await writeFile(path.join(temp, asset), asset === "index.html" ? patchIndexHtml(body.toString("utf8")) : asset === "webapp/source_min.js" ? patchSourceMinJs(body.toString("utf8")) : body);
    });
    await installDirectory(temp, finalDirectory);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  return describeVersion(group, await directoryStats(finalDirectory));
}

function describeVersion(group, stats) {
  return {
    id: group.id,
    label: formatArchiveLabel(group.capturedAt),
    capturedAt: `${group.capturedAt.slice(0, 4)}-${group.capturedAt.slice(4, 6)}-${group.capturedAt.slice(6, 8)}T${group.capturedAt.slice(8, 10)}:${group.capturedAt.slice(10, 12)}:${group.capturedAt.slice(12, 14)}Z`,
    sourceHost: group.host,
    sourceUrl: `https://${group.host}/${group.id}/`,
    archiveSource: group.archiveSource,
    fileCount: stats.fileCount,
    bytes: stats.bytes,
    latest: false,
  };
}

async function readExistingVersion(group) {
  const finalDirectory = path.join(VERSIONS_DIR, group.id);
  try {
    await Promise.all(REQUIRED.map((asset) => access(path.join(finalDirectory, asset))));
    for (const asset of REQUIRED) {
      const head = (await readFile(path.join(finalDirectory, asset))).subarray(0, 2);
      if (head.equals(Buffer.from([31, 139]))) return null;
    }
    const htmlPath = path.join(finalDirectory, "index.html");
    const html = await readFile(htmlPath, "utf8");
    if (!/<(?:!doctype|html)\b/i.test(html)) return null;
    const patchedHtml = patchIndexHtml(html);
    if (patchedHtml !== html) await writeFile(htmlPath, patchedHtml);
    if (!patchedHtml.includes("../../poki-sdk.js")) return null;

    // Patch source_min.js if needed (mirrors what downloadVersion does)
    const sourceMinPath = path.join(finalDirectory, "webapp", "source_min.js");
    try {
      const sourceMin = await readFile(sourceMinPath, "utf8");
      const patchedSourceMin = patchSourceMinJs(sourceMin);
      if (patchedSourceMin !== sourceMin) await writeFile(sourceMinPath, patchedSourceMin);
    } catch { /* some versions may not have source_min.js */ }

    const wasm = await readFile(path.join(finalDirectory, "webapp/index.wasm"));
    if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) return null;

    // Download any extra assets from CDX that aren't yet on disk
    const extras = [...group.rows.entries()].filter(([asset]) => !REQUIRED.includes(asset));
    const missing = [];
    for (const [asset] of extras) {
      try { await access(path.join(finalDirectory, asset)); }
      catch { missing.push(asset); }
    }
    if (missing.length > 0) {
      await mapLimit(missing, 2, async (asset) => {
        const row = group.rows.get(asset);
        const replay = group.archiveSource === "Arquivo.pt"
          ? `https://arquivo.pt/wayback/${row.timestamp}id_/${row.original}`
          : `https://web.archive.org/web/${row.timestamp}id_/${row.original}`;
        const live = `https://${group.host}/${group.id}/${asset}`;
        let body;
        try {
          ({ stdout: body } = await execFileAsync("curl", ["--compressed", "--retry", "2", "--retry-all-errors", "--connect-timeout", "15", "--max-time", "60", "-fsSL", "-H", "Referer: https://games.poki.com/", live], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }));
        } catch {
          try {
            ({ stdout: body } = await execFileAsync("curl", ["--compressed", "--retry", "4", "--retry-all-errors", "--retry-max-time", "120", "--connect-timeout", "20", "--max-time", "120", "-fsSL", replay], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }));
          } catch { return; } // skip unavailable extras
        }
        const target = path.join(finalDirectory, asset);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, body);
      });
    }

    return describeVersion(group, await directoryStats(finalDirectory));
  } catch { return null; }
}

async function main() {
  await mkdir(VERSIONS_DIR, { recursive: true });
  console.log("Reading the Internet Archive and Arquivo.pt indexes…");
  const oldRows = await queryHost(OLD_HOST);
  const newRows = await queryHost(NEW_HOST);
  const arquivoCandidates = await queryArquivoCandidates();
  const cdnCandidates = [...groupVersions(oldRows, OLD_HOST), ...groupVersions(newRows, NEW_HOST)];
  const candidates = [...cdnCandidates, ...arquivoCandidates]
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const uniqueById = new Map();
  for (const candidate of candidates) if (!uniqueById.has(candidate.id)) uniqueById.set(candidate.id, candidate);

  // Discover additional UUIDs from wrapper page captures
  const existingIds = new Set([...uniqueById.keys()]);
  const wrapperDiscovered = await discoverUuidsFromWrapperPages(existingIds);
  for (const group of wrapperDiscovered) {
    // If we already have CDN rows for this UUID, prefer those (they have real timestamps per asset)
    if (!uniqueById.has(group.id)) uniqueById.set(group.id, group);
  }

  const unique = [...uniqueById.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const manifest = await readManifest();
  const latest = manifest.versions.filter((item) => item.latest).map((item) => {
    const archivedCapture = uniqueById.get(item.id);
    if (!archivedCapture) return item;
    const capturedAt = `${archivedCapture.capturedAt.slice(0, 4)}-${archivedCapture.capturedAt.slice(4, 6)}-${archivedCapture.capturedAt.slice(6, 8)}T${archivedCapture.capturedAt.slice(8, 10)}:${archivedCapture.capturedAt.slice(10, 12)}:${archivedCapture.capturedAt.slice(12, 14)}Z`;
    return { ...item, capturedAt, archiveSource: archivedCapture.archiveSource };
  });
  const latestIds = new Set(latest.map((item) => item.id));
  const toArchive = unique.filter((group) => !latestIds.has(group.id));
  const archived = [];
  if (toArchive.length > 0) {
    const wrapperCount = toArchive.filter((g) => g.archiveSource.includes("wrapper")).length;
    console.log(`  ${toArchive.length} candidate build(s) to investigate (${wrapperCount} from wrapper pages)`);
  }
  await mapLimit(toArchive, 2, async (group, index) => {
    const onDisk = await readExistingVersion(group);
    if (onDisk) {
      archived.push(onDisk);
      console.log(`[${index + 1}/${toArchive.length}] kept ${onDisk.label}`);
      return;
    }
    console.log(`[${index + 1}/${toArchive.length}] downloading ${formatArchiveLabel(group.capturedAt)} (${group.id})`);
    try {
      archived.push(await downloadVersion(group));
    } catch (error) {
      console.warn(`[${index + 1}/${toArchive.length}] unavailable for now: ${group.id} (${error.code ?? error.message})`);
    }
  });
  await writeManifest([...latest, ...archived]);
  console.log(`Archive ready: ${latest.length + archived.length} playable builds.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
