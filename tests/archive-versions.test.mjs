import test from "node:test";
import assert from "node:assert/strict";
import { groupVersions, selectCarryForward, sourceDependency, INDEX_SOURCES } from "../scripts/archive-versions.mjs";

const entry = (id, archiveSource, sourceHost) => ({ id, archiveSource, sourceHost, latest: false });
const OLD = "f9564e4e-ef25-4e4b-ba67-cb11a1576bbd.poki-gdn.com";
const NEW = "f9564e4e-ef25-4e4b-ba67-cb11a1576bbd.gdn.poki.com";

test("sourceDependency maps archive sources and hosts", () => {
  assert.equal(sourceDependency(entry("a", "Arquivo.pt", OLD)), "arquivo");
  assert.equal(sourceDependency(entry("b", "Internet Archive", OLD)), "wayback-old");
  assert.equal(sourceDependency(entry("c", "Internet Archive", NEW)), "wayback-new");
  assert.equal(sourceDependency(entry("d", "Internet Archive (wrapper)", OLD)), "wayback-old");
  assert.equal(sourceDependency(entry("e", undefined, NEW)), "wayback-new");
  assert.equal(sourceDependency(entry("f", undefined, undefined)), "wayback-new");
});

test("carries forward intact entries for degraded sources and for healthy sources that dropped them", async () => {
  const previous = [
    entry("a", "Arquivo.pt", OLD),        // source degraded, on disk -> carry
    entry("b", "Internet Archive", OLD),  // healthy source but vanished from results, on disk -> carry
    entry("c", "Internet Archive", NEW),  // vanished but NOT intact on disk -> drop
    { ...entry("e", "Arquivo.pt", OLD), latest: true }, // latest entries handled separately
  ];
  const keptIds = new Set(["x"]);
  const onDisk = new Set(["a", "b"]);
  const carried = await selectCarryForward(previous, keptIds, new Set(["arquivo"]), new Set(), async (id) => onDisk.has(id));
  assert.deepEqual(carried.map((v) => v.id), ["a", "b"]);
  assert.ok(keptIds.has("a") && keptIds.has("b"));
});

test("drops entries whose files are gone from disk", async () => {
  const previous = [entry("a", "Arquivo.pt", OLD)];
  const carried = await selectCarryForward(previous, new Set(), new Set(), new Set(), async () => false);
  assert.deepEqual(carried, []);
});

test("all-sources-degraded carries every intact non-latest entry", async () => {
  const previous = [
    entry("a", "Arquivo.pt", OLD),
    entry("b", "Internet Archive", OLD),
    entry("c", "Internet Archive", NEW),
  ];
  const carried = await selectCarryForward(previous, new Set(), new Set(INDEX_SOURCES), new Set(), async () => true);
  assert.deepEqual(carried.map((v) => v.id).sort(), ["a", "b", "c"]);
});

const cdxRow = (original, timestamp = "20250106201600") => ({ timestamp, original, statuscode: "200", digest: "x", length: "1" });
const buildUrl = (id, asset) => `https://${OLD}/${id}/${asset}`;
const REQUIRED_ASSETS = ["index.html", "webapp/fancade.css", "webapp/source_min.js", "webapp/index.js", "webapp/index.data", "webapp/index.wasm"];

test("groupVersions drops captures nested under a file asset (EISDIR collision)", () => {
  const id = "cc1bc57a-e355-4696-97c2-097bf6188606";
  const rows = [
    ...REQUIRED_ASSETS.map((asset) => cdxRow(buildUrl(id, asset))),
    // Real CDX rows for cc1bc57a include this savegame-shim capture nested under index.html;
    // mkdir of its dirname collided with the index.html file (EISDIR) in run 41553532077.
    cdxRow(buildUrl(id, "index.html/poki-savegame-safarisavegame.html")),
  ];
  const groups = groupVersions(rows, OLD);
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0].rows.keys()].sort(), REQUIRED_ASSETS.sort());
});

test("groupVersions keeps a required nested asset over a colliding non-required parent", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const rows = [
    ...REQUIRED_ASSETS.map((asset) => cdxRow(buildUrl(id, asset))),
    cdxRow(buildUrl(id, "webapp")), // non-required parent colliding with webapp/* files
  ];
  const groups = groupVersions(rows, OLD);
  assert.equal(groups.length, 1);
  assert.ok(!groups[0].rows.has("webapp"));
  assert.ok(groups[0].rows.has("webapp/index.js"));
});

test("carry-forward reason distinguishes failed downloads from index absence", async () => {
  const previous = [
    entry("a", "Internet Archive", OLD), // download failed this run
    entry("b", "Internet Archive", OLD), // absent from index results
  ];
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    const carried = await selectCarryForward(previous, new Set(), new Set(), new Set(["a"]), async () => true);
    assert.deepEqual(carried.map((v) => v.id), ["a", "b"]);
  } finally {
    console.log = originalLog;
  }
  assert.ok(lines.some((line) => line.includes("a (download failed this run)")));
  assert.ok(lines.some((line) => line.includes("b (absent from this run's index results)")));
});
