import test from "node:test";
import assert from "node:assert/strict";
import { selectCarryForward, sourceDependency, INDEX_SOURCES } from "../scripts/archive-versions.mjs";

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
  const carried = await selectCarryForward(previous, keptIds, new Set(["arquivo"]), async (id) => onDisk.has(id));
  assert.deepEqual(carried.map((v) => v.id), ["a", "b"]);
  assert.ok(keptIds.has("a") && keptIds.has("b"));
});

test("drops entries whose files are gone from disk", async () => {
  const previous = [entry("a", "Arquivo.pt", OLD)];
  const carried = await selectCarryForward(previous, new Set(), new Set(), async () => false);
  assert.deepEqual(carried, []);
});

test("all-sources-degraded carries every intact non-latest entry", async () => {
  const previous = [
    entry("a", "Arquivo.pt", OLD),
    entry("b", "Internet Archive", OLD),
    entry("c", "Internet Archive", NEW),
  ];
  const carried = await selectCarryForward(previous, new Set(), new Set(INDEX_SOURCES), async () => true);
  assert.deepEqual(carried.map((v) => v.id).sort(), ["a", "b", "c"]);
});
