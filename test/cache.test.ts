import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import {
  readCache,
  writeCache,
  getCachePath,
  updateCacheWithAnalysis,
  CACHE_VERSION,
} from "../src/cache";
import type { CacheData, DirAnalysis, DirNode } from "../src/types";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "cache-root");

vi.mock("../src/constants", () => {
  const p = require("node:path");
  return { ROOT: p.join(__dirname, "fixtures", "cache-root") };
});

describe("cache", () => {
  beforeEach(async () => {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    const meta = path.join(FIXTURE_ROOT, ".code-meta");
    await fs.mkdir(meta, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(path.join(FIXTURE_ROOT, ".code-meta"), {
        recursive: true,
        force: true,
      });
    } catch {}
  });

  describe("getCachePath", () => {
    it("returns path under .code-meta/cache.json", () => {
      const p = getCachePath();
      expect(p).toContain(".code-meta");
      expect(p.endsWith("cache.json")).toBe(true);
    });
  });

  describe("readCache / writeCache", () => {
    it("returns null when file missing", async () => {
      const data = await readCache();
      expect(data).toBeNull();
    });

    it("writes and reads back cache", async () => {
      const data: CacheData = {
        version: CACHE_VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directories: {
          a: {
            fingerprint: "fp",
            analyzedAt: "",
            analysis: {} as DirAnalysis,
            files: {},
          },
        },
      };
      await writeCache(data);
      const read = await readCache();
      expect(read).not.toBeNull();
      expect(read!.version).toBe(CACHE_VERSION);
      const dirA = read!.directories["a"];
      expect(dirA).toBeDefined();
      expect(dirA!.fingerprint).toBe("fp");
      expect((read as { updatedAt?: string }).updatedAt).toBeDefined();
    });

    it("returns null when version mismatch", async () => {
      await fs.mkdir(path.dirname(getCachePath()), { recursive: true });
      await fs.writeFile(
        getCachePath(),
        JSON.stringify({ version: 999, directories: {} }),
        "utf8",
      );
      const read = await readCache();
      expect(read).toBeNull();
    });
  });

  describe("updateCacheWithAnalysis", () => {
    const node: DirNode = {
      kind: "dir",
      name: "a",
      path: "a",
      fingerprint: "fp-a",
      children: [
        {
          kind: "file",
          name: "f.ts",
          path: "a/f.ts",
          md5: "m1",
          size: 10,
          mtimeMs: 100,
          lines: 5,
        },
      ],
    };
    const analysis: DirAnalysis = {
      summary: "s",
      businessDomain: "d",
      scenarios: [],
      conventions: [],
      files: [{ name: "f.ts", purpose: "p", exports: [] }],
      subdirs: [],
    };

    it("creates new cache when null", () => {
      const out = updateCacheWithAnalysis(null, "a", node, analysis);
      expect(out.version).toBe(CACHE_VERSION);
      const dirA = out.directories["a"];
      expect(dirA).toBeDefined();
      expect(dirA!.files["f.ts"]).toEqual({
        md5: "m1",
        size: 10,
        mtimeMs: 100,
        lines: 5,
      });
    });

    it("mutates and returns existing cache when given", () => {
      const existing: CacheData = {
        version: CACHE_VERSION,
        createdAt: "",
        updatedAt: "",
        directories: {},
      };
      const out = updateCacheWithAnalysis(existing, "b", node, analysis);
      expect(out).toBe(existing);
      expect(out.directories["b"]).toBeDefined();
    });
  });
});
