/**
 * Pipeline: scan -> diff -> analyze -> emit (with dry-run, emit-only, force).
 */

import type { PipelineOptions } from "./types";
import { loadConfig } from "./config";
import { scan } from "./scanner";
import { diff } from "./differ";
import { runAnalyze } from "./analyzer";
import { emit } from "./emitter";
import { loadOverrides } from "./overrides";
import { readCache, writeCache, removeCacheEntries } from "./cache";
import { analyzeFeatures, emitFeatureRules } from "./features";

export interface PipelineResult {
  scanResult?: import("./types").ScanResult;
  diffResult?: import("./types").DiffResult;
  cacheData?: import("./types").CacheData;
  dryRun?: boolean;
  emitOnly?: boolean;
  /** Estimated token count for dry-run (input). */
  estimatedInputTokens?: number;
  /** Estimated token count for dry-run (output). */
  estimatedOutputTokens?: number;
}

export async function runPipeline(
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const { config } = await loadConfig();
  const {
    targetPath,
    depth,
    dryRun = false,
    emitOnly = false,
    force = false,
    onProgress,
  } = options;

  if (emitOnly) {
    const cacheData = await readCache();
    if (!cacheData) {
      return { emitOnly: true };
    }
    const overrides = await loadOverrides();
    await emit({
      config,
      cacheData,
      overrides,
      dirsToDelete: [],
    });
    return { cacheData, emitOnly: true };
  }

  const scanResult = await scan({
    config,
    targetPath,
    depth,
  });

  let cacheData = await readCache();
  if (force && cacheData) {
    const toDelete = scanResult.dirPaths.filter(
      (p) => !scanResult.dirMap.has(p) || true,
    );
    cacheData = await removeCacheEntries(cacheData, []);
  }

  const diffResult = diff(scanResult, cacheData, { force });

  if (dryRun) {
    const toAnalyzeCount = diffResult.toAnalyze.length;
    let estimatedInput = 0;
    let estimatedOutput = 0;
    for (const dirPath of diffResult.toAnalyze) {
      const node = scanResult.dirMap.get(dirPath);
      if (node && !node.trivial) {
        const fileCount = node.children.filter((c) => c.kind === "file").length;
        estimatedInput += Math.min(fileCount * 500, 15000);
        estimatedOutput += 400;
      }
    }
    return {
      scanResult,
      diffResult,
      dryRun: true,
      estimatedInputTokens: estimatedInput,
      estimatedOutputTokens: estimatedOutput,
    };
  }

  if (diffResult.toAnalyze.length > 0 && config.provider.apiKey) {
    cacheData = await runAnalyze({
      config,
      diffResult,
      scanDirMap: scanResult.dirMap,
      cacheData,
      onProgress,
    });
  } else if (!cacheData && diffResult.toAnalyze.length > 0) {
    return {
      scanResult,
      diffResult,
      cacheData: undefined,
    };
  } else {
    cacheData = cacheData ?? (await readCache()) ?? undefined;
  }

  if (cacheData) {
    const overrides = await loadOverrides();
    await emit({
      config,
      cacheData,
      overrides,
      dirsToDelete: diffResult.toDelete,
    });

    const featureKeys = Object.keys(config.features ?? {});
    if (featureKeys.length > 0) {
      const featureContents = await analyzeFeatures(config);
      await emitFeatureRules(config, featureContents);
    }
  }

  return {
    scanResult,
    diffResult,
    cacheData,
  };
}
