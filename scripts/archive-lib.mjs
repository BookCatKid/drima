import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const VERSIONS_DIR = path.join(ROOT, "public", "versions");
export const MANIFEST_PATH = path.join(VERSIONS_DIR, "manifest.json");
export const GAME_ID = "f9564e4e-ef25-4e4b-ba67-cb11a1576bbd";
export const OLD_HOST = `${GAME_ID}.poki-gdn.com`;
export const NEW_HOST = `${GAME_ID}.gdn.poki.com`;
export const REQUIRED = ["index.html", "webapp/fancade.css", "webapp/source_min.js", "webapp/index.js", "webapp/index.data", "webapp/index.wasm"];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(450 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? lastError}`);
}

export function patchIndexHtml(html) {
  const sdkPattern = /<script\b[^>]*\bsrc=["'][^"']*poki-sdk[^"']*["'][^>]*>\s*<\/script>/gi;
  const patched = html.replace(sdkPattern, '<script src="../../poki-sdk.js"></script>');
  return patched.includes("../../poki-sdk.js")
    ? patched
    : patched.replace(/<head([^>]*)>/i, '<head$1>\n<script src="../../poki-sdk.js"></script>');
}

export function patchSourceMinJs(src) {
  return src.startsWith("var pokiDebug=false")
    ? "var pokiDebug=true" + src.slice("var pokiDebug=false".length)
    : src;
}

export function formatArchiveLabel(timestamp, latest = false) {
  if (latest) return "Current Poki build";
  const date = new Date(`${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`);
  return `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)} archive`;
}

export async function readManifest() {
  try { return JSON.parse(await readFile(MANIFEST_PATH, "utf8")); }
  catch { return { updatedAt: new Date().toISOString(), versions: [] }; }
}

export async function writeManifest(versions) {
  await mkdir(VERSIONS_DIR, { recursive: true });
  const chronological = [...versions].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const enriched = [];
  for (const [index, version] of chronological.entries()) {
    const base = path.join(VERSIONS_DIR, version.id, "webapp");
    const [wasm, data] = await Promise.all([
      readFile(path.join(base, "index.wasm")),
      readFile(path.join(base, "index.data")),
    ]);
    const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
    const dataSha256 = createHash("sha256").update(data).digest("hex");
    const runtimeSha256 = createHash("sha256").update(wasm).update(data).digest("hex");
    const runtimeVersion = wasm.toString("latin1").match(/Fancade\s+([0-9]+(?:\.[0-9]+){1,3})/)?.[1] ?? null;
    enriched.push({
      ...version,
      archiveNumber: index + 1,
      runtimeVersion,
      wasmSha256,
      dataSha256,
      runtimeSha256,
    });
  }
  for (const version of enriched) {
    version.sameWasmAs = enriched.filter((other) => other.id !== version.id && other.wasmSha256 === version.wasmSha256).map((other) => other.archiveNumber);
    version.sameDataAs = enriched.filter((other) => other.id !== version.id && other.dataSha256 === version.dataSha256).map((other) => other.archiveNumber);
    version.sameRuntimeAs = enriched.filter((other) => other.id !== version.id && other.runtimeSha256 === version.runtimeSha256).map((other) => other.archiveNumber);
  }
  const sorted = enriched.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const newContent = `${JSON.stringify({ updatedAt: new Date().toISOString(), versions: sorted }, null, 2)}\n`;
  try {
    const existing = await readFile(MANIFEST_PATH, "utf8");
    const existingParsed = JSON.parse(existing);
    const newParsed = JSON.parse(newContent);
    if (JSON.stringify(existingParsed.versions) === JSON.stringify(newParsed.versions)) return;
  } catch { /* file doesn't exist yet, write it */ }
  await writeFile(MANIFEST_PATH, newContent);
}

export async function directoryStats(directory) {
  let bytes = 0;
  let fileCount = 0;
  async function walk(current) {
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else { bytes += (await stat(target)).size; fileCount += 1; }
    }
  }
  await walk(directory);
  return { bytes, fileCount };
}

export async function installDirectory(tempDirectory, finalDirectory) {
  await rm(finalDirectory, { recursive: true, force: true });
  await rename(tempDirectory, finalDirectory);
}

export const normalizeAssetPath = (original, versionId) => {
  const url = new URL(original);
  const marker = `/${versionId}/`;
  const index = url.pathname.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(url.pathname.slice(index + marker.length));
};
