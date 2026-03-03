/**
 * Human override layer: read .code-meta/overrides.yaml and merge with AI results.
 */

import type { DirAnalysis, OverrideEntry, OverridesMap } from "../core/types";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ROOT } from "../core/constants";
const OVERRIDES_PATH = path.join(ROOT, ".code-meta", "overrides.yaml");

export async function loadOverrides(): Promise<OverridesMap> {
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, "utf8");
    const data = parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as OverridesMap;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Deep merge override into analysis. Override fields take priority.
 */
export function mergeOverride(analysis: DirAnalysis, override: OverrideEntry): DirAnalysis {
  const result = { ...analysis };

  if (override.summary != null) result.summary = override.summary;
  if (override.businessDomain != null) result.businessDomain = override.businessDomain;
  if (override.scenarios != null) result.scenarios = override.scenarios;
  if (override.conventions != null) result.conventions = override.conventions;

  if (override.files != null && override.files.length > 0) {
    const byName = new Map(result.files.map((f) => [f.name, { ...f }]));
    for (const o of override.files) {
      const existing = byName.get(o.name);
      if (existing) {
        if (o.purpose != null) existing.purpose = o.purpose;
        if (o.exports != null) existing.exports = o.exports;
      } else {
        byName.set(o.name, {
          name: o.name,
          purpose: o.purpose ?? "",
          exports: o.exports ?? [],
        });
      }
    }
    result.files = [...byName.values()];
  }

  if (override.subdirs != null && override.subdirs.length > 0) {
    const byName = new Map(result.subdirs.map((s) => [s.name, { ...s }]));
    for (const o of override.subdirs) {
      const existing = byName.get(o.name);
      if (existing && o.summary != null) existing.summary = o.summary;
      else if (o.name != null)
        byName.set(o.name, { name: o.name, summary: o.summary ?? "" });
    }
    result.subdirs = [...byName.values()];
  }

  return result;
}

export function getMergedAnalysis(
  dirPath: string,
  analysis: DirAnalysis,
  overrides: OverridesMap,
): DirAnalysis {
  const override = overrides[dirPath];
  if (!override) return analysis;
  return mergeOverride(analysis, override);
}
