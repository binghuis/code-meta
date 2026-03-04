/**
 * Cache read/write for FSD analysis results.
 * Key is slice path or direct-layer path.
 */

import type { CacheData, CachedEntry, FsdFileNode, FsdTreeNode } from "../core/types";
import type { AnalysisResult } from "../fsd/types";

import fs from "node:fs/promises";
import path from "node:path";

import { SLICED_LAYERS } from "../fsd/types";
import { ROOT } from "../core/constants";

export const CACHE_VERSION = 2;

export function getCachePath(): string {
  return path.join(ROOT, ".code-meta", "cache.json");
}

export async function readCache(): Promise<CacheData | null> {
  try {
    const raw = await fs.readFile(getCachePath(), "utf8");
    const data = JSON.parse(raw) as CacheData;
    if (data.version !== CACHE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export async function writeCache(data: CacheData): Promise<void> {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });

  data.updatedAt = new Date().toISOString();
  const tmpPath = cachePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmpPath, cachePath);
}

function collectFilesMeta(
  node: FsdTreeNode,
): Record<string, { md5: string; size: number; mtimeMs?: number; lines?: number }> {
  const result: Record<string, { md5: string; size: number; mtimeMs?: number; lines?: number }> = {};

  function walk(n: FsdTreeNode | FsdFileNode): void {
    if (n.kind === "file") {
      result[n.name] = { md5: n.md5, size: n.size, mtimeMs: n.mtimeMs, lines: n.lines };
    } else {
      for (const child of n.children) {
        walk(child);
      }
    }
  }
  walk(node);
  return result;
}

export function updateCacheEntry(
  cache: CacheData | null,
  targetPath: string,
  node: FsdTreeNode,
  analysis: AnalysisResult,
): CacheData {
  const now = new Date().toISOString();
  if (!cache) {
    cache = {
      version: CACHE_VERSION,
      createdAt: now,
      updatedAt: now,
      entries: {},
    };
  }

  const kind: CachedEntry["kind"] = SLICED_LAYERS.has(node.fsd.layer) ? "slice" : "direct-layer";

  cache.entries[targetPath] = {
    kind,
    layer: node.fsd.layer,
    fingerprint: node.fingerprint,
    analyzedAt: now,
    analysis,
    files: collectFilesMeta(node),
  };

  return cache;
}
