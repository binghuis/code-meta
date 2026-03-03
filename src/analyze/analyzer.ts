/**
 * Stage 3: Bottom-up AI analysis with topological order and smart skip.
 */

import type {
  CacheData,
  CodeMetaConfig,
  DirAnalysis,
  DiffResult,
  FileNode,
  DirNode,
} from "../core/types";
import { consola } from "consola";
import pLimit from "p-limit";
import { chat, extractJsonFromModelResponse, type ChatMessage } from "../provider";
import { extractDirectoryContents } from "../scan/extractor";
import * as cache from "../data/cache";
import {
  getDirAnalysisJsonSchema,
  DirAnalysisSchema,
} from "./schema";

function trivialAnalysis(dirPath: string, node: DirNode): DirAnalysis {
  const fileNames = node.children
    .filter((c) => c.kind === "file")
    .map((c) => c.name);
  const subdirNames = node.children
    .filter((c) => c.kind === "dir")
    .map((c) => c.name);
  const reason = node.trivial ?? "too-small";
  const summary =
    reason === "barrel-only"
      ? "模块导出入口（barrel file）。"
      : reason === "type-only"
        ? "类型声明目录。"
        : "内容较少，未做详细分析。";
  return {
    summary,
    businessDomain: "基础设施",
    scenarios: [],
    conventions: [],
    files: fileNames.map((name) => ({ name, purpose: "", exports: [] })),
    subdirs: subdirNames.map((name) => ({ name, summary: "" })),
  };
}

/** Sort toAnalyze so that child dirs come before parents (deepest first). */
function topologicalOrder(toAnalyze: string[]): string[] {
  return [...toAnalyze].sort((a, b) => {
    const depthA = a.split("/").filter(Boolean).length;
    const depthB = b.split("/").filter(Boolean).length;
    return depthB - depthA;
  });
}

const ANALYZE_BATCH_SIZE = 4;

function groupByDepthDesc(paths: string[]): string[][] {
  const byDepth = new Map<number, string[]>();
  for (const p of paths) {
    const depth = p.split("/").filter(Boolean).length;
    const list = byDepth.get(depth) ?? [];
    list.push(p);
    byDepth.set(depth, list);
  }
  return [...byDepth.keys()]
    .sort((a, b) => b - a)
    .map((depth) => byDepth.get(depth)!);
}

async function analyzeOneDirectory(
  dirPath: string,
  node: DirNode,
  config: CodeMetaConfig,
  cacheSnapshot: CacheData | null,
): Promise<DirAnalysis | null> {
  if (node.trivial) {
    return trivialAnalysis(dirPath, node);
  }

  const files = node.children
    .filter((c): c is FileNode => c.kind === "file")
    .map((c) => ({ name: c.name, path: c.path }));
  const extracted = await extractDirectoryContents(files);

  const subdirNames = node.children
    .filter((c) => c.kind === "dir")
    .map((c) => c.name);
  const childSummaries: string[] = [];
  for (const name of subdirNames) {
    const childPath = dirPath === "." ? name : `${dirPath}/${name}`;
    const cached = cacheSnapshot?.directories[childPath];
    if (cached?.analysis?.summary) {
      childSummaries.push(`${name}: ${cached.analysis.summary}`);
    }
  }

  const filesSection = extracted
    .map(
      (f) =>
        `--- ${f.name} ---\n${f.content}${f.truncated ? "\n(已截断)" : ""}`,
    )
    .join("\n\n");

  const userContent = `目录路径：${dirPath}

直接子目录：${subdirNames.length ? subdirNames.join("、") : "无"}

${childSummaries.length ? "子目录摘要：\n" + childSummaries.join("\n") + "\n\n" : ""}该目录下文件内容（可能截断）：\n\n${filesSection}

请根据实际内容分析，按 JSON schema 输出：summary（目录职责）、businessDomain、scenarios、conventions、files（name/purpose/exports）、subdirs（name/summary）。全部中文。`;

  const systemContent =
    "你是前端项目结构分析助手。根据目录路径、子目录摘要和文件源码内容，输出结构化的目录描述。描述必须基于实际代码，不要编造。全部使用中文。";

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];

  try {
    const raw = await chat(config.provider, messages, {
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "dir_analysis",
          schema: getDirAnalysisJsonSchema(),
          strict: true,
        },
      },
    });
    const jsonStr = extractJsonFromModelResponse(raw);
    const parsed = JSON.parse(jsonStr) as unknown;
    return DirAnalysisSchema.parse(parsed) as DirAnalysis;
  } catch (err) {
    consola.warn(
      `分析目录失败 [${dirPath}]，本次跳过缓存写入:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export interface AnalyzeContext {
  config: CodeMetaConfig;
  diffResult: DiffResult;
  scanDirMap: Map<string, DirNode>;
  cacheData: CacheData | null;
  onProgress?: (current: number, total: number, path: string) => void;
}

export async function runAnalyze(ctx: AnalyzeContext): Promise<CacheData> {
  const { config, diffResult, scanDirMap, cacheData, onProgress } = ctx;
  const ordered = topologicalOrder(diffResult.toAnalyze);
  const layers = groupByDepthDesc(ordered);
  let currentCache = cacheData;
  const failedDirs: string[] = [];
  let progress = 0;
  const limit = pLimit(ANALYZE_BATCH_SIZE);

  for (const layer of layers) {
    const analyzed = await Promise.all(
      layer.map((dirPath) =>
        limit(async () => {
          progress++;
          onProgress?.(progress, ordered.length, dirPath);
          const node = scanDirMap.get(dirPath);
          if (!node) return null;
          const analysis = await analyzeOneDirectory(
            dirPath,
            node,
            config,
            currentCache,
          );
          if (!analysis) {
            failedDirs.push(dirPath);
            return null;
          }
          return { dirPath, node, analysis } as const;
        }),
      ),
    );

    for (const item of analyzed) {
      if (!item) continue;
      currentCache = cache.updateCacheWithAnalysis(
        currentCache,
        item.dirPath,
        item.node,
        item.analysis,
      );
    }
  }

  if (currentCache == null) {
    const now = new Date().toISOString();
    currentCache = {
      version: cache.CACHE_VERSION,
      createdAt: now,
      updatedAt: now,
      directories: {},
    };
  }
  if (failedDirs.length > 0) {
    consola.warn(`以下目录分析失败，后续运行会重试：${failedDirs.join(", ")}`);
  }
  await cache.writeCache(currentCache);
  return currentCache;
}
