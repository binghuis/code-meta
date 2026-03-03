import { describe, it, expect } from "vitest";
import { diff } from "../src/differ";
import type { CacheData, DirNode, ScanResult } from "../src/types";

function makeScanResult(
  dirPaths: string[],
  allDirPaths?: string[],
  dirMap?: Map<string, DirNode>,
): ScanResult {
  const map = dirMap ?? new Map();
  const root: DirNode = {
    kind: "dir",
    name: ".",
    path: ".",
    fingerprint: "fp-root",
    children: [],
  };
  map.set(".", root);
  for (const p of dirPaths) {
    if (!map.has(p)) {
      map.set(p, {
        kind: "dir",
        name: p.split("/").pop() ?? p,
        path: p,
        fingerprint: `fp-${p}`,
        children: [],
      });
    }
  }
  return {
    root,
    allDirPaths: allDirPaths ?? dirPaths,
    dirPaths,
    dirMap: map,
  };
}

describe("differ", () => {
  it("marks all as modified when force=true", () => {
    const scan = makeScanResult(["a", "a/b"]);
    const cache: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        a: {
          fingerprint: "same",
          analyzedAt: "",
          analysis: {} as never,
          files: {},
        },
      },
    };
    const result = diff(scan, cache, { force: true });
    expect(result.toAnalyze).toContain("a");
    expect(result.toAnalyze).toContain("a/b");
    expect(result.toSkip).toHaveLength(0);
  });

  it("marks new dirs as toAnalyze, unchanged as toSkip", () => {
    const cache: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        a: {
          fingerprint: "fp-a",
          analyzedAt: "",
          analysis: {} as never,
          files: {},
        },
      },
    };
    const scanWithFp = makeScanResult(["a", "a/b"]);
    const nodeA = scanWithFp.dirMap.get("a")!;
    scanWithFp.dirMap.set("a", { ...nodeA, fingerprint: "fp-a" });
    const result = diff(scanWithFp, cache, {});
    expect(result.toAnalyze).toContain("a");
    expect(result.toAnalyze).toContain("a/b");
    expect(result.dirDiffs.get("a")!.status).toBe("modified");
  });

  it("includes toDelete when allowDelete and dir not in scan", () => {
    const scan = makeScanResult(["a"], ["a"]);
    const cache: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        a: { fingerprint: "x", analyzedAt: "", analysis: {} as never, files: {} },
        b: { fingerprint: "y", analyzedAt: "", analysis: {} as never, files: {} },
      },
    };
    const result = diff(scan, cache, { allowDelete: true });
    expect(result.toDelete).toContain("b");
  });

  it("no toDelete when allowDelete=false", () => {
    const scan = makeScanResult(["a"], ["a"]);
    const cache: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        b: { fingerprint: "y", analyzedAt: "", analysis: {} as never, files: {} },
      },
    };
    const result = diff(scan, cache, { allowDelete: false });
    expect(result.toDelete).toHaveLength(0);
  });

  it("no toDelete when scannedPaths is empty (empty scan)", () => {
    const scan = makeScanResult([], []);
    const cache: CacheData = {
      version: 1,
      createdAt: "",
      updatedAt: "",
      directories: {
        a: { fingerprint: "x", analyzedAt: "", analysis: {} as never, files: {} },
      },
    };
    const result = diff(scan, cache, { allowDelete: true });
    expect(result.toDelete).toHaveLength(0);
  });

  it("dirDiffs contains status for each dir", () => {
    const scan = makeScanResult(["a"]);
    const result = diff(scan, null, {});
    expect(result.dirDiffs.get("a")).toBeDefined();
    expect(result.dirDiffs.get("a")!.status).toBe("new");
  });
});
