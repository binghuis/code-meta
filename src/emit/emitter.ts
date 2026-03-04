/**
 * Emit FSD-structured index.json + by-layer shards + SKILL.md.
 */

import type {
  CacheData,
  CodeMetaConfig,
  IndexLayerEntry,
  OverridesMap,
  ProjectMetaIndex,
} from "../core/types";
import type { AnalysisResult, FsdLayer } from "../fsd/types";
import { FSD_LAYERS, isSliceAnalysis, SLICED_LAYERS } from "../fsd/types";
import { getMergedAnalysis } from "../data/overrides";

import fs from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../core/constants";

const DEFAULT_SKILL_MD = `---
name: code-meta
description: 本项目采用 FSD 架构，此 Skill 提供结构化元信息供 AI 按需查阅。
---

# 项目元信息 (FSD)

本项目采用 Feature-Sliced Design 架构。

## 查阅指南
- 了解项目全貌 → 查阅 \`index.json\`
- 了解某个业务功能 → 查阅 \`by-layer/features.json\` 中对应 slice
- 了解数据实体/接口 → 查阅 \`by-layer/entities.json\`
- 了解通用组件/工具 → 查阅 \`by-layer/shared.json\`
- 了解页面组成 → 查阅 \`by-layer/pages.json\`

## 依赖方向
app → pages → widgets → features → entities → shared

上层可引用下层，禁止反向引用。同层切片之间禁止互相引用（entities 层例外）。
`;

export interface EmitOptions {
  config: CodeMetaConfig;
  cacheData: CacheData;
  overrides: OverridesMap;
}

export async function emit(options: EmitOptions): Promise<void> {
  const { config, cacheData, overrides } = options;
  const outputDir = config.skill?.outputDir ?? ".cursor/skills/code-meta";
  const indexFileName = config.skill?.indexFileName ?? "index.json";
  const shardDir = config.skill?.shardDir ?? "by-layer";

  const absOutputDir = path.join(ROOT, outputDir);
  const absShardDir = path.join(absOutputDir, shardDir);
  await fs.mkdir(absOutputDir, { recursive: true });
  await fs.mkdir(absShardDir, { recursive: true });

  const layerEntries = new Map<FsdLayer, {
    entries: Array<{ path: string; analysis: AnalysisResult }>;
  }>();

  for (const [entryPath, cached] of Object.entries(cacheData.entries)) {
    if (!cached?.analysis) continue;
    const analysis = getMergedAnalysis(entryPath, cached.analysis, overrides);
    const layer = cached.layer;
    const existing = layerEntries.get(layer) ?? { entries: [] };
    existing.entries.push({ path: entryPath, analysis });
    layerEntries.set(layer, existing);
  }

  const indexLayers: Record<string, IndexLayerEntry> = {};
  const writtenShards = new Set<string>();

  for (const layerName of FSD_LAYERS) {
    const data = layerEntries.get(layerName);
    if (!data || data.entries.length === 0) continue;

    const shardFileName = `${layerName}.json`;
    const shardContent: Record<string, AnalysisResult> = {};

    for (const { path: p, analysis } of data.entries) {
      shardContent[p] = analysis;
    }

    await fs.writeFile(
      path.join(absShardDir, shardFileName),
      JSON.stringify(shardContent, null, 2),
      "utf8",
    );
    writtenShards.add(shardFileName);

    const layerEntry: IndexLayerEntry = {
      summary: buildLayerSummary(layerName, data.entries),
      shard: shardFileName,
    };

    if (SLICED_LAYERS.has(layerName)) {
      layerEntry.slices = data.entries
        .filter(({ analysis }) => isSliceAnalysis(analysis))
        .map(({ path: p, analysis }) => ({
          name: path.basename(p),
          summary: analysis.summary,
        }));
    }

    indexLayers[layerName] = layerEntry;
  }

  const indexMeta: ProjectMetaIndex = {
    generatedAt: new Date().toISOString(),
    architecture: "fsd",
    layers: indexLayers,
  };

  await fs.writeFile(
    path.join(absOutputDir, indexFileName),
    JSON.stringify(indexMeta, null, 2),
    "utf8",
  );

  try {
    const existing = await fs.readdir(absShardDir);
    for (const name of existing) {
      if (!name.endsWith(".json")) continue;
      if (!writtenShards.has(name)) {
        await fs.unlink(path.join(absShardDir, name));
      }
    }
  } catch {
    // ignore
  }

  // Clean up legacy files from the old version
  for (const legacy of ["project-meta.json", "by-dir"]) {
    const legacyPath = path.join(absOutputDir, legacy);
    try {
      const stat = await fs.lstat(legacyPath);
      if (stat.isDirectory()) {
        await fs.rm(legacyPath, { recursive: true });
      } else {
        await fs.unlink(legacyPath);
      }
    } catch {
      // ignore
    }
  }

  const skillMdPath = path.join(absOutputDir, "SKILL.md");
  try {
    await fs.access(skillMdPath);
  } catch {
    await fs.writeFile(skillMdPath, DEFAULT_SKILL_MD, "utf8");
  }
}

function buildLayerSummary(
  layer: FsdLayer,
  entries: Array<{ path: string; analysis: AnalysisResult }>,
): string {
  if (!SLICED_LAYERS.has(layer)) {
    const directEntry = entries[0];
    return directEntry ? directEntry.analysis.summary : "";
  }

  const sliceNames = entries.map((e) => path.basename(e.path));
  const count = sliceNames.length;
  return `包含 ${count} 个切片：${sliceNames.join("、")}`;
}
