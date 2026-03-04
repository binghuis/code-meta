/**
 * FSD-aware scanner: build tree with FsdPosition, compute fingerprints.
 */

import type { CodeMetaConfig, FsdFileNode, FsdScanResult, FsdTreeNode } from "../core/types";
import type { FsdLayer, FsdPosition } from "../fsd/types";
import type { FsdStructure } from "../fsd/detect";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { consola } from "consola";
import fg from "fast-glob";
import ig from "ignore";

import { ROOT } from "../core/constants";
import { resolvePosition } from "../fsd/detect";
import { SLICED_LAYERS } from "../fsd/types";

const MD5_BATCH = 50;

export interface CachedFileMeta {
  md5: string;
  size: number;
  mtimeMs?: number;
  lines?: number;
}

export interface ScanOptions {
  config: CodeMetaConfig;
  fsdStructure: FsdStructure;
  targetPath?: string;
  cachedFileMeta?: Map<string, CachedFileMeta>;
}

// ── helpers ─────────────────────────────────────────────────────

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

async function applyGitignore(files: string[]): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(ROOT, ".gitignore"), "utf8");
    const filter = ig().add(content);
    return files.filter((f) => !filter.ignores(f));
  } catch {
    return files;
  }
}

async function fileMeta(
  absPath: string,
  cached?: CachedFileMeta,
): Promise<{ md5: string; size: number; lines: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.lstat(absPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;

    if (
      cached &&
      typeof cached.mtimeMs === "number" &&
      typeof cached.lines === "number" &&
      cached.size === stat.size &&
      Math.abs(cached.mtimeMs - stat.mtimeMs) < 1
    ) {
      return { md5: cached.md5, size: cached.size, lines: cached.lines, mtimeMs: cached.mtimeMs };
    }

    const buf = await fs.readFile(absPath);
    const md5 = crypto.createHash("md5").update(buf).digest("hex");
    let lines = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) lines++;
    }
    lines += 1;
    return { md5, size: stat.size, lines, mtimeMs: stat.mtimeMs };
  } catch (err) {
    consola.warn(`读取文件失败: ${absPath}`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

function fingerprint(md5s: string[]): string {
  const sorted = [...md5s].sort();
  return crypto.createHash("md5").update(sorted.join("")).digest("hex");
}

// ── main scan ───────────────────────────────────────────────────

export async function scan(options: ScanOptions): Promise<FsdScanResult> {
  const { config, fsdStructure, targetPath } = options;
  const { srcRoot } = fsdStructure;
  const extensions = config.allowedExtensions?.length
    ? config.allowedExtensions
    : [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"];
  const exclude = config.exclude ?? [];

  const layerNames = [...fsdStructure.layers.keys()];
  const patterns = layerNames.flatMap((layer) =>
    extensions.map((ext) => `${srcRoot}/${layer}/**/*${ext}`),
  );

  const ignorePatterns = exclude.map((e) => {
    const prefix = e.startsWith("**/") ? "" : "**/";
    const suffix = e.includes("*") ? "" : "/**";
    return `${prefix}${e}${suffix}`;
  });

  let rawFiles = (
    await fg(patterns, {
      cwd: ROOT,
      absolute: false,
      onlyFiles: true,
      ignore: ignorePatterns,
      dot: true,
      followSymbolicLinks: false,
    })
  ).map(norm);

  if (targetPath) {
    const tp = norm(targetPath).replace(/\/$/, "");
    const fullTarget = tp.startsWith(srcRoot + "/") ? tp : `${srcRoot}/${tp}`;
    rawFiles = rawFiles.filter((f) => f === fullTarget || f.startsWith(fullTarget + "/"));
  }

  rawFiles = await applyGitignore(rawFiles);

  const cachedMeta = options.cachedFileMeta ?? new Map<string, CachedFileMeta>();
  const fileInfoMap = new Map<string, { md5: string; size: number; lines: number; mtimeMs: number }>();

  for (let i = 0; i < rawFiles.length; i += MD5_BATCH) {
    const batch = rawFiles.slice(i, i + MD5_BATCH);
    const results = await Promise.all(
      batch.map(async (rel) => {
        const info = await fileMeta(path.join(ROOT, rel), cachedMeta.get(rel));
        return [rel, info] as const;
      }),
    );
    for (const [rel, info] of results) {
      if (info) fileInfoMap.set(rel, info);
    }
  }

  const layers = new Map<FsdLayer, FsdTreeNode>();
  const nodeMap = new Map<string, FsdTreeNode>();
  const analysisTargets: string[] = [];

  for (const [layerName, _layerAbsPath] of fsdStructure.layers) {
    const layerRelPath = `${srcRoot}/${layerName}`;
    const layerFiles = [...fileInfoMap.entries()].filter(([rel]) =>
      rel.startsWith(layerRelPath + "/"),
    );

    if (layerFiles.length === 0) continue;

    const layerPos: FsdPosition = { layer: layerName };

    if (SLICED_LAYERS.has(layerName)) {
      const sliceMap = new Map<string, Array<[string, typeof layerFiles[0][1]]>>();
      for (const [rel, info] of layerFiles) {
        const pos = resolvePosition(rel, srcRoot);
        if (!pos?.slice) continue;
        const sliceKey = `${layerRelPath}/${pos.slice}`;
        const list = sliceMap.get(sliceKey) ?? [];
        list.push([rel, info]);
        sliceMap.set(sliceKey, list);
      }

      const sliceNodes: FsdTreeNode[] = [];
      for (const [slicePath, sliceFiles] of [...sliceMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sliceName = path.basename(slicePath);
        const slicePos: FsdPosition = { layer: layerName, slice: sliceName };

        const segmentMap = new Map<string, Array<[string, typeof sliceFiles[0][1]]>>();
        const rootFiles: Array<[string, typeof sliceFiles[0][1]]> = [];

        for (const [rel, info] of sliceFiles) {
          const pos = resolvePosition(rel, srcRoot)!;
          if (pos.segment) {
            const segKey = `${slicePath}/${pos.segment}`;
            const list = segmentMap.get(segKey) ?? [];
            list.push([rel, info]);
            segmentMap.set(segKey, list);
          } else {
            rootFiles.push([rel, info]);
          }
        }

        const children: Array<FsdTreeNode | FsdFileNode> = [];

        for (const [segPath, segFiles] of [...segmentMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const segName = path.basename(segPath);
          const segPos: FsdPosition = { layer: layerName, slice: sliceName, segment: segName };

          const fileNodes: FsdFileNode[] = segFiles.map(([rel, info]) => ({
            kind: "file" as const,
            name: path.basename(rel),
            path: rel,
            fsd: segPos,
            md5: info.md5,
            size: info.size,
            lines: info.lines,
            mtimeMs: info.mtimeMs,
          }));

          const segNode: FsdTreeNode = {
            kind: "segment",
            name: segName,
            path: segPath,
            fsd: segPos,
            fingerprint: fingerprint(fileNodes.map((f) => f.md5)),
            children: fileNodes,
          };
          nodeMap.set(segPath, segNode);
          children.push(segNode);
        }

        for (const [rel, info] of rootFiles) {
          children.push({
            kind: "file" as const,
            name: path.basename(rel),
            path: rel,
            fsd: slicePos,
            md5: info.md5,
            size: info.size,
            lines: info.lines,
            mtimeMs: info.mtimeMs,
          });
        }

        const allMd5s = sliceFiles.map(([, info]) => info.md5);
        const sliceNode: FsdTreeNode = {
          kind: "slice",
          name: sliceName,
          path: slicePath,
          fsd: slicePos,
          fingerprint: fingerprint(allMd5s),
          children,
        };
        nodeMap.set(slicePath, sliceNode);
        sliceNodes.push(sliceNode);
        analysisTargets.push(slicePath);
      }

      const allLayerMd5s = layerFiles.map(([, info]) => info.md5);
      const layerNode: FsdTreeNode = {
        kind: "layer",
        name: layerName,
        path: layerRelPath,
        fsd: layerPos,
        fingerprint: fingerprint(allLayerMd5s),
        children: sliceNodes,
      };
      nodeMap.set(layerRelPath, layerNode);
      layers.set(layerName, layerNode);
    } else {
      // Direct layer (app / shared): segments directly under layer
      const segmentMap = new Map<string, Array<[string, typeof layerFiles[0][1]]>>();
      const rootFiles: Array<[string, typeof layerFiles[0][1]]> = [];

      for (const [rel, info] of layerFiles) {
        const pos = resolvePosition(rel, srcRoot);
        if (pos?.segment) {
          const segKey = `${layerRelPath}/${pos.segment}`;
          const list = segmentMap.get(segKey) ?? [];
          list.push([rel, info]);
          segmentMap.set(segKey, list);
        } else {
          rootFiles.push([rel, info]);
        }
      }

      const children: Array<FsdTreeNode | FsdFileNode> = [];

      for (const [segPath, segFiles] of [...segmentMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const segName = path.basename(segPath);
        const segPos: FsdPosition = { layer: layerName, segment: segName };

        const fileNodes: FsdFileNode[] = segFiles.map(([rel, info]) => ({
          kind: "file" as const,
          name: path.basename(rel),
          path: rel,
          fsd: segPos,
          md5: info.md5,
          size: info.size,
          lines: info.lines,
          mtimeMs: info.mtimeMs,
        }));

        const segNode: FsdTreeNode = {
          kind: "segment",
          name: segName,
          path: segPath,
          fsd: segPos,
          fingerprint: fingerprint(fileNodes.map((f) => f.md5)),
          children: fileNodes,
        };
        nodeMap.set(segPath, segNode);
        children.push(segNode);
      }

      for (const [rel, info] of rootFiles) {
        children.push({
          kind: "file" as const,
          name: path.basename(rel),
          path: rel,
          fsd: layerPos,
          md5: info.md5,
          size: info.size,
          lines: info.lines,
          mtimeMs: info.mtimeMs,
        });
      }

      const allMd5s = layerFiles.map(([, info]) => info.md5);
      const layerNode: FsdTreeNode = {
        kind: "layer",
        name: layerName,
        path: layerRelPath,
        fsd: layerPos,
        fingerprint: fingerprint(allMd5s),
        children,
      };
      nodeMap.set(layerRelPath, layerNode);
      layers.set(layerName, layerNode);
      analysisTargets.push(layerRelPath);
    }
  }

  return { layers, analysisTargets: analysisTargets.sort(), nodeMap };
}
