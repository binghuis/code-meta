/**
 * Stage 1: Scan source tree, build DirNode tree with md5 and fingerprint.
 */

import type {
  CodeMetaConfig,
  DirNode,
  FileNode,
  ScanResult,
  TrivialReason,
} from "./types";
import { consola } from "consola";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { ROOT } from "./constants";
const TRIVIAL_LINE_THRESHOLD = 20;
const BARREL_NAMES = new Set(["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"]);

function buildPatterns(include: string[], extensions: string[]): string[] {
  const extPatterns = extensions.map((ext) => `**/*${ext}`);
  return include.flatMap((inc) =>
    extPatterns.map((pat) => (inc === "." ? pat : `${inc}/${pat}`)),
  );
}

function buildIgnore(exclude: string[]): string[] {
  return exclude.map((entry) => {
    const prefix = entry.startsWith("**/") ? "" : "**/";
    const suffix = entry.includes("*") ? "" : "/**";
    return `${prefix}${entry}${suffix}`;
  });
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

interface GitignoreRule {
  pattern: string;
  negate: boolean;
}

function toGitignoreRulePatterns(rawLine: string): GitignoreRule[] {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) return [];

  const negate = trimmed.startsWith("!");
  const line = (negate ? trimmed.slice(1) : trimmed).replace(/\/$/, "");
  if (!line) return [];

  const anchored = line.startsWith("/");
  const body = anchored ? line.slice(1) : line;
  const hasSlash = body.includes("/");
  const hasGlob = /[*?[\]{}]/.test(body);
  const maybeDir = !hasGlob && !path.extname(body);

  const patterns = (() => {
    if (anchored) {
      if (maybeDir) return [body, `${body}/**`];
      return [body];
    }
    if (hasSlash) {
      if (maybeDir) return [`**/${body}`, `**/${body}/**`];
      return [`**/${body}`];
    }
    if (maybeDir) return [`**/${body}`, `**/${body}/**`];
    return [`**/${body}`];
  })();

  return patterns.map((pattern) => ({ pattern, negate }));
}

async function applyGitignoreRules(rawFiles: string[]): Promise<string[]> {
  const gitignorePath = path.join(ROOT, ".gitignore");
  let content: string;
  try {
    content = await fs.readFile(gitignorePath, "utf8");
  } catch {
    return rawFiles;
  }

  const rules = content
    .split("\n")
    .flatMap((line) => toGitignoreRulePatterns(line));
  if (rules.length === 0 || rawFiles.length === 0) return rawFiles;

  const universe = new Set(rawFiles);
  const selected = new Set(rawFiles);
  for (const rule of rules) {
    const matched = await fg([rule.pattern], {
      cwd: ROOT,
      onlyFiles: true,
      absolute: false,
      dot: true,
      followSymbolicLinks: false,
    });
    for (const rel of matched.map(normalizePath)) {
      if (!universe.has(rel)) continue;
      if (rule.negate) selected.add(rel);
      else selected.delete(rel);
    }
  }

  return rawFiles.filter((f) => selected.has(f));
}

const MD5_BATCH_SIZE = 50;

export interface CachedFileMeta {
  md5: string;
  size: number;
  mtimeMs?: number;
  lines?: number;
}

async function fileMd5SizeAndLines(
  absPath: string,
  fallback?: CachedFileMeta,
): Promise<{ md5: string; size: number; lines: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    if (
      fallback &&
      typeof fallback.mtimeMs === "number" &&
      typeof fallback.lines === "number" &&
      fallback.size === stat.size &&
      Math.abs(fallback.mtimeMs - stat.mtimeMs) < 1
    ) {
      return {
        md5: fallback.md5,
        size: fallback.size,
        lines: fallback.lines,
        mtimeMs: fallback.mtimeMs,
      };
    }
    const hash = crypto.createHash("md5");
    let newlineCount = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(absPath);
      stream.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] === 10) newlineCount++;
        }
      });
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    const md5 = hash.digest("hex");
    const lines = newlineCount + 1;
    return { md5, size: stat.size, lines, mtimeMs: stat.mtimeMs };
  } catch (err) {
    consola.warn(
      `读取文件失败，已跳过: ${absPath}`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function fileListBatch(
  rawFiles: string[],
  root: string,
  cachedFileMeta: Map<string, CachedFileMeta> = new Map(),
): Promise<Map<string, { md5: string; size: number; lines: number; mtimeMs: number }>> {
  const result = new Map<string, { md5: string; size: number; lines: number; mtimeMs: number }>();
  for (let i = 0; i < rawFiles.length; i += MD5_BATCH_SIZE) {
    const batch = rawFiles.slice(i, i + MD5_BATCH_SIZE);
    const entries = await Promise.all(
      batch.map(async (rel) => {
        const abs = path.join(root, rel);
        const info = await fileMd5SizeAndLines(abs, cachedFileMeta.get(rel));
        return [rel, info] as const;
      }),
    );
    for (const [rel, info] of entries) {
      if (info) result.set(rel, info);
    }
  }
  return result;
}

/** Build dir -> list of md5 for all files under that dir (and descendants). O(files * depth). */
function buildDirMd5Index(
  fileList: Map<string, { md5: string; size: number; lines: number; mtimeMs: number }>,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [rel, info] of fileList) {
    const dir = path.dirname(rel);
    if (dir === "." || dir === "") {
      const list = index.get(".") ?? [];
      list.push(info.md5);
      index.set(".", list);
    } else {
      const rootList = index.get(".") ?? [];
      rootList.push(info.md5);
      index.set(".", rootList);
      const parts = dir.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const ancestor = parts.slice(0, i).join("/");
        const list = index.get(ancestor) ?? [];
        list.push(info.md5);
        index.set(ancestor, list);
      }
    }
  }
  return index;
}

function computeFingerprint(md5s: string[]): string {
  const sorted = [...md5s].sort();
  return crypto.createHash("md5").update(sorted.join("")).digest("hex");
}

/** Detect trivial reason for a directory. */
function detectTrivial(
  files: Array<{ name: string; path: string; md5: string; size: number }>,
  totalLines: number,
): TrivialReason | undefined {
  if (files.length === 0) return undefined;
  if (totalLines < TRIVIAL_LINE_THRESHOLD) return "too-small";
  const onlyBarrel =
    files.length === 1 && BARREL_NAMES.has(files[0]!.name);
  if (onlyBarrel) return "barrel-only";
  const allDts = files.every((f) => f.name.endsWith(".d.ts"));
  if (allDts) return "type-only";
  return undefined;
}

function computeEffectiveRoot(
  targetPath: string | undefined,
  dirPaths: string[],
): string {
  if (targetPath != null && targetPath !== "") {
    return normalizePath(targetPath).replace(/\/$/, "");
  }
  if (dirPaths.length === 0) return ".";
  const first = dirPaths[0]!;
  return first.includes("/") ? first.split("/")[0]! : ".";
}

function filterDirPaths(
  dirPaths: string[],
  targetPath: string | undefined,
  depth: number | undefined,
): string[] {
  let out = dirPaths;
  if (targetPath != null && targetPath !== "") {
    const targetNorm = normalizePath(targetPath).replace(/\/$/, "");
    out = out.filter((p) => p === targetNorm || p.startsWith(targetNorm + "/"));
  }
  if (depth !== undefined) {
    out = out.filter((p) => p.split("/").filter(Boolean).length <= depth);
  }
  return out;
}

export interface ScanOptions {
  config: CodeMetaConfig;
  targetPath?: string;
  depth?: number;
  cachedFileMeta?: Map<string, CachedFileMeta>;
}

/**
 * Scan project and build tree. targetPath restricts to a subtree; depth limits directory depth from root.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const { config, targetPath, depth } = options;
  const include = config.include?.length ? config.include : ["src"];
  const extensions =
    (config.allowedExtensions?.length ?? 0) > 0
      ? config.allowedExtensions!
      : [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"];
  const exclude = config.exclude ?? [];

  const patterns = buildPatterns(include, extensions);
  const ignore = buildIgnore(exclude);

  let rawFiles = await fg(patterns, {
    cwd: ROOT,
    absolute: false,
    onlyFiles: true,
    ignore,
    dot: true,
    followSymbolicLinks: false,
  });

  rawFiles = rawFiles.map(normalizePath);

  if (targetPath) {
    const targetNorm = normalizePath(targetPath).replace(/\/$/, "");
    rawFiles = rawFiles.filter((f) => f === targetNorm || f.startsWith(targetNorm + "/"));
  }
  rawFiles = await applyGitignoreRules(rawFiles);

  const fileList = await fileListBatch(rawFiles, ROOT, options.cachedFileMeta);
  const dirMd5Index = buildDirMd5Index(fileList);

  const dirToFiles = new Map<
    string,
    Array<{ name: string; path: string; md5: string; size: number; lines: number; mtimeMs: number }>
  >();
  const dirToSubdirs = new Map<string, Set<string>>();

  for (const rel of fileList.keys()) {
    const dir = path.dirname(rel);
    const name = path.basename(rel);
    const info = fileList.get(rel)!;
    if (!dirToFiles.has(dir)) {
      dirToFiles.set(dir, []);
      const parts = dir.split("/").filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const parent = parts.slice(0, i).join("/") || ".";
        const child = parts[i]!;
        if (!dirToSubdirs.has(parent)) dirToSubdirs.set(parent, new Set());
        dirToSubdirs.get(parent)!.add(child);
      }
    }
    dirToFiles.get(dir)!.push({
      name,
      path: rel,
      md5: info.md5,
      size: info.size,
      lines: info.lines,
        mtimeMs: info.mtimeMs,
    });
  }

  const allDirs = new Set<string>(dirToFiles.keys());
  for (const parent of dirToSubdirs.keys()) {
    allDirs.add(parent);
  }
  const dirPaths = [...allDirs].sort();
  const depthLimit = depth ?? 999;
  const dirMap = new Map<string, DirNode>();

  async function buildNode(dirPath: string): Promise<DirNode> {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
    const files = dirToFiles.get(dirPath) ?? [];
    const subdirNames = dirToSubdirs.get(dirPath);
    const children: (FileNode | DirNode)[] = [];

    const fileNodes: FileNode[] = files.map((f) => ({
      kind: "file",
      name: f.name,
      path: f.path,
      md5: f.md5,
      size: f.size,
      mtimeMs: f.mtimeMs,
      lines: f.lines,
    }));
    children.push(...fileNodes);

    if (subdirNames) {
      for (const name of [...subdirNames].sort()) {
        const childPath = dirPath === "." ? name : `${dirPath}/${name}`;
        const segments = childPath.split("/").filter(Boolean);
        if (segments.length > depthLimit) continue;
        children.push(await buildNode(childPath));
      }
    }

    const allMd5s = dirMd5Index.get(dirPath) ?? [];
    const fingerprint = computeFingerprint(allMd5s);

    const totalLines = files.reduce((sum, f) => sum + (f.lines ?? 0), 0);
    const trivial = detectTrivial(
      files.map(({ name, path: p, md5, size }) => ({ name, path: p, md5, size })),
      totalLines,
    );
    const node: DirNode = {
      kind: "dir",
      name: dirPath === "." ? "." : path.basename(dirPath),
      path: dirPath,
      fingerprint,
      children,
      ...(trivial ? { trivial } : {}),
    };
    dirMap.set(dirPath, node);
    return node;
  }

  const effectiveRoot = computeEffectiveRoot(targetPath, dirPaths);
  const filteredDirPaths = filterDirPaths(dirPaths, targetPath, depth);
  const root = dirPaths.length > 0 ? await buildNode(effectiveRoot) : null;

  return {
    root,
    allDirPaths: dirPaths,
    dirPaths: filteredDirPaths,
    dirMap,
  };
}
