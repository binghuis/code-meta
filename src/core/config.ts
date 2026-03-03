/**
 * Configuration loading: code-meta.config.* + .gitignore parsing.
 */

import type { CodeMetaConfig, ProviderConfig, SkillConfig } from "./types";
import { consola } from "consola";
import JoyCon from "joycon";

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

function createConfigLoader() {
  return new JoyCon({
    files: [
      "code-meta.config.js",
      "code-meta.config.json",
      ".code-metarc",
      ".code-metarc.json",
    ],
    cwd: process.cwd(),
  });
}

export interface LoadConfigResult {
  config: CodeMetaConfig;
  configPath: string | null;
}

export async function loadConfig(): Promise<LoadConfigResult> {
  const joycon = createConfigLoader();
  const defaultConfig = await getDefaultConfig();

  try {
    const result = await joycon.load();
    if (result && result.data) {
      const user = (result.data || {}) as Partial<CodeMetaConfig>;
      const config: CodeMetaConfig = {
        ...defaultConfig,
        ...user,
        provider: {
          ...defaultConfig.provider,
          ...(user.provider ?? {}),
        },
        skill: user.skill
          ? { ...defaultConfig.skill, ...user.skill }
          : defaultConfig.skill,
        features: user.features ?? defaultConfig.features,
      };
      return { config, configPath: result.path ?? null };
    }
    return { config: defaultConfig, configPath: null };
  } catch (error) {
    consola.warn("Failed to load config file, using defaults:", error);
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
    metaFileName: "project-meta.json",
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
