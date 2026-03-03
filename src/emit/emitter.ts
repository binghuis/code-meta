/**
 * Stage 4: Emit .cursor/skills/code-meta/project-meta.json (Skill resource) and default SKILL.md if missing.
 */

import type {
  CacheData,
  CodeMetaConfig,
  DirAnalysis,
  OverridesMap,
  ProjectMetaDirEntry,
  ProjectMeta,
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

本 Skill 依赖同目录下的 **project-meta.json**，其中包含由 code-meta 自动生成的目录摘要、文件职责与关键导出等。

在需要理解项目结构、模块边界或文件职责时，请优先查阅 \`project-meta.json\`。
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

function buildProjectMeta(
  cacheData: CacheData,
  overrides: OverridesMap,
): ProjectMeta {
  const directories: Record<string, ProjectMetaDirEntry> = {};
  for (const [dirPath, cached] of Object.entries(cacheData.directories)) {
    if (dirPath === "." || !cached?.analysis) continue;
    const analysis = getMergedAnalysis(dirPath, cached.analysis, overrides);
    directories[dirPath] = analysisToDirEntry(dirPath, analysis);
  }
  const meta: ProjectMeta = {
    generatedAt: new Date().toISOString(),
    directories,
  };
  if (cacheData.features && Object.keys(cacheData.features).length > 0) {
    meta.features = cacheData.features;
  }
  return meta;
}

export interface EmitOptions {
  config: CodeMetaConfig;
  cacheData: CacheData;
  overrides: OverridesMap;
  dirsToDelete: string[];
}

export async function emit(options: EmitOptions): Promise<void> {
  const { config, cacheData, overrides } = options;
  const outputDir = config.skill?.outputDir ?? ".cursor/skills/code-meta";
  const metaFileName = config.skill?.metaFileName ?? "project-meta.json";

  const absOutputDir = path.join(ROOT, outputDir);
  await fs.mkdir(absOutputDir, { recursive: true });

  const projectMeta = buildProjectMeta(cacheData, overrides);
  const metaPath = path.join(absOutputDir, metaFileName);
  await fs.writeFile(
    metaPath,
    JSON.stringify(projectMeta, null, 2),
    "utf8",
  );

  const skillMdPath = path.join(absOutputDir, "SKILL.md");
  try {
    await fs.access(skillMdPath);
  } catch {
    await fs.writeFile(skillMdPath, DEFAULT_SKILL_MD, "utf8");
  }
}
