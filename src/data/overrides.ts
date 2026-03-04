/**
 * Human overrides for FSD analysis results (.code-meta/overrides.yaml).
 */

import type { OverrideEntry, OverridesMap } from "../core/types";
import type { AnalysisResult, LayerDirectAnalysis, SegmentAnalysis, SliceAnalysis } from "../fsd/types";
import { isSliceAnalysis } from "../fsd/types";

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { ROOT } from "../core/constants";

export async function loadOverrides(): Promise<OverridesMap> {
  const filePath = path.join(ROOT, ".code-meta", "overrides.yaml");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = YAML.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as OverridesMap;
  } catch {
    return {};
  }
}

function mergeSegments(
  base: SegmentAnalysis[],
  overrideSegs: NonNullable<OverrideEntry["segments"]>,
): SegmentAnalysis[] {
  const merged = [...base];
  for (const oSeg of overrideSegs) {
    const existing = merged.find((s) => s.name === oSeg.name);
    if (existing) {
      if (oSeg.summary !== undefined) existing.summary = oSeg.summary;
    } else {
      merged.push({ name: oSeg.name, summary: oSeg.summary ?? "", files: [] });
    }
  }
  return merged;
}

export function mergeOverride(
  analysis: AnalysisResult,
  override: OverrideEntry,
): AnalysisResult {
  if (isSliceAnalysis(analysis)) {
    const result: SliceAnalysis = { ...analysis };
    if (override.summary !== undefined) result.summary = override.summary;
    if (override.scenarios !== undefined) result.scenarios = override.scenarios;
    if (override.conventions !== undefined) result.conventions = override.conventions;
    if (override.segments) result.segments = mergeSegments(result.segments, override.segments);
    return result;
  }

  const result: LayerDirectAnalysis = { ...analysis };
  if (override.summary !== undefined) result.summary = override.summary;
  if (override.segments) result.segments = mergeSegments(result.segments, override.segments);
  return result;
}

export function getMergedAnalysis(
  targetPath: string,
  analysis: AnalysisResult,
  overrides: OverridesMap,
): AnalysisResult {
  const override = overrides[targetPath];
  if (!override) return analysis;
  return mergeOverride(analysis, override);
}
