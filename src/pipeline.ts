/**
 * Pipeline: scan -> diff -> analyze -> emit (with dry-run, emit-only, force).
 */

import type { CacheData, DiffResult, PipelineOptions, ScanResult } from "./types";
import type { CachedFileMeta } from "./scanner";
import { consola } from "consola";
import { loadConfig } from "./config";
import { scan } from "./scanner";
import { diff } from "./differ";
import { runAnalyze } from "./analyzer";
import { emit } from "./emitter";
import { loadOverrides } from "./overrides";
import { readCache, writeCache } from "./cache";
import { analyzeFeatures, emitFeatureRules } from "./features";

export interface PipelineResult {
  scanResult?: ScanResult;
  diffResult?: DiffResult;
  cacheData?: CacheData;
  dryRun?: boolean;
  emitOnly?: boolean;
  /** Estimated token count for dry-run (input). */
  estimatedInputTokens?: number;
  /** Estimated token count for dry-run (output). */
  estimatedOutputTokens?: number;
}

function buildCachedFileMetaIndex(cacheData: CacheData | null): Map<string, CachedFileMeta> {
  const index = new Map<string, CachedFileMeta>();
  if (!cacheData) return index;
  for (const [dirPath, dirEntry] of Object.entries(cacheData.directories)) {
    for (const [name, file] of Object.entries(dirEntry.files)) {
      const relPath = dirPath === "." ? name : `${dirPath}/${name}`;
      index.set(relPath, {
        md5: file.md5,
        size: file.size,
        mtimeMs: file.mtimeMs,
        lines: file.lines,
      });
    }
  }
  return index;
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
    if (cacheData.features && Object.keys(cacheData.features).length > 0) {
      const featureContents = new Map(Object.entries(cacheData.features));
      await emitFeatureRules(config, featureContents);
    }
    return { cacheData, emitOnly: true };
  }

  let cacheData = await readCache();
  if (force) {
    cacheData = null;
  }
  const cachedFileMeta = buildCachedFileMetaIndex(cacheData);

  const scanResult = await scan({
    config,
    targetPath,
    depth,
    cachedFileMeta,
  });

  const scopedRun = targetPath != null || depth !== undefined;
  const diffResult = diff(scanResult, cacheData, {
    force,
    allowDelete: !scopedRun,
  });

  if (dryRun) {
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

  if (cacheData && diffResult.toDelete.length > 0) {
    for (const dirPath of diffResult.toDelete) {
      delete cacheData.directories[dirPath];
    }
  }

  // 有变更且有 API Key：调 AI 分析
  if (diffResult.toAnalyze.length > 0 && config.provider.apiKey) {
    cacheData = await runAnalyze({
      config,
      diffResult,
      scanDirMap: scanResult.dirMap,
      cacheData,
      onProgress,
    });
  // 有变更但无 API Key：无法分析，提前返回（避免输出过期规则）
  } else if (diffResult.toAnalyze.length > 0 && !config.provider.apiKey) {
    consola.warn("检测到代码变更但未配置 API Key，已跳过规则生成以避免产出过期规则。");
    if (cacheData && diffResult.toDelete.length > 0) {
      const overrides = await loadOverrides();
      await emit({
        config,
        cacheData,
        overrides,
        dirsToDelete: diffResult.toDelete,
      });
      await writeCache(cacheData);
    }
    return {
      scanResult,
      diffResult,
      cacheData: cacheData ?? undefined,
    };
  // 无变更或已分析完：复用现有 cache
  } else {
    // cacheData 已由上文赋值，无需 readCache()
  }

  if (cacheData) {
    const overrides = await loadOverrides();
    await emit({
      config,
      cacheData,
      overrides,
      dirsToDelete: diffResult.toDelete,
    });

    if (diffResult.toDelete.length > 0) {
      await writeCache(cacheData);
    }

    const featureKeys = Object.keys(config.features ?? {});
    if (featureKeys.length > 0) {
      if (config.provider.apiKey) {
        const featureContents = await analyzeFeatures(config);
        await emitFeatureRules(config, featureContents);
        cacheData.features = Object.fromEntries(featureContents);
        await writeCache(cacheData);
      } else if (cacheData.features && Object.keys(cacheData.features).length > 0) {
        await emitFeatureRules(config, new Map(Object.entries(cacheData.features)));
      } else {
        consola.warn("未配置 API Key 且无 feature 缓存，已跳过 feature rules 生成。");
      }
    }
  }

  return {
    scanResult,
    diffResult,
    cacheData: cacheData ?? undefined,
  };
}
