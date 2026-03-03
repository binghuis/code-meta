/**
 * Stage 4: Emit index.json + by-dir shards (Skill resource) and default SKILL.md if missing.
 */

import type {
  CacheData,
  CodeMetaConfig,
  DirAnalysis,
  OverridesMap,
  ProjectMetaDirEntry,
  ProjectMetaIndex,
} from "../core/types";
import { getMergedAnalysis } from "../data/overrides";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../core/constants";

const DEFAULT_SKILL_MD = `---
name: code-meta
description: 提供本项目由 code-meta 生成的结构化元信息（目录职责、文件说明等），供 AI 理解项目结构时按需查阅。
---

# 项目元信息 (code-meta)

本 Skill 依赖同目录下的 **index.json** 与 **by-dir/*.json** 分片，其中包含由 code-meta 自动生成的目录摘要、文件职责与关键导出等。

在需要理解项目结构、模块边界或文件职责时，请先查阅 \`index.json\`，再按需查阅 \`by-dir/<模块>.json\`。
`;

function analysisToDirEntry(dirPath: string, analysis: DirAnalysis): ProjectMetaDirEntry {
  const filePath = (name: string) =>
    dirPath === "." ? name : `${dirPath}/${name}`;
  return {
    summary: analysis.summary,
    files: (analysis.files ?? []).map((f) => ({
      path: filePath(f.name),
      purpose: f.purpose ?? "",
      exports: f.exports ?? [],
    })),
  };
}

/** Top-level segment of a dir path (e.g. "src", "packages"); "." is skipped. */
function getTop(dirPath: string): string | null {
  if (dirPath === ".") return null;
  const first = dirPath.split("/").filter(Boolean)[0];
  return first ?? null;
}

/** Build full dirPath -> ProjectMetaDirEntry, then group by top for shards. */
function buildDirEntries(
  cacheData: CacheData,
  overrides: OverridesMap,
): Map<string, ProjectMetaDirEntry> {
  const entries = new Map<string, ProjectMetaDirEntry>();
  for (const [dirPath, cached] of Object.entries(cacheData.directories)) {
    if (dirPath === "." || !cached?.analysis) continue;
    const analysis = getMergedAnalysis(dirPath, cached.analysis, overrides);
    entries.set(dirPath, analysisToDirEntry(dirPath, analysis));
  }
  return entries;
}

function groupByTop(
  entries: Map<string, ProjectMetaDirEntry>,
): Map<string, Record<string, ProjectMetaDirEntry>> {
  const byTop = new Map<string, Record<string, ProjectMetaDirEntry>>();
  for (const [dirPath, entry] of entries) {
    const top = getTop(dirPath);
    if (top == null) continue;
    const record = byTop.get(top) ?? {};
    record[dirPath] = entry;
    byTop.set(top, record);
  }
  return byTop;
}

export interface EmitOptions {
  config: CodeMetaConfig;
  cacheData: CacheData;
  overrides: OverridesMap;
}

export async function emit(options: EmitOptions): Promise<void> {
  const { config, cacheData, overrides } = options;
  const outputDir = config.skill?.outputDir ?? ".cursor/skills/code-meta";
  const indexFileName = config.skill?.indexFileName ?? "index.json";
  const dirShardDir = config.skill?.dirShardDir ?? "by-dir";

  const absOutputDir = path.join(ROOT, outputDir);
  const absShardDir = path.join(absOutputDir, dirShardDir);
  await fs.mkdir(absOutputDir, { recursive: true });
  await fs.mkdir(absShardDir, { recursive: true });

  const entries = buildDirEntries(cacheData, overrides);
  const byTop = groupByTop(entries);

  const directories: ProjectMetaIndex["directories"] = {};
  for (const [dirPath, entry] of entries) {
    const top = getTop(dirPath);
    if (top == null) continue;
    directories[dirPath] = { summary: entry.summary, shard: `${top}.json` };
  }

  const indexMeta: ProjectMetaIndex = {
    generatedAt: new Date().toISOString(),
    directories,
  };
  if (cacheData.features && Object.keys(cacheData.features).length > 0) {
    indexMeta.features = cacheData.features;
  }

  for (const [top, record] of byTop) {
    const shardPath = path.join(absShardDir, `${top}.json`);
    await fs.writeFile(
      shardPath,
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  const indexPath = path.join(absOutputDir, indexFileName);
  await fs.writeFile(
    indexPath,
    JSON.stringify(indexMeta, null, 2),
    "utf8",
  );

  const currentTops = new Set(byTop.keys());
  try {
    const existing = await fs.readdir(absShardDir);
    for (const name of existing) {
      if (!name.endsWith(".json")) continue;
      const stem = name.slice(0, -5);
      if (!currentTops.has(stem)) {
        await fs.unlink(path.join(absShardDir, name));
      }
    }
  } catch {
    // ignore readdir errors
  }

  const legacyMetaPath = path.join(absOutputDir, "project-meta.json");
  try {
    await fs.unlink(legacyMetaPath);
  } catch {
    // ignore if missing
  }

  const skillMdPath = path.join(absOutputDir, "SKILL.md");
  try {
    await fs.access(skillMdPath);
  } catch {
    await fs.writeFile(skillMdPath, DEFAULT_SKILL_MD, "utf8");
  }
}
