import { describe, it, expect } from "vitest";
import {
  getMergedAnalysis,
  mergeOverride,
} from "../src/overrides";
import type { DirAnalysis, OverrideEntry, OverridesMap } from "../src/types";

const baseAnalysis: DirAnalysis = {
  summary: "原始摘要",
  businessDomain: "领域",
  scenarios: ["场景1"],
  conventions: ["约定1"],
  files: [
    { name: "a.ts", purpose: "用途", exports: ["foo"] },
  ],
  subdirs: [{ name: "sub", summary: "子目录" }],
};

describe("overrides", () => {
  describe("mergeOverride", () => {
    it("overwrites summary when provided", () => {
      const override: OverrideEntry = { summary: "新摘要" };
      const out = mergeOverride(baseAnalysis, override);
      expect(out.summary).toBe("新摘要");
      expect(out.businessDomain).toBe(baseAnalysis.businessDomain);
    });

    it("overwrites file purpose and exports", () => {
      const override: OverrideEntry = {
        files: [{ name: "a.ts", purpose: "新用途", exports: ["bar"] }],
      };
      const out = mergeOverride(baseAnalysis, override);
      expect(out.files[0]!.purpose).toBe("新用途");
      expect(out.files[0]!.exports).toEqual(["bar"]);
    });

    it("adds new file in override", () => {
      const override: OverrideEntry = {
        files: [{ name: "b.ts", purpose: "b", exports: [] }],
      };
      const out = mergeOverride(baseAnalysis, override);
      expect(out.files).toHaveLength(2);
      expect(out.files!.some((f) => f.name === "b.ts")).toBe(true);
    });

    it("overwrites subdir summary", () => {
      const override: OverrideEntry = {
        subdirs: [{ name: "sub", summary: "新子目录摘要" }],
      };
      const out = mergeOverride(baseAnalysis, override);
      const sub = out.subdirs.find((s) => s.name === "sub");
      expect(sub?.summary).toBe("新子目录摘要");
    });
  });

  describe("getMergedAnalysis", () => {
    it("returns analysis when no override for dir", () => {
      const overrides: OverridesMap = {};
      const out = getMergedAnalysis("some/dir", baseAnalysis, overrides);
      expect(out).toBe(baseAnalysis);
    });

    it("returns merged when override exists", () => {
      const overrides: OverridesMap = {
        "some/dir": { summary: "覆盖摘要" },
      };
      const out = getMergedAnalysis("some/dir", baseAnalysis, overrides);
      expect(out.summary).toBe("覆盖摘要");
    });
  });
});
