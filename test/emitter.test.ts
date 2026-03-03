import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { emit } from "../src/emitter";
import type { CacheData, CodeMetaConfig, DirAnalysis } from "../src/types";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "emitter-root");

vi.mock("../src/constants", () => {
  const p = require("node:path");
  return { ROOT: p.join(__dirname, "fixtures", "emitter-root") };
});

const baseAnalysis: DirAnalysis = {
  summary: "目录摘要",
  businessDomain: "领域",
  scenarios: ["场景"],
  conventions: [],
  files: [{ name: "a.ts", purpose: "用途", exports: ["foo"] }],
  subdirs: [],
};

describe("emitter", () => {
  beforeEach(async () => {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
    } catch {}
  });

  it("writes .mdc files for each directory in cache", async () => {
    const config: CodeMetaConfig = {
      include: [],
      exclude: [],
      provider: { baseUrl: "", apiKey: "", model: "" },
      rules: {
        outputDir: ".cursor/rules/code-meta",
        maxRuleLength: 800,
        projectOverview: false,
      },
    };
    const cacheData: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        ".": {
          fingerprint: "fp",
          analyzedAt: "",
          analysis: baseAnalysis,
          files: {},
        },
      },
    };
    await emit({
      config,
      cacheData,
      overrides: {},
      dirsToDelete: [],
    });
    const outputDir = path.join(FIXTURE_ROOT, ".cursor", "rules", "code-meta");
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const mdc = entries.filter((e) => e.isFile() && e.name.endsWith(".mdc"));
    expect(mdc.length).toBeGreaterThanOrEqual(1);
    expect(mdc.some((e) => e.name === "_root.mdc")).toBe(true);
  });
});
