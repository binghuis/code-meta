/**
 * Stage 4: Emit .cursor/rules/code-meta/*.mdc from cache + overrides.
 */

import type { CacheData, CodeMetaConfig, DirAnalysis, OverridesMap } from "./types";
import { getMergedAnalysis } from "./overrides";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./constants";
import { buildFrontmatter } from "./frontmatter";

function pathToRuleName(dirPath: string): string {
  if (dirPath === ".") return "_root";
  return dirPath.replace(/\//g, "--");
}

function buildRuleContent(
  analysis: DirAnalysis,
  maxLength: number,
): string {
  const sections: string[] = [];

  sections.push("## 目录职责\n" + analysis.summary);
  sections.push("## 业务领域\n" + analysis.businessDomain);
  if (analysis.scenarios.length > 0) {
    sections.push("## 使用场景\n" + analysis.scenarios.map((s) => `- ${s}`).join("\n"));
  }
  if (analysis.conventions.length > 0) {
    sections.push("## 编码约定\n" + analysis.conventions.map((c) => `- ${c}`).join("\n"));
  }
  if (analysis.files.length > 0) {
    const table =
      "| 文件 | 职责 | 关键导出 |\n|---|---|---|\n" +
      analysis.files
        .map(
          (f) =>
            `| \`${f.name}\` | ${f.purpose} | ${(f.exports ?? []).join(", ") || "-"} |`,
        )
        .join("\n");
    sections.push("## 文件说明\n" + table);
  }
  if (analysis.subdirs.length > 0) {
    sections.push(
      "## 子目录\n" +
        analysis.subdirs.map((s) => `- **${s.name}**: ${s.summary}`).join("\n"),
    );
  }

  let body = sections.join("\n\n");
  if (maxLength > 0 && body.length > maxLength) {
    body = body.slice(0, maxLength - 20) + "\n\n...(已截断)";
  }
  return body;
}

function globForDir(dirPath: string): string {
  if (dirPath === ".") return "**/*";
  return `${dirPath}/**/*`;
}

async function writeRuleFile(
  absOutputDir: string,
  fileName: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  const content = `---
${buildFrontmatter(frontmatter)}
---

${body}
`;
  await fs.writeFile(path.join(absOutputDir, fileName), content, "utf8");
}

function isManagedSpecialRule(name: string): boolean {
  return (
    name === "_project-overview.mdc" ||
    name === "_root.mdc" ||
    name.startsWith("_feature--")
  );
}

export interface EmitOptions {
  config: CodeMetaConfig;
  cacheData: CacheData;
  overrides: OverridesMap;
  dirsToDelete: string[];
}

export async function emit(options: EmitOptions): Promise<void> {
  const { config, cacheData, overrides, dirsToDelete } = options;
  const outputDir = config.rules?.outputDir ?? ".cursor/rules/code-meta";
  const maxLength = config.rules?.maxRuleLength ?? 800;
  const projectOverview = config.rules?.projectOverview !== false;

  const absOutputDir = path.join(ROOT, outputDir);
  await fs.mkdir(absOutputDir, { recursive: true });

  const existingFiles = new Set<string>();
  try {
    const entries = await fs.readdir(absOutputDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".mdc")) existingFiles.add(e.name);
    }
  } catch {
    /* ignore */
  }

  const written = new Set<string>();
  const writePromises: Promise<void>[] = [];

  for (const dirPath of Object.keys(cacheData.directories)) {
    const cached = cacheData.directories[dirPath];
    if (!cached?.analysis) continue;

    const analysis = getMergedAnalysis(dirPath, cached.analysis, overrides);
    const ruleName = pathToRuleName(dirPath) + ".mdc";
    const glob = globForDir(dirPath);
    const description =
      dirPath === "."
        ? "项目整体架构与模块概览"
        : `目录 ${dirPath} 的代码上下文`;
    const body = buildRuleContent(analysis, maxLength);
    const frontmatter: Record<string, unknown> = {
      description,
      globs: [glob],
    };
    writePromises.push(writeRuleFile(absOutputDir, ruleName, frontmatter, body));
    written.add(ruleName);
  }

  if (projectOverview && Object.keys(cacheData.directories).length > 0) {
    const byDepth = (a: string, b: string) =>
      a.split("/").filter(Boolean).length - b.split("/").filter(Boolean).length;
    const rootPath = Object.keys(cacheData.directories).sort(byDepth)[0];
    const rootCached = rootPath ? cacheData.directories[rootPath] : null;
    if (rootCached?.analysis) {
      const analysis = getMergedAnalysis(rootPath ?? ".", rootCached.analysis, overrides);
      const body = buildRuleContent(analysis, maxLength);
      const overviewFrontmatter: Record<string, unknown> = {
        description: "项目整体架构与模块概览",
        globs: ["**/*"],
        alwaysApply: false,
      };
      writePromises.push(
        writeRuleFile(absOutputDir, "_project-overview.mdc", overviewFrontmatter, body),
      );
      written.add("_project-overview.mdc");
    }
  }

  await Promise.all(writePromises);

  const deleteDirPromises = dirsToDelete.map((dirPath) => {
    const ruleName = pathToRuleName(dirPath) + ".mdc";
    return fs.unlink(path.join(absOutputDir, ruleName)).catch(() => {});
  });
  await Promise.all(deleteDirPromises);
  for (const dirPath of dirsToDelete) {
    existingFiles.delete(pathToRuleName(dirPath) + ".mdc");
  }

  const deletedRuleNames = new Set(dirsToDelete.map((dirPath) => pathToRuleName(dirPath) + ".mdc"));
  const staleNames = [...existingFiles].filter((name) => {
    if (written.has(name)) return false;
    if (isManagedSpecialRule(name)) return true;
    return deletedRuleNames.has(name);
  });
  await Promise.all(
    staleNames.map((name) =>
      fs.unlink(path.join(absOutputDir, name)).catch(() => {}),
    ),
  );
  for (const name of staleNames) {
    existingFiles.delete(name);
  }
}
