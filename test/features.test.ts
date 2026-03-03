import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { analyzeFeatures, emitFeatureRules } from "../src/features";
import type { CodeMetaConfig } from "../src/types";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "features-root");

vi.mock("../src/constants", () => {
  const p = require("node:path");
  return { ROOT: p.join(__dirname, "fixtures", "features-root") };
});

const baseConfig: CodeMetaConfig = {
  include: [],
  exclude: [],
  provider: { baseUrl: "", apiKey: "", model: "" },
  rules: { outputDir: ".cursor/rules/code-meta" },
};

describe("features", () => {
  beforeEach(async () => {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
    } catch {}
  });

  describe("analyzeFeatures", () => {
    it("returns empty Map when config.features is empty", async () => {
      const result = await analyzeFeatures(baseConfig);
      expect(result.size).toBe(0);
    });

    it("returns placeholder when feature globs match no files", async () => {
      const config: CodeMetaConfig = {
        ...baseConfig,
        features: {
          noMatch: {
            globs: ["**/nonexistent-folder/**/*.ts"],
            description: "无匹配",
          },
        },
      };
      const result = await analyzeFeatures(config);
      expect(result.size).toBe(1);
      expect(result.get("noMatch")!.body).toContain("未匹配到文件");
    });
  });

  describe("emitFeatureRules", () => {
    it("writes one .mdc per feature", async () => {
      const contents = new Map([
        [
          "auth",
          {
            description: "认证",
            globs: ["**/auth/**"],
            body: "## 概述\n认证模块",
          },
        ],
      ]);
      await emitFeatureRules(baseConfig, contents);
      const outputDir = path.join(FIXTURE_ROOT, ".cursor", "rules", "code-meta");
      const entries = await fs.readdir(outputDir, { withFileTypes: true });
      const mdc = entries.filter((e) => e.isFile() && e.name.startsWith("_feature--"));
      expect(mdc.length).toBe(1);
      expect(mdc[0]!.name).toBe("_feature--auth.mdc");
    });
  });
});
