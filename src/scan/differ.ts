/**
 * Incremental diff: compare scan results against cache at slice / direct-layer granularity.
 */

import type { CacheData, FsdDiffResult, FsdScanResult } from "../core/types";

export interface DifferOptions {
  force?: boolean;
  /** When false (scoped run), skip deletion of entries outside scope. */
  allowDelete?: boolean;
}

export function diff(
  scanResult: FsdScanResult,
  cache: CacheData | null,
  options: DifferOptions = {},
): FsdDiffResult {
  const { force = false, allowDelete = true } = options;

  const toAnalyze: string[] = [];
  const toSkip: string[] = [];
  const toDelete: string[] = [];

  const scannedTargets = new Set(scanResult.analysisTargets);

  for (const targetPath of scanResult.analysisTargets) {
    const node = scanResult.nodeMap.get(targetPath);
    if (!node) continue;

    if (force) {
      toAnalyze.push(targetPath);
      continue;
    }

    const cached = cache?.entries[targetPath];
    if (!cached) {
      toAnalyze.push(targetPath);
    } else if (cached.fingerprint !== node.fingerprint) {
      toAnalyze.push(targetPath);
    } else {
      toSkip.push(targetPath);
    }
  }

  if (allowDelete && cache) {
    for (const cachedPath of Object.keys(cache.entries)) {
      if (!scannedTargets.has(cachedPath)) {
        toDelete.push(cachedPath);
      }
    }
  }

  return { toAnalyze, toSkip, toDelete };
}
