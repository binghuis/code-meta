/**
 * Feature map: cross-directory glob matching and feature-level rule generation.
 */

import type { CodeMetaConfig } from "./types";
import { chat, type ChatMessage } from "./provider";
import { extractFileContent } from "./extractor";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";

const ROOT = process.cwd();
const MAX_FILES_PER_FEATURE = 15;
const MAX_CHARS_PER_FEATURE = 12000;

const FEATURE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "该功能模块的总体描述，中文" },
    scenarios: {
      type: "array",
      items: { type: "string" },
      description: "使用场景",
    },
    keyPoints: {
      type: "array",
      items: { type: "string" },
      description: "关键要点或约定",
    },
  },
  required: ["summary", "scenarios", "keyPoints"],
  additionalProperties: false,
};

export interface FeatureRuleContent {
  description: string;
  globs: string[];
  body: string;
}

export async function analyzeFeatures(
  config: CodeMetaConfig,
): Promise<Map<string, FeatureRuleContent>> {
  const features = config.features ?? {};
  if (Object.keys(features).length === 0) return new Map();

  const result = new Map<string, FeatureRuleContent>();

  for (const [name, featureConfig] of Object.entries(features)) {
    const globs = featureConfig.globs ?? [];
    if (globs.length === 0) continue;

    const patterns = globs.map((g) => (g.startsWith("**") ? g : `**/${g}`));
    let files: string[];
    try {
      files = await fg(patterns, {
        cwd: ROOT,
        onlyFiles: true,
        absolute: false,
        ignore: ["node_modules/**", "dist/**", ".git/**"],
      });
    } catch {
      continue;
    }

    files = files.slice(0, MAX_FILES_PER_FEATURE);
    const parts: string[] = [];
    let totalChars = 0;

    for (const rel of files) {
      if (totalChars >= MAX_CHARS_PER_FEATURE) break;
      const { content } = await extractFileContent(
        rel,
        Math.min(1500, MAX_CHARS_PER_FEATURE - totalChars),
      );
      parts.push(`--- ${rel} ---\n${content}`);
      totalChars += content.length;
    }

    const userContent = `功能名称：${name}
${featureConfig.description ? `配置描述：${featureConfig.description}\n` : ""}
以下为匹配到的文件内容（可能截断）：\n\n${parts.join("\n\n")}

请分析这些文件，概括该功能模块的职责、使用场景和关键要点。按 JSON schema 输出 summary、scenarios、keyPoints。全部中文。`;

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "你是项目分析助手。根据跨目录的文件内容，概括某一功能模块的职责与使用场景。输出结构化 JSON。全部中文。",
      },
      { role: "user", content: userContent },
    ];

    try {
      const raw = await chat(config.provider, messages, {
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "feature_analysis",
            schema: FEATURE_SCHEMA,
            strict: true,
          },
        },
      });
      const data = JSON.parse(raw) as {
        summary: string;
        scenarios: string[];
        keyPoints: string[];
      };
      const body = [
        "## 功能概述\n" + data.summary,
        "## 使用场景\n" + data.scenarios.map((s) => `- ${s}`).join("\n"),
        "## 关键要点\n" + data.keyPoints.map((k) => `- ${k}`).join("\n"),
      ].join("\n\n");

      result.set(name, {
        description: featureConfig.description ?? `功能「${name}」相关代码上下文`,
        globs: globs,
        body,
      });
    } catch {
      result.set(name, {
        description: featureConfig.description ?? `功能「${name}」`,
        globs,
        body: "（分析未完成）",
      });
    }
  }

  return result;
}

export async function emitFeatureRules(
  config: CodeMetaConfig,
  featureContents: Map<string, FeatureRuleContent>,
): Promise<void> {
  const outputDir = config.rules?.outputDir ?? ".cursor/rules/code-meta";
  const absOutputDir = path.join(ROOT, outputDir);
  await fs.mkdir(absOutputDir, { recursive: true });

  for (const [name, fc] of featureContents) {
    const safeName = name.replace(/\//g, "--").replace(/\s+/g, "-");
    const filePath = path.join(absOutputDir, `_feature--${safeName}.mdc`);
    const globsYaml = fc.globs.map((g) => `  - "${g}"`).join("\n");
    const content = `---
description: ${fc.description}
globs:
${globsYaml}
---

${fc.body}
`;
    await fs.writeFile(filePath, content, "utf8");
  }
}
