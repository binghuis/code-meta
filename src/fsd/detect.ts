/**
 * Detect and validate FSD project structure; map paths to FsdPosition.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { type FsdLayer, type FsdPosition, FSD_LAYERS, SLICED_LAYERS } from "./types";

const LAYER_SET: ReadonlySet<string> = new Set(FSD_LAYERS);

export interface FsdStructure {
  /** Detected layers and their absolute paths. */
  layers: Map<FsdLayer, string>;
  /** Absolute path of the FSD source root (e.g. /project/src). */
  absSrcRoot: string;
  /** Relative srcRoot as configured (e.g. "src"). */
  srcRoot: string;
}

/**
 * Validate that the project follows FSD structure.
 * Requires at least `shared` + one sliced layer to be present.
 */
export async function detectFsdStructure(
  projectRoot: string,
  srcRoot: string,
): Promise<FsdStructure> {
  const absSrcRoot = path.join(projectRoot, srcRoot);

  let entries: string[];
  try {
    const dirents = await fs.readdir(absSrcRoot, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    throw new Error(
      `无法读取 srcRoot 目录「${srcRoot}」，请确认路径正确且项目采用 FSD 架构。`,
    );
  }

  const layers = new Map<FsdLayer, string>();
  for (const name of entries) {
    if (LAYER_SET.has(name)) {
      layers.set(name as FsdLayer, path.join(absSrcRoot, name));
    }
  }

  if (!layers.has("shared")) {
    throw new Error(
      `FSD 校验失败：未在「${srcRoot}」下发现 shared 层。` +
        `检测到的目录：${entries.join(", ")}`,
    );
  }

  const hasSliced = [...layers.keys()].some((l) => SLICED_LAYERS.has(l));
  if (!hasSliced) {
    throw new Error(
      `FSD 校验失败：除 shared 外未发现任何业务层（pages/widgets/features/entities）。` +
        `检测到的层：${[...layers.keys()].join(", ")}`,
    );
  }

  return { layers, absSrcRoot, srcRoot };
}

/**
 * Derive FsdPosition from a relative file/dir path (relative to project root).
 * e.g. "src/features/cart/ui/Button.tsx" → { layer: "features", slice: "cart", segment: "ui" }
 */
export function resolvePosition(
  relPath: string,
  srcRoot: string,
): FsdPosition | null {
  const normalized = relPath.replace(/\\/g, "/");

  const prefix = srcRoot === "." ? "" : `${srcRoot}/`;
  if (prefix && !normalized.startsWith(prefix)) return null;

  const inner = prefix ? normalized.slice(prefix.length) : normalized;
  const parts = inner.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const layerName = parts[0]!;
  if (!LAYER_SET.has(layerName)) return null;

  const layer = layerName as FsdLayer;

  if (!SLICED_LAYERS.has(layer)) {
    const segment = parts[1];
    return { layer, ...(segment ? { segment } : {}) };
  }

  const slice = parts[1];
  if (!slice) return { layer };

  const segment = parts[2];
  return { layer, slice, ...(segment ? { segment } : {}) };
}
