/**
 * code-meta public API
 */

export type {
  CacheData,
  CodeMetaConfig,
  DirAnalysis,
  DiffResult,
  PipelineOptions,
  ScanResult,
} from "./types";
export { loadConfig, getDefaultConfig, DEFAULT_ALLOWED_EXTENSIONS } from "./config";
export type { LoadConfigResult } from "./config";
export { runPipeline } from "./pipeline";
export type { PipelineResult } from "./pipeline";
export { scan } from "./scanner";
export type { ScanOptions } from "./scanner";
export { diff } from "./differ";
export type { DifferOptions } from "./differ";
export { readCache, writeCache, getCachePath, CACHE_VERSION } from "./cache";
export { loadOverrides, getMergedAnalysis } from "./overrides";
export { emit } from "./emitter";
export type { EmitOptions } from "./emitter";
export { analyzeFeatures, emitFeatureRules } from "./features";
export type { FeatureRuleContent } from "./features";
export { chat, estimateTokens } from "./provider";
export type { ChatMessage, ChatOptions } from "./provider";
