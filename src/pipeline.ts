/**
 * Pipeline: scan -> diff -> analyze -> emit (with dry-run, emit-only, force).
 */

import type { CacheData, DiffResult, PipelineOptions, ScanResult } from "./core/types";
import type { CachedFileMeta } from "./scan/scanner";
import { consola } from "consola";
import { loadConfig } from "./core/config";
import { scan } from "./scan/scanner";
import { diff } from "./scan/differ";
import { runAnalyze } from "./analyze/analyzer";
import { emit } from "./emit/emitter";
import { loadOverrides } from "./data/overrides";
import { readCache, writeCache } from "./data/cache";
import { analyzeFeatures } from "./analyze/features";

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
  const overrides = await loadOverrides();
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
    await emit({
      config,
      cacheData,
      overrides,
    });
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
  // 有变更但无 API Key：无法分析，提前返回（避免产出过期元信息）
  } else if (diffResult.toAnalyze.length > 0 && !config.provider.apiKey) {
    consola.warn("检测到代码变更但未配置 API Key，已跳过元信息生成以避免产出过期内容。");
    if (cacheData && diffResult.toDelete.length > 0) {
      await emit({
        config,
        cacheData,
        overrides,
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
    await emit({
      config,
      cacheData,
      overrides,
    });

    if (diffResult.toDelete.length > 0) {
      await writeCache(cacheData);
    }

    const featureKeys = Object.keys(config.features ?? {});
    if (featureKeys.length > 0) {
      if (config.provider.apiKey) {
        const featureContents = await analyzeFeatures(config);
        cacheData.features = Object.fromEntries(featureContents);
        await writeCache(cacheData);
      } else if (!cacheData.features || Object.keys(cacheData.features).length === 0) {
        consola.warn("未配置 API Key 且无 feature 缓存，已跳过 feature 元信息生成。");
      }
    }
  }

  return {
    scanResult,
    diffResult,
    cacheData: cacheData ?? undefined,
  };
}
