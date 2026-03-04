/**
 * code-meta public API (FSD mode).
 */

export type {
  CacheData,
  CachedEntry,
  CodeMetaConfig,
  FsdDiffResult,
  FsdFileNode,
  FsdScanResult,
  FsdTreeNode,
  IndexLayerEntry,
  OverrideEntry,
  OverridesMap,
  PipelineOptions,
  PipelineResult,
  ProjectMetaIndex,
  ProviderConfig,
  SkillConfig,
} from "./core/types";

export type {
  AnalysisResult,
  FileAnalysis,
  FsdLayer,
  FsdPosition,
  LayerDirectAnalysis,
  SegmentAnalysis,
  SliceAnalysis,
} from "./fsd/types";

export { FSD_LAYERS, SLICED_LAYERS, STANDARD_SEGMENTS } from "./fsd/types";
export { detectFsdStructure, resolvePosition } from "./fsd/detect";
export type { FsdStructure } from "./fsd/detect";

export { loadConfig } from "./core/config";
export type { LoadConfigResult } from "./core/config";

export { runPipeline } from "./pipeline";

export { scan } from "./scan/scanner";
export type { ScanOptions, CachedFileMeta } from "./scan/scanner";

export { diff } from "./scan/differ";
export type { DifferOptions } from "./scan/differ";

export { readCache, writeCache, getCachePath, CACHE_VERSION } from "./data/cache";
export { loadOverrides, getMergedAnalysis } from "./data/overrides";

export { emit } from "./emit/emitter";
export type { EmitOptions } from "./emit/emitter";

export { chat, estimateTokens } from "./provider";
export type { ChatMessage, ChatOptions } from "./provider";
