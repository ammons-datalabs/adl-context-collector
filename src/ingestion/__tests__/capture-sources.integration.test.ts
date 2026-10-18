import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Runs against a real database because the defect is in what the SQL does, which the
// mocked suites cannot see. Point TEST_DATABASE_URL at a scratch database: it is truncated.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("../../services/embedder.js", () => ({
  generateEmbedding: async () => [0.1, 0.2, 0.3],
}));
vi.mock("../../services/metadata-extractor.js", () => ({
  extractMetadata: async () => null,
}));
vi.mock("../../config.js", () => ({
  loadConfig: () => ({ embedder: { url: "test", model: "test", dimensions: 3 } }),
}));

const section = (name: string) =>
  `## ${name}\n\n${`${name} is a section long enough to be its own chunk. `.repeat(6)}\n`;

describe.skipIf(!TEST_DATABASE_URL)("capture sources (real database)", () => {
  let db: typeof import("../../db.js");
  let ingestFile: typeof import("../index.js").ingestFile;
  let deleteBySource: typeof import("../cleanup.js").deleteBySource;
  let lockIndexWrites: typeof import("../cleanup.js").lockIndexWrites;
  let dir: string;

  const sql = async (text: string, params?: unknown[]) => (await db.query(text, params)).rows;
  const ownerOf = async (marker: string) =>
    (await sql("SELECT source_file FROM captures WHERE content LIKE $1", [`%${marker} is a section%`]))
      .map((r) => r.source_file);
  const recordedCount = async (path: string) =>
    (await sql("SELECT capture_count FROM sources WHERE file_path = $1", [path]))[0]?.capture_count;
  const linksOf = async (path: string) =>
    Number((await sql("SELECT count(*) AS n FROM capture_sources WHERE source_file = $1", [path]))[0].n);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("../../db.js");
    ({ ingestFile } = await import("../index.js"));
    ({ deleteBySource, lockIndexWrites } = await import("../cleanup.js"));
    await db.query(await readFile(join(__dirname, "../../../sql/schema.sql"), "utf-8"));
  });

  beforeEach(async () => {
    await db.query("TRUNCATE captures, sources RESTART IDENTITY CASCADE");
    dir = await mkdtemp(join(tmpdir(), "capture-sources-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await (await db.getPool()).end();
  });

  it("keeps a snapshot's chunks when the original is revised", async () => {
    const original = join(dir, "original.md");
    const snapshot = join(dir, "snapshot.md");
    await writeFile(original, section("Alpha") + section("Beta"));
    await writeFile(snapshot, section("Alpha") + section("Beta"));
    await ingestFile(original);
    await ingestFile(snapshot);

    await writeFile(original, section("Alpha") + section("Gamma"));
    await ingestFile(original);

    expect(await ownerOf("Alpha")).toEqual([original]);
    expect(await ownerOf("Beta")).toEqual([snapshot]);
    expect(await ownerOf("Gamma")).toEqual([original]);
    expect(await linksOf(snapshot)).toBe(2);
    expect(await recordedCount(snapshot)).toBe(2);
  });

  it("refreshes a kept shared capture's classification from its owner", async () => {
    const original = join(dir, "original.md");
    const copy = join(dir, "copy.md");
    const typed = (type: string) => `---\ntype: ${type}\n---\n\n` + section("Alpha") + section("Beta");
    await writeFile(original, typed("note"));
    await writeFile(copy, typed("note"));
    await ingestFile(original);
    await ingestFile(copy);

    await writeFile(original, typed("review"));
    await ingestFile(original);

    const [beta] = await sql("SELECT source_file, type FROM captures WHERE content LIKE '%Beta is a section%'");
    expect(beta).toEqual({ source_file: original, type: "review" });
  });

  it("keeps a moved file's chunks when the old path is deleted", async () => {
    const before = join(dir, "before.md");
    const after = join(dir, "after.md");
    await writeFile(before, section("Alpha") + section("Beta"));
    await writeFile(after, section("Alpha") + section("Beta"));
    await ingestFile(before);
    await ingestFile(after);

    await deleteBySource(before);

    expect(await ownerOf("Alpha")).toEqual([after]);
    expect(await ownerOf("Beta")).toEqual([after]);
    expect(await linksOf(after)).toBe(2);
  });

  it("waits for a concurrent ingest's link before releasing the owner", async () => {
    const before = join(dir, "before.md");
    const after = join(dir, "after.md");
    await writeFile(before, section("Alpha"));
    await ingestFile(before);

    const other = await (await db.getPool()).connect();
    try {
      await other.query("BEGIN");
      await lockIndexWrites(other);
      await other.query("INSERT INTO capture_sources (capture_id, source_file) SELECT id, $1 FROM captures", [after]);
      const deleting = deleteBySource(before);
      await new Promise((r) => setTimeout(r, 200));
      await other.query("COMMIT");
      await deleting;
    } finally {
      other.release();
    }

    expect(await ownerOf("Alpha")).toEqual([after]);
  });

  it("records one capture for a section repeated within a file", async () => {
    const repeated = join(dir, "repeated.md");
    await writeFile(repeated, section("Alpha") + section("Alpha"));
    await ingestFile(repeated);

    expect(await linksOf(repeated)).toBe(1);
    expect(await recordedCount(repeated)).toBe(1);
  });

  it("deletes captures and embeddings when their only file is deleted", async () => {
    const only = join(dir, "only.md");
    await writeFile(only, section("Alpha"));
    await ingestFile(only);

    await deleteBySource(only);

    expect(await sql("SELECT id FROM captures")).toEqual([]);
    expect(await sql("SELECT capture_id FROM capture_embeddings")).toEqual([]);
  });
});
