import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { scan } from "../src/scanner";
import type { CodeMetaConfig } from "../src/types";

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "scanner-root");

vi.mock("../src/constants", () => {
  const p = require("node:path");
  return { ROOT: p.join(__dirname, "fixtures", "scanner-root") };
});

const baseConfig: CodeMetaConfig = {
  include: ["src"],
  exclude: ["node_modules", "dist", ".git"],
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx"],
  provider: {
    baseUrl: "",
    apiKey: "",
    model: "",
  },
  rules: {},
};

describe("scanner", () => {
  beforeEach(async () => {
    await fs.mkdir(FIXTURE_ROOT, { recursive: true });
    await fs.mkdir(path.join(FIXTURE_ROOT, "src"), { recursive: true });
    await fs.writeFile(
      path.join(FIXTURE_ROOT, "src", "index.ts"),
      "export const x = 1;",
      "utf8",
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(FIXTURE_ROOT, { recursive: true, force: true });
    } catch {}
  });

  it("returns scan result with root, dirPaths, allDirPaths, dirMap", async () => {
    const result = await scan({ config: baseConfig });
    expect(result.root).not.toBeNull();
    expect(result.dirPaths).toContain(".");
    expect(result.allDirPaths).toContain(".");
    expect(result.dirMap.get(".")).toBeDefined();
    expect(result.dirMap.get(".")!.fingerprint).toBeDefined();
  });

  it("filters by targetPath when provided", async () => {
    await fs.mkdir(path.join(FIXTURE_ROOT, "src", "a"), { recursive: true });
    await fs.writeFile(
      path.join(FIXTURE_ROOT, "src", "a", "b.ts"),
      "export const b = 1;",
      "utf8",
    );
    const result = await scan({
      config: baseConfig,
      targetPath: "src/a",
    });
    expect(result.dirPaths.every((p) => p === "src/a" || p.startsWith("src/a/"))).toBe(true);
  });

  it("filters by depth when provided", async () => {
    await fs.mkdir(path.join(FIXTURE_ROOT, "src", "a"), { recursive: true });
    await fs.writeFile(
      path.join(FIXTURE_ROOT, "src", "a", "b.ts"),
      "export const b = 1;",
      "utf8",
    );
    const result = await scan({
      config: baseConfig,
      depth: 1,
    });
    const depths = result.dirPaths.map((p) => p.split("/").filter(Boolean).length);
    expect(depths.every((d) => d <= 1)).toBe(true);
  });
});
