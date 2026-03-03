import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { extractFileContent, extractDirectoryContents } from "../src/extractor";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "extractor-root");

vi.mock("../src/constants", () => {
  const p = require("node:path");
  return { ROOT: p.join(__dirname, "fixtures", "extractor-root") };
});

describe("extractor", () => {
  beforeEach(async () => {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
    } catch {}
  });

  describe("extractFileContent", () => {
    it("returns (无法读取) for missing file", async () => {
      const out = await extractFileContent("nonexistent.ts", 1000);
      expect(out.content).toBe("(无法读取)");
      expect(out.truncated).toBe(false);
    });

    it("extracts content and respects budget", async () => {
      const rel = "f.ts";
      const content = "export function foo() { return 1; }\n".repeat(100);
      await fs.writeFile(path.join(FIXTURE_ROOT, rel), content, "utf8");
      const out = await extractFileContent(rel, 50);
      expect(out.content.length).toBeLessThanOrEqual(50);
      expect(out.truncated).toBe(true);
    });

    it("includes leading comment when present", async () => {
      const rel = "comment.ts";
      const content = "/**\n * Doc\n */\nexport const x = 1;";
      await fs.writeFile(path.join(FIXTURE_ROOT, rel), content, "utf8");
      const out = await extractFileContent(rel, 500);
      expect(out.content).toContain("Doc");
      expect(out.content).toContain("x");
    });
  });

  describe("extractDirectoryContents", () => {
    it("returns empty when files empty", async () => {
      const out = await extractDirectoryContents([], 1000, 5000);
      expect(out).toHaveLength(0);
    });

    it("extracts multiple files and truncates by maxTotal", async () => {
      await fs.mkdir(path.join(FIXTURE_ROOT, "a"), { recursive: true });
      await fs.writeFile(
        path.join(FIXTURE_ROOT, "a", "one.ts"),
        "export const one = 1;",
        "utf8",
      );
      await fs.writeFile(
        path.join(FIXTURE_ROOT, "a", "two.ts"),
        "export const two = 2;",
        "utf8",
      );
      const files = [
        { name: "one.ts", path: "a/one.ts" },
        { name: "two.ts", path: "a/two.ts" },
      ];
      const out = await extractDirectoryContents(files, 1000, 20);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out[0]!.name).toBe("one.ts");
      const total = out.reduce((s, e) => s + e.content.length, 0);
      expect(total).toBeLessThanOrEqual(20 + 50);
    });
  });
});
