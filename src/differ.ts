/**
 * Stage 2: Compare scan result vs cache, mark dirs as unchanged/modified/new/deleted; bubble-up.
 */

import type {
  CacheData,
  DiffResult,
  DirDiff,
  DirStatus,
  ScanResult,
} from "./types";

export interface DifferOptions {
  force?: boolean;
  allowDelete?: boolean;
}

/**
 * Diff scanned tree against cache. When force is true, all scanned dirs are "modified".
 */
export function diff(
  scanResult: ScanResult,
  cache: CacheData | null,
  options: DifferOptions = {},
): DiffResult {
  const { force = false, allowDelete = true } = options;
  const dirDiffs = new Map<string, DirDiff>();
  const toAnalyze: string[] = [];
  const toSkip: string[] = [];
  const toDelete: string[] = [];

  const cachedDirs = cache?.directories ?? {};
  const scannedPaths = new Set(scanResult.allDirPaths);

  for (const dirPath of scanResult.dirPaths) {
    const node = scanResult.dirMap.get(dirPath);
    if (!node) continue;

    let status: DirStatus;
    if (force) {
      status = "modified";
    } else {
      const cached = cachedDirs[dirPath];
      if (!cached) {
        status = "new";
      } else if (cached.fingerprint !== node.fingerprint) {
        status = "modified";
      } else {
        status = "unchanged";
      }
    }

    dirDiffs.set(dirPath, { path: dirPath, status, node });
    if (status === "unchanged") {
      toSkip.push(dirPath);
    } else {
      toAnalyze.push(dirPath);
    }
  }

  if (allowDelete && scannedPaths.size > 0) {
    for (const dirPath of Object.keys(cachedDirs)) {
      if (!scannedPaths.has(dirPath)) {
        dirDiffs.set(dirPath, { path: dirPath, status: "deleted" });
        toDelete.push(dirPath);
      }
    }
  }

  const bubbleUp = new Set<string>(toAnalyze);
  for (const dirPath of toAnalyze) {
    const parts = dirPath.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (scannedPaths.has(ancestor) && !bubbleUp.has(ancestor)) {
        bubbleUp.add(ancestor);
        const existing = dirDiffs.get(ancestor);
        if (existing?.status === "unchanged") {
          const skipIdx = toSkip.indexOf(ancestor);
          if (skipIdx >= 0) toSkip.splice(skipIdx, 1);
          toAnalyze.push(ancestor);
          dirDiffs.set(ancestor, {
            ...existing,
            status: "modified",
            node: scanResult.dirMap.get(ancestor),
          });
        }
      }
    }
  }

  return {
    toAnalyze: [...new Set(toAnalyze)],
    toSkip,
    toDelete,
    dirDiffs,
  };
}
