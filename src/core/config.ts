/**
 * Configuration loading for code-meta (FSD mode).
 */

import type { CodeMetaConfig, ProviderConfig, SkillConfig } from "./types";
import { loadConfig as c12Load } from "c12";
import { consola } from "consola";

export type { CodeMetaConfig, ProviderConfig, SkillConfig };

export const DEFAULT_ALLOWED_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs",
];

const DEFAULT_EXCLUDE = [
  "node_modules", "dist", "build", ".output", ".nuxt", ".next",
  "coverage", ".idea", ".vscode", ".git", "__tests__", "__mocks__",
];

export function getDefaultConfig(): CodeMetaConfig {
  return {
    srcRoot: "src",
    exclude: DEFAULT_EXCLUDE,
    allowedExtensions: DEFAULT_ALLOWED_EXTENSIONS,
    provider: {
      baseUrl:
        process.env["ARK_BASE_URL"] ??
        process.env["OPENAI_BASE_URL"] ??
        "https://ark.cn-beijing.volces.com/api/v3",
      apiKey:
        process.env["ARK_API_KEY"] ??
        process.env["OPENAI_API_KEY"] ??
        "",
      model:
        process.env["ARK_MODEL"] ??
        process.env["OPENAI_MODEL"] ??
        "doubao-seed-1-8-251228",
      timeout: 90_000,
    },
    skill: {
      outputDir: ".cursor/skills/code-meta",
      indexFileName: "index.json",
      shardDir: "by-layer",
    },
  };
}

export interface LoadConfigResult {
  config: CodeMetaConfig;
  configPath: string | null;
}

export async function loadConfig(): Promise<LoadConfigResult> {
  const defaults = getDefaultConfig();

  try {
    const { config: raw, configFile } = await c12Load<CodeMetaConfig>({
      name: "code-meta",
      cwd: process.cwd(),
      dotenv: true,
      defaults,
    });

    const merged: CodeMetaConfig = {
      srcRoot: raw?.srcRoot ?? defaults.srcRoot,
      exclude: raw?.exclude ?? defaults.exclude,
      allowedExtensions: raw?.allowedExtensions ?? defaults.allowedExtensions,
      provider: {
        ...defaults.provider,
        ...raw?.provider,
      },
      skill: {
        ...defaults.skill,
        ...raw?.skill,
      },
    };

    return { config: merged, configPath: configFile ?? null };
  } catch (err) {
    consola.warn(
      "加载配置失败，使用默认配置:",
      err instanceof Error ? err.message : String(err),
    );
    return { config: defaults, configPath: null };
  }
}
