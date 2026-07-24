import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionsDir = join(__dirname, "..", "public", "versions");

let patched = 0;

for (const entry of readdirSync(versionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(versionsDir, entry.name, "webapp", "source_min.js");
  let src;
  try { src = readFileSync(path, "utf8"); } catch { continue; }
  if (!src.startsWith("var pokiDebug=false")) {
    console.log(`  Skipped: ${entry.name} (unexpected format)`);
    continue;
  }
  const updated = "var pokiDebug=true" + src.slice("var pokiDebug=false".length);
  writeFileSync(path, updated, "utf8");
  console.log(`  Patched: ${entry.name}`);
  patched++;
}

console.log(`\nDone. ${patched} builds patched.`);