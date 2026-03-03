/**
 * Stage 1: Scan source tree, build DirNode tree with md5 and fingerprint.
 */

import type { DirNode, FileNode, ScanResult, TrivialReason } from "./types";
import type { CodeMetaConfig } from "./types";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import fg from "fast-glob";

const ROOT = process.cwd();
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

async function fileMd5AndSize(absPath: string): Promise<{ md5: string; size: number } | null> {
  try {
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const content = await fs.readFile(absPath);
    const md5 = crypto.createHash("md5").update(content).digest("hex");
    return { md5, size: stat.size };
  } catch {
    return null;
  }
}

/** Collect all file md5s under a directory (recursive) for fingerprint. */
function allFileMd5sUnder(
  dirPath: string,
  fileList: Map<string, { md5: string; size: number }>,
): string[] {
  const md5s: string[] = [];
  const prefix = dirPath === "." ? "" : dirPath + "/";
  for (const [p, info] of fileList) {
    if (dirPath === "." || p === dirPath || p.startsWith(prefix)) {
      md5s.push(info.md5);
    }
  }
  return md5s;
}

function computeFingerprint(md5s: string[]): string {
  const sorted = [...md5s].sort();
  return crypto.createHash("md5").update(sorted.join("")).digest("hex");
}

/** Detect trivial reason for a directory. */
function detectTrivial(
  dirPath: string,
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

export interface ScanOptions {
  config: CodeMetaConfig;
  targetPath?: string;
  depth?: number;
}

/**
 * Scan project and build tree. targetPath restricts to a subtree; depth limits directory depth from root.
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const { config, targetPath, depth } = options;
  const include = config.include?.length ? config.include : ["src"];
  const extensions =
    config.allowedExtensions?.length ?? 0 > 0
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

  const fileList = new Map<string, { md5: string; size: number }>();
  for (const rel of rawFiles) {
    const abs = path.join(ROOT, rel);
    const info = await fileMd5AndSize(abs);
    if (info) fileList.set(rel, info);
  }

  const dirToFiles = new Map<string, Array<{ name: string; path: string; md5: string; size: number }>>();
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
    dirToFiles.get(dir)!.push({ name, path: rel, md5: info.md5, size: info.size });
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

    const allMd5s = allFileMd5sUnder(dirPath, fileList);
    const fingerprint = computeFingerprint(allMd5s);

    let totalLines = 0;
    try {
      for (const f of files) {
        const abs = path.join(ROOT, f.path);
        const content = await fs.readFile(abs, "utf8");
        totalLines += content.split("\n").length;
      }
    } catch {
      totalLines = 0;
    }

    const trivial = detectTrivial(dirPath, files, totalLines);
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

  const effectiveRoot =
    targetPath != null && targetPath !== ""
      ? normalizePath(targetPath).replace(/\/$/, "")
      : dirPaths.length
        ? (dirPaths[0]!.includes("/") ? dirPaths[0]!.split("/")[0]! : ".")
        : ".";
  const root = dirPaths.length > 0 ? await buildNode(effectiveRoot) : null;

  let filteredDirPaths = dirPaths;
  if (targetPath != null && targetPath !== "") {
    const targetNorm = normalizePath(targetPath).replace(/\/$/, "");
    filteredDirPaths = filteredDirPaths.filter(
      (p) => p === targetNorm || p.startsWith(targetNorm + "/"),
    );
  }
  if (depth !== undefined) {
    filteredDirPaths = filteredDirPaths.filter(
      (p) => p.split("/").filter(Boolean).length <= depth,
    );
  }

  return {
    root,
    dirPaths: filteredDirPaths,
    dirMap,
  };
}
