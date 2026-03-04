/**
 * FSD-aware analyzer: dispatch analysis by FSD role (slice vs direct-layer).
 */

import type { CacheData, CodeMetaConfig, FsdDiffResult, FsdFileNode, FsdScanResult, FsdTreeNode } from "../core/types";
import type { AnalysisResult, FsdLayer, LayerDirectAnalysis, SliceAnalysis } from "../fsd/types";

import { consola } from "consola";
import pLimit from "p-limit";

import { SLICED_LAYERS } from "../fsd/types";
import {
  directLayerSystemPrompt,
  directLayerUserPrompt,
  sliceSystemPrompt,
  sliceUserPrompt,
} from "../fsd/prompts";
import { chat, extractJsonFromModelResponse, type ChatMessage } from "../provider";
import { extractDirectoryContents, extractPublicApi } from "../scan/extractor";
import {
  getLayerDirectJsonSchema,
  getSliceJsonSchema,
  LayerDirectAnalysisSchema,
  SliceAnalysisSchema,
} from "./schema";
import * as cache from "../data/cache";

const CONCURRENCY = 4;
const INDEX_NAMES = new Set([
  "index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs",
]);

// ── helpers ─────────────────────────────────────────────────────

function collectFiles(node: FsdTreeNode): FsdFileNode[] {
  const files: FsdFileNode[] = [];
  for (const child of node.children) {
    if (child.kind === "file") {
      files.push(child);
    } else {
      files.push(...collectFiles(child));
    }
  }
  return files;
}

function getSegmentNodes(node: FsdTreeNode): FsdTreeNode[] {
  return node.children.filter((c): c is FsdTreeNode => c.kind === "segment");
}

function findIndexFile(node: FsdTreeNode): FsdFileNode | undefined {
  return node.children.find(
    (c): c is FsdFileNode => c.kind === "file" && INDEX_NAMES.has(c.name),
  );
}

async function buildFilesSection(node: FsdTreeNode): Promise<string> {
  const segments = getSegmentNodes(node);
  const parts: string[] = [];

  for (const seg of segments) {
    const files = collectFiles(seg).map((f) => ({ name: f.name, path: f.path }));
    const extracted = await extractDirectoryContents(files);
    for (const f of extracted) {
      parts.push(`--- [${seg.name}] ${f.name} ---\n${f.content}${f.truncated ? "\n(已截断)" : ""}`);
    }
  }

  const rootFiles = node.children
    .filter((c): c is FsdFileNode => c.kind === "file")
    .map((f) => ({ name: f.name, path: f.path }));
  if (rootFiles.length > 0) {
    const extracted = await extractDirectoryContents(rootFiles);
    for (const f of extracted) {
      parts.push(`--- [root] ${f.name} ---\n${f.content}${f.truncated ? "\n(已截断)" : ""}`);
    }
  }

  return parts.join("\n\n");
}

// ── slice analysis ──────────────────────────────────────────────

async function analyzeSlice(
  node: FsdTreeNode,
  config: CodeMetaConfig,
): Promise<SliceAnalysis | null> {
  const layer = node.fsd.layer;
  const sliceName = node.fsd.slice!;
  const segmentNames = getSegmentNodes(node).map((s) => s.name);
  const filesSection = await buildFilesSection(node);

  const indexFile = findIndexFile(node);
  const publicApiNames = indexFile ? await extractPublicApi(indexFile.path) : [];

  const messages: ChatMessage[] = [
    { role: "system", content: sliceSystemPrompt(layer) },
    { role: "user", content: sliceUserPrompt(layer, sliceName, segmentNames, filesSection, publicApiNames) },
  ];

  try {
    const raw = await chat(config.provider, messages, {
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "slice_analysis", schema: getSliceJsonSchema(), strict: true },
      },
    });
    const jsonStr = extractJsonFromModelResponse(raw);
    return SliceAnalysisSchema.parse(JSON.parse(jsonStr)) as SliceAnalysis;
  } catch (err) {
    consola.warn(
      `分析切片失败 [${layer}/${sliceName}]:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ── direct-layer analysis (app / shared) ────────────────────────

async function analyzeDirectLayer(
  node: FsdTreeNode,
  config: CodeMetaConfig,
): Promise<LayerDirectAnalysis | null> {
  const layer = node.fsd.layer;
  const segmentNames = getSegmentNodes(node).map((s) => s.name);
  const filesSection = await buildFilesSection(node);

  const messages: ChatMessage[] = [
    { role: "system", content: directLayerSystemPrompt(layer) },
    { role: "user", content: directLayerUserPrompt(layer, segmentNames, filesSection) },
  ];

  try {
    const raw = await chat(config.provider, messages, {
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "layer_analysis", schema: getLayerDirectJsonSchema(), strict: true },
      },
    });
    const jsonStr = extractJsonFromModelResponse(raw);
    return LayerDirectAnalysisSchema.parse(JSON.parse(jsonStr)) as LayerDirectAnalysis;
  } catch (err) {
    consola.warn(
      `分析层失败 [${layer}]:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ── orchestrator ────────────────────────────────────────────────

export interface AnalyzeContext {
  config: CodeMetaConfig;
  diffResult: FsdDiffResult;
  scanResult: FsdScanResult;
  cacheData: CacheData | null;
  onProgress?: (current: number, total: number, path: string) => void;
}

/**
 * Run analysis on all targets, respecting FSD layer order (bottom-up: shared first).
 */
export async function runAnalyze(ctx: AnalyzeContext): Promise<CacheData> {
  const { config, diffResult, scanResult, cacheData, onProgress } = ctx;
  const targets = diffResult.toAnalyze;

  const layerOrder: FsdLayer[] = ["shared", "entities", "features", "widgets", "pages", "app"];
  const sorted = [...targets].sort((a, b) => {
    const nodeA = scanResult.nodeMap.get(a);
    const nodeB = scanResult.nodeMap.get(b);
    const idxA = nodeA ? layerOrder.indexOf(nodeA.fsd.layer) : 99;
    const idxB = nodeB ? layerOrder.indexOf(nodeB.fsd.layer) : 99;
    if (idxA !== idxB) return idxA - idxB;
    return a.localeCompare(b);
  });

  const limit = pLimit(CONCURRENCY);
  let currentCache = cacheData;
  const failedPaths: string[] = [];
  let progress = 0;

  // Group by layer so we can process bottom-up, one layer at a time
  const byLayer = new Map<FsdLayer, string[]>();
  for (const t of sorted) {
    const node = scanResult.nodeMap.get(t);
    if (!node) continue;
    const layer = node.fsd.layer;
    const list = byLayer.get(layer) ?? [];
    list.push(t);
    byLayer.set(layer, list);
  }

  for (const layer of layerOrder) {
    const paths = byLayer.get(layer);
    if (!paths?.length) continue;

    const results = await Promise.all(
      paths.map((targetPath) =>
        limit(async () => {
          progress++;
          onProgress?.(progress, sorted.length, targetPath);

          const node = scanResult.nodeMap.get(targetPath);
          if (!node) return null;

          let analysis: AnalysisResult | null;
          if (SLICED_LAYERS.has(layer) && node.kind === "slice") {
            analysis = await analyzeSlice(node, config);
          } else {
            analysis = await analyzeDirectLayer(node, config);
          }

          if (!analysis) {
            failedPaths.push(targetPath);
            return null;
          }
          return { targetPath, node, analysis } as const;
        }),
      ),
    );

    for (const item of results) {
      if (!item) continue;
      currentCache = cache.updateCacheEntry(
        currentCache,
        item.targetPath,
        item.node,
        item.analysis,
      );
    }
  }

  if (!currentCache) {
    const now = new Date().toISOString();
    currentCache = {
      version: cache.CACHE_VERSION,
      createdAt: now,
      updatedAt: now,
      entries: {},
    };
  }

  if (failedPaths.length > 0) {
    consola.warn(`以下目标分析失败，后续运行会重试：${failedPaths.join(", ")}`);
  }

  await cache.writeCache(currentCache);
  return currentCache;
}
