/**
 * Pipeline: detect → scan → diff → analyze → emit.
 */

import type { CacheData, FsdDiffResult, FsdScanResult, PipelineOptions, PipelineResult } from "./core/types";
import type { CachedFileMeta } from "./scan/scanner";

import { consola } from "consola";

import { loadConfig } from "./core/config";
import { detectFsdStructure } from "./fsd/detect";
import { scan } from "./scan/scanner";
import { diff } from "./scan/differ";
import { runAnalyze } from "./analyze/analyzer";
import { emit } from "./emit/emitter";
import { loadOverrides } from "./data/overrides";
import { readCache, writeCache } from "./data/cache";

export type { PipelineResult };

function buildCachedFileMetaIndex(cacheData: CacheData | null): Map<string, CachedFileMeta> {
  const index = new Map<string, CachedFileMeta>();
  if (!cacheData) return index;
  for (const [, entry] of Object.entries(cacheData.entries)) {
    for (const [name, file] of Object.entries(entry.files)) {
      index.set(name, {
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
    dryRun = false,
    emitOnly = false,
    force = false,
    onProgress,
  } = options;

  const srcRoot = config.srcRoot ?? "src";

  // ── emit-only: skip everything, just regenerate from cache ────
  if (emitOnly) {
    const cacheData = await readCache();
    if (!cacheData) {
      return { emitOnly: true };
    }
    await emit({ config, cacheData, overrides });
    return { cacheData, emitOnly: true };
  }

  // ── detect FSD structure ──────────────────────────────────────
  const fsdStructure = await detectFsdStructure(process.cwd(), srcRoot);

  // ── scan ──────────────────────────────────────────────────────
  let cacheData = await readCache();
  if (force) cacheData = null;

  const cachedFileMeta = buildCachedFileMetaIndex(cacheData);
  const scanResult: FsdScanResult = await scan({
    config,
    fsdStructure,
    targetPath,
    cachedFileMeta,
  });

  // ── diff ──────────────────────────────────────────────────────
  const scopedRun = targetPath != null;
  const diffResult: FsdDiffResult = diff(scanResult, cacheData, {
    force,
    allowDelete: !scopedRun,
  });

  // ── dry-run ───────────────────────────────────────────────────
  if (dryRun) {
    let estimatedInput = 0;
    let estimatedOutput = 0;
    for (const t of diffResult.toAnalyze) {
      const node = scanResult.nodeMap.get(t);
      if (node) {
        const fileCount = node.children.filter((c) => c.kind === "file").length +
          node.children
            .filter((c) => c.kind === "segment")
            .reduce((sum, seg) => sum + (seg as { children: unknown[] }).children.length, 0);
        estimatedInput += Math.min(fileCount * 500, 15_000);
        estimatedOutput += 500;
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

  // ── delete stale entries ──────────────────────────────────────
  if (cacheData && diffResult.toDelete.length > 0) {
    for (const p of diffResult.toDelete) {
      delete cacheData.entries[p];
    }
  }

  // ── analyze ───────────────────────────────────────────────────
  if (diffResult.toAnalyze.length > 0 && config.provider.apiKey) {
    cacheData = await runAnalyze({
      config,
      diffResult,
      scanResult,
      cacheData,
      onProgress,
    });
  } else if (diffResult.toAnalyze.length > 0 && !config.provider.apiKey) {
    consola.warn("检测到代码变更但未配置 API Key，已跳过分析。");
    if (cacheData && diffResult.toDelete.length > 0) {
      await emit({ config, cacheData, overrides });
      await writeCache(cacheData);
    }
    return { scanResult, diffResult, cacheData: cacheData ?? undefined };
  }

  // ── emit ──────────────────────────────────────────────────────
  if (cacheData) {
    await emit({ config, cacheData, overrides });
    if (diffResult.toDelete.length > 0) {
      await writeCache(cacheData);
    }
  }

  return { scanResult, diffResult, cacheData: cacheData ?? undefined };
}
