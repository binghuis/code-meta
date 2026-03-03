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
  mtimeMs: number;
  lines: number;
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
  files: Record<string, { md5: string; size: number; mtimeMs?: number; lines?: number }>;
}

/** Feature rule content (directory + feature rules, cache). */
export interface FeatureRuleContent {
  description: string;
  globs: string[];
  body: string;
}

/** Root structure of .code-meta/cache.json */
export interface CacheData {
  version: number;
  createdAt: string;
  updatedAt: string;
  directories: Record<string, CachedDir>;
  /** Feature analysis results; used by emit-only to avoid API calls. */
  features?: Record<string, FeatureRuleContent>;
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

/** Skill output options: index.json + by-dir shards and SKILL.md. */
export interface SkillConfig {
  outputDir?: string;
  /** Index file name (default "index.json"). */
  indexFileName?: string;
  /** Directory for per-top-level shard files (default "by-dir"). */
  dirShardDir?: string;
}

/** One directory entry in a shard (full detail). */
export interface ProjectMetaDirEntry {
  summary: string;
  files: Array<{ path: string; purpose: string; exports: string[] }>;
}

/** Shard file content: dirPath -> full entry for one top-level segment. */
export type ProjectMetaShard = Record<string, ProjectMetaDirEntry>;

/** Lightweight index: dirPath -> summary + shard filename; consumed first, then load by-dir/{shard}. */
export interface ProjectMetaIndex {
  generatedAt: string;
  directories: Record<string, { summary: string; shard: string }>;
  features?: Record<string, FeatureRuleContent>;
}

/** Full code-meta configuration. */
export interface CodeMetaConfig {
  include?: string[];
  exclude?: string[];
  allowedExtensions?: string[];
  provider: ProviderConfig;
  features?: Record<string, FeatureConfig>;
  skill?: SkillConfig;
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
  /** Full scanned directory paths before target/depth filtering. */
  allDirPaths: string[];
  /** Scoped directory paths after target/depth filtering. */
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
