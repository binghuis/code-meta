/**
 * Pipeline-level types for the FSD-aware code-meta tool.
 */

import type {
  AnalysisResult,
  FsdLayer,
  FsdPosition,
} from "../fsd/types";

// ── Scan ────────────────────────────────────────────────────────

export interface FsdFileNode {
  kind: "file";
  name: string;
  /** Path relative to project root, e.g. "src/features/cart/ui/Button.tsx". */
  path: string;
  fsd: FsdPosition;
  md5: string;
  size: number;
  lines: number;
  mtimeMs: number;
}

export interface FsdTreeNode {
  kind: "layer" | "slice" | "segment";
  name: string;
  path: string;
  fsd: FsdPosition;
  fingerprint: string;
  children: Array<FsdTreeNode | FsdFileNode>;
}

export interface FsdScanResult {
  layers: Map<FsdLayer, FsdTreeNode>;
  /** All slice / direct-layer paths that are analysis targets. */
  analysisTargets: string[];
  nodeMap: Map<string, FsdTreeNode>;
}

// ── Diff ────────────────────────────────────────────────────────

export type EntryStatus = "unchanged" | "modified" | "new" | "deleted";

export interface FsdDiffResult {
  toAnalyze: string[];
  toSkip: string[];
  toDelete: string[];
}

// ── Cache ───────────────────────────────────────────────────────

export interface CachedEntry {
  kind: "slice" | "direct-layer";
  layer: FsdLayer;
  fingerprint: string;
  analyzedAt: string;
  analysis: AnalysisResult;
  files: Record<string, { md5: string; size: number; mtimeMs?: number; lines?: number }>;
}

export interface CacheData {
  version: number;
  createdAt: string;
  updatedAt: string;
  entries: Record<string, CachedEntry>;
}

// ── Config ──────────────────────────────────────────────────────

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout?: number;
}

export interface SkillConfig {
  outputDir?: string;
  indexFileName?: string;
  shardDir?: string;
}

export interface CodeMetaConfig {
  srcRoot?: string;
  exclude?: string[];
  allowedExtensions?: string[];
  provider: ProviderConfig;
  skill?: SkillConfig;
}

// ── Overrides ───────────────────────────────────────────────────

export interface OverrideEntry {
  summary?: string;
  scenarios?: string[];
  conventions?: string[];
  segments?: Array<{ name: string; summary?: string }>;
}

export type OverridesMap = Record<string, OverrideEntry>;

// ── Emit ────────────────────────────────────────────────────────

export interface IndexLayerEntry {
  summary: string;
  shard: string;
  slices?: Array<{ name: string; summary: string }>;
}

export interface ProjectMetaIndex {
  generatedAt: string;
  architecture: "fsd";
  layers: Record<string, IndexLayerEntry>;
}

// ── Pipeline ────────────────────────────────────────────────────

export interface PipelineOptions {
  targetPath?: string;
  dryRun?: boolean;
  emitOnly?: boolean;
  force?: boolean;
  onProgress?: (current: number, total: number, path: string) => void;
}

export interface PipelineResult {
  scanResult?: FsdScanResult;
  diffResult?: FsdDiffResult;
  cacheData?: CacheData;
  dryRun?: boolean;
  emitOnly?: boolean;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}
