/**
 * Read/write .code-meta/cache.json with version migration.
 */

import type { CacheData, DirAnalysis, DirNode } from "../core/types";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../core/constants";
const CACHE_DIR = ".code-meta";
const CACHE_FILE = "cache.json";
export const CACHE_VERSION = 1;

export function getCachePath(): string {
  return path.join(ROOT, CACHE_DIR, CACHE_FILE);
}

export async function readCache(): Promise<CacheData | null> {
  const cachePath = getCachePath();
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const data = JSON.parse(raw) as CacheData;
    if (data.version !== CACHE_VERSION) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function writeCache(data: CacheData): Promise<void> {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
}

function filesFromNode(
  node: DirNode,
): Record<string, { md5: string; size: number; mtimeMs?: number; lines?: number }> {
  const out: Record<string, { md5: string; size: number; mtimeMs?: number; lines?: number }> = {};
  for (const c of node.children) {
    if (c.kind === "file") {
      out[c.name] = { md5: c.md5, size: c.size, mtimeMs: c.mtimeMs, lines: c.lines };
    }
  }
  return out;
}

export function updateCacheWithAnalysis(
  cache: CacheData | null,
  dirPath: string,
  node: DirNode,
  analysis: DirAnalysis,
): CacheData {
  const now = new Date().toISOString();
  const entry = {
    fingerprint: node.fingerprint,
    analyzedAt: now,
    analysis,
    files: filesFromNode(node),
  };
  if (cache == null) {
    return {
      version: CACHE_VERSION,
      createdAt: now,
      updatedAt: now,
      directories: { [dirPath]: entry },
    };
  }
  cache.directories[dirPath] = entry;
  cache.updatedAt = now;
  return cache;
}
