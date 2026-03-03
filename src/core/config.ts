/**
 * Configuration loading: code-meta.config.* (incl. .ts) + .code-metarc via c12.
 */

import type { CodeMetaConfig, ProviderConfig, SkillConfig } from "./types";
import { consola } from "consola";
import { loadConfig as loadC12 } from "c12";

export type { CodeMetaConfig, ProviderConfig, SkillConfig } from "./types";

/** Default extensions to scan. */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".vue",
  ".mjs",
  ".cjs",
] as const;

/** Default exclude patterns (before .gitignore). */
const DEFAULT_EXCLUDE = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".vscode",
  ".git",
  ".husky",
  ".cache",
  "temp",
  "public",
  ".vite",
  ".turbo",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".yarn",
  "*.config.js",
  "*.config.ts",
  "*.config.cjs",
  "*.config.mjs",
] as const;

export interface LoadConfigResult {
  config: CodeMetaConfig;
  configPath: string | null;
}

export async function loadConfig(): Promise<LoadConfigResult> {
  try {
    // c12 loads .env when dotenv: true; do this first so getDefaultConfig() sees env vars
    const result = await loadC12({
      name: "code-meta",
      cwd: process.cwd(),
      dotenv: true,
    });
    const defaultConfig = await getDefaultConfig();
    const config = (result.config ?? {}) as Partial<CodeMetaConfig>;
    if (result.configFile && Object.keys(config).length > 0) {
      const merged: CodeMetaConfig = {
        ...defaultConfig,
        ...config,
        include: config.include ?? defaultConfig.include,
        provider: {
          ...defaultConfig.provider,
          ...(config.provider ?? {}),
        },
        skill: config.skill
          ? { ...defaultConfig.skill, ...config.skill }
          : defaultConfig.skill,
        features: config.features ?? defaultConfig.features,
      };
      return { config: merged, configPath: result.configFile };
    }
    return { config: defaultConfig, configPath: null };
  } catch (error) {
    consola.warn("Failed to load config file, using defaults:", error);
    const defaultConfig = await getDefaultConfig();
    return { config: defaultConfig, configPath: null };
  }
}

export async function getDefaultConfig(): Promise<CodeMetaConfig> {
  const provider: ProviderConfig = {
    baseUrl:
      process.env["ARK_BASE_URL"] ??
      process.env["OPENAI_BASE_URL"] ??
      "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env["ARK_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "",
    model:
      process.env["ARK_MODEL"] ??
      process.env["OPENAI_MODEL"] ??
      "doubao-seed-1-8-251228",
    timeout: 90000,
  };

  const skill: SkillConfig = {
    outputDir: ".cursor/skills/code-meta",
    indexFileName: "index.json",
    dirShardDir: "by-dir",
  };

  return {
    include: ["src"],
    exclude: [...DEFAULT_EXCLUDE],
    allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
    provider,
    features: {},
    skill,
  };
}
