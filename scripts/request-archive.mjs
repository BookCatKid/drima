/**
 * Request the Wayback Machine to archive the current live game wrapper page
 * and CDN URLs. This ensures new builds get captured for future sync runs.
 *
 * Usage:  node scripts/request-archive.mjs
 *         pnpm request-archive
 *
 * The Save Page Now API is rate-limited; we keep one concurrent request at a time
 * and wait for each to complete before submitting the next.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GAME_ID, NEW_HOST } from "./archive-lib.mjs";

const execFileAsync = promisify(execFile);

const SPN_URL = "https://web.archive.org/save";
const USER_AGENT = "Mozilla/5.0 (compatible; Drive-Mad-Offline-Archiver; +https://github.com/simon/drive-mad-archive)";

const TARGETS = [
  // The Poki game wrapper page (embeds the live gameVersion UUID)
  `https://games.poki.com/458768/${GAME_ID}`,
  // The current CDN root (will save whatever version is currently live)
  `https://${NEW_HOST}/`,
];

async function requestSave(url) {
  console.log(`  Requesting archive: ${url}`);
  try {
    const { stdout, stderr } = await execFileAsync("curl", [
      "--compressed",
      "--retry", "2",
      "--connect-timeout", "30",
      "--max-time", "120",
      "-sS", "-L",
      "-H", `User-Agent: ${USER_AGENT}`,
      "-H", "Referer: https://poki.com/",
      "-d", `url=${encodeURIComponent(url)}`,
      SPN_URL,
    ]);
    // The Save Page Now API returns HTML; look for the job status or "captured" message
    if (stdout.includes("captured") || stdout.includes("Saved") || stdout.includes("success")) {
      console.log(`  -> Archive request accepted for ${url}`);
    } else {
      // Print a summary – the response is often HTML with a "Take Me Back" link
      const snippet = stdout.replace(/<[^>]*>/g, "").trim().slice(0, 200);
      if (snippet) console.log(`  -> ${snippet}`);
    }
    if (stderr) console.warn(`  -> stderr: ${stderr.slice(0, 200)}`);
  } catch (error) {
    // curl exits 56 (recv failure) or 22 (HTTP error) when SPN is rate-limiting.
    // This is normal – the API has aggressive rate limits.
    console.warn(`  -> Could not archive ${url}: ${error.code ?? error.message.slice(0, 100)}`);
  }
}

async function main() {
  console.log("Requesting Wayback Machine captures for live game URLs…");
  for (const url of TARGETS) {
    await requestSave(url);
    // Be polite – wait between requests
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log("Done. New captures may take hours to appear in the CDX index.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });