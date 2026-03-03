import { describe, it, expect } from "vitest";
import { buildFrontmatter } from "../src/frontmatter";

describe("frontmatter", () => {
  describe("buildFrontmatter", () => {
    it("serializes object to YAML string", () => {
      const out = buildFrontmatter({ description: "test", globs: ["**/*"] });
      expect(out).toContain("description");
      expect(out).toContain("test");
      expect(out).toContain("globs");
    });

    it("returns trimmed string", () => {
      const out = buildFrontmatter({ a: 1 });
      expect(out).toBe(out.trim());
      expect(out.endsWith("\n")).toBe(false);
    });

    it("handles nested objects", () => {
      const out = buildFrontmatter({
        description: "d",
        meta: { key: "value" },
      });
      expect(out).toContain("meta");
      expect(out).toContain("key");
    });
  });
});
