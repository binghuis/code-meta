/**
 * Shared type definitions for code-meta pipeline.
 */

/** File node in the scan tree (leaf). */
export interface FileNode {
  kind: "file";
  name: string;
  path: string;
  md5: string;
  size: number;
}

/** Directory node in the scan tree (has children). */
export interface DirNode {
  kind: "dir";
  name: string;
  path: string;
  fingerprint: string;
  children: TreeNode[];
  /** Marked when directory is barrel-only, type-only, or very small. */
  trivial?: TrivialReason;
}

export type TreeNode = FileNode | DirNode;

export type TrivialReason =
  | "barrel-only"
  | "type-only"
  | "too-small";

/** Status of a directory after diffing scan vs cache. */
export type DirStatus = "unchanged" | "modified" | "new" | "deleted";

/** Per-directory diff result. */
export interface DirDiff {
  path: string;
  status: DirStatus;
  node?: DirNode;
}

/** Result of diff stage: what to analyze, skip, or delete. */
export interface DiffResult {
  toAnalyze: string[];
  toSkip: string[];
  toDelete: string[];
  dirDiffs: Map<string, DirDiff>;
}

/** Single file entry in AI analysis output. */
export interface FileAnalysis {
  name: string;
  purpose: string;
  exports: string[];
}

/** Single subdir entry in AI analysis output. */
export interface SubdirAnalysis {
  name: string;
  summary: string;
}

/** AI analysis output schema for one directory. */
export interface DirAnalysis {
  summary: string;
  businessDomain: string;
  scenarios: string[];
  conventions: string[];
  files: FileAnalysis[];
  subdirs: SubdirAnalysis[];
}

/** Cached analysis for one directory. */
export interface CachedDir {
  fingerprint: string;
  analyzedAt: string;
  analysis: DirAnalysis;
  files: Record<string, { md5: string; size: number }>;
}

/** Root structure of .code-meta/cache.json */
export interface CacheData {
  version: number;
  createdAt: string;
  updatedAt: string;
  directories: Record<string, CachedDir>;
}

/** LLM provider configuration (OpenAI-compatible). */
export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeout?: number;
}

/** Feature map entry from config. */
export interface FeatureConfig {
  globs: string[];
  description?: string;
}

/** Rules output options. */
export interface RulesConfig {
  outputDir?: string;
  maxRuleLength?: number;
  projectOverview?: boolean;
}

/** Full code-meta configuration. */
export interface CodeMetaConfig {
  include?: string[];
  exclude?: string[];
  allowedExtensions?: string[];
  provider: ProviderConfig;
  features?: Record<string, FeatureConfig>;
  rules?: RulesConfig;
}

/** Human override for a single directory (partial DirAnalysis). */
export interface OverrideEntry {
  summary?: string;
  businessDomain?: string;
  scenarios?: string[];
  conventions?: string[];
  files?: Array<{ name: string; purpose?: string; exports?: string[] }>;
  subdirs?: Array<{ name: string; summary?: string }>;
}

/** Root structure of .code-meta/overrides.yaml */
export type OverridesMap = Record<string, OverrideEntry>;

/** Scan result: root of the tree + flat list of all dir paths for iteration. */
export interface ScanResult {
  root: DirNode | null;
  dirPaths: string[];
  dirMap: Map<string, DirNode>;
}

/** Pipeline run options (CLI flags). */
export interface PipelineOptions {
  targetPath?: string;
  depth?: number;
  dryRun?: boolean;
  emitOnly?: boolean;
  force?: boolean;
  onProgress?: (current: number, total: number, path: string) => void;
}
