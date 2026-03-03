/**
 * Read/write .code-meta/cache.json with version migration.
 */

import type { CacheData, CachedDir, DirAnalysis, DirNode } from "./types";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
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
  data.updatedAt = new Date().toISOString();
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2), "utf8");
}

function filesFromNode(node: DirNode): Record<string, { md5: string; size: number }> {
  const out: Record<string, { md5: string; size: number }> = {};
  for (const c of node.children) {
    if (c.kind === "file") {
      out[c.name] = { md5: c.md5, size: c.size };
    }
  }
  return out;
}

export async function updateCacheWithAnalysis(
  cache: CacheData | null,
  dirPath: string,
  node: DirNode,
  analysis: DirAnalysis,
): Promise<CacheData> {
  const now = new Date().toISOString();
  const next: CacheData = cache
    ? { ...cache, directories: { ...cache.directories } }
    : {
        version: CACHE_VERSION,
        createdAt: now,
        updatedAt: now,
        directories: {},
      };

  next.directories[dirPath] = {
    fingerprint: node.fingerprint,
    analyzedAt: now,
    analysis,
    files: filesFromNode(node),
  };
  next.updatedAt = now;
  return next;
}

export async function removeCacheEntries(
  cache: CacheData,
  dirPaths: string[],
): Promise<CacheData> {
  const next = { ...cache, directories: { ...cache.directories } };
  for (const p of dirPaths) {
    delete next.directories[p];
  }
  next.updatedAt = new Date().toISOString();
  return next;
}
