import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { emit } from "../src/emit/emitter";
import type { CacheData, CodeMetaConfig, DirAnalysis } from "../src/core/types";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "emitter-root");

vi.mock("../src/core/constants", () => {
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

  it("writes project-meta.json with directories and creates SKILL.md when missing", async () => {
    const config: CodeMetaConfig = {
      include: [],
      exclude: [],
      provider: { baseUrl: "", apiKey: "", model: "" },
      skill: {
        outputDir: ".cursor/skills/code-meta",
        metaFileName: "project-meta.json",
      },
    };
    const cacheData: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        src: {
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

    const metaPath = path.join(FIXTURE_ROOT, ".cursor", "skills", "code-meta", "project-meta.json");
    const raw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as { generatedAt: string; directories: Record<string, unknown> };
    expect(meta.generatedAt).toBeDefined();
    expect(meta.directories["src"]).toBeDefined();
    const srcEntry = meta.directories["src"] as { summary: string; files: Array<{ path: string; purpose: string; exports: string[] }> };
    expect(srcEntry.summary).toBe("目录摘要");
    expect(srcEntry.files).toHaveLength(1);
    expect(srcEntry.files[0]!.path).toBe("src/a.ts");
    expect(srcEntry.files[0]!.purpose).toBe("用途");
    expect(srcEntry.files[0]!.exports).toEqual(["foo"]);

    const skillMdPath = path.join(FIXTURE_ROOT, ".cursor", "skills", "code-meta", "SKILL.md");
    const skillMd = await fs.readFile(skillMdPath, "utf8");
    expect(skillMd).toContain("project-meta.json");
    expect(skillMd).toContain("code-meta");
  });

  it("does not overwrite existing SKILL.md", async () => {
    const skillDir = path.join(FIXTURE_ROOT, ".cursor", "skills", "code-meta");
    await fs.mkdir(skillDir, { recursive: true });
    const customContent = "---\nname: custom\n---\n# Custom SKILL";
    await fs.writeFile(path.join(skillDir, "SKILL.md"), customContent, "utf8");

    const config: CodeMetaConfig = {
      include: [],
      exclude: [],
      provider: { baseUrl: "", apiKey: "", model: "" },
      skill: { outputDir: ".cursor/skills/code-meta", metaFileName: "project-meta.json" },
    };
    const cacheData: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        src: {
          fingerprint: "fp",
          analyzedAt: "",
          analysis: baseAnalysis,
          files: {},
        },
      },
    };
    await emit({ config, cacheData, overrides: {}, dirsToDelete: [] });

    const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
    expect(skillMd).toBe(customContent);
  });

  it("includes features in project-meta.json when present in cache", async () => {
    const config: CodeMetaConfig = {
      include: [],
      exclude: [],
      provider: { baseUrl: "", apiKey: "", model: "" },
      skill: { outputDir: ".cursor/skills/code-meta", metaFileName: "project-meta.json" },
    };
    const cacheData: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        src: {
          fingerprint: "fp",
          analyzedAt: "",
          analysis: baseAnalysis,
          files: {},
        },
      },
      features: {
        auth: {
          description: "认证",
          globs: ["**/auth/**"],
          body: "认证模块说明",
        },
      },
    };
    await emit({ config, cacheData, overrides: {}, dirsToDelete: [] });

    const metaPath = path.join(FIXTURE_ROOT, ".cursor", "skills", "code-meta", "project-meta.json");
    const raw = await fs.readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as { features?: Record<string, { description: string }> };
    expect(meta.features).toBeDefined();
    expect(meta.features!["auth"]!.description).toBe("认证");
  });
});
