/**
 * code-meta public API
 */

export type {
  CacheData,
  CodeMetaConfig,
  DirAnalysis,
  DiffResult,
  FeatureRuleContent,
  PipelineOptions,
  ScanResult,
} from "./core/types";
export { loadConfig } from "./core/config";
export type { LoadConfigResult } from "./core/config";
export { runPipeline } from "./pipeline";
export type { PipelineResult } from "./pipeline";
export { scan } from "./scan/scanner";
export type { ScanOptions } from "./scan/scanner";
export { diff } from "./scan/differ";
export type { DifferOptions } from "./scan/differ";
export { readCache, writeCache, getCachePath, CACHE_VERSION } from "./data/cache";
export { loadOverrides, getMergedAnalysis } from "./data/overrides";
export { emit } from "./emit/emitter";
export type { EmitOptions } from "./emit/emitter";
export { analyzeFeatures } from "./analyze/features";
export { chat, estimateTokens } from "./provider";
export type { ChatMessage, ChatOptions } from "./provider";
