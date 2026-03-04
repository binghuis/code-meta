/**
 * FSD (Feature-Sliced Design) domain types.
 */

export const FSD_LAYERS = ["app", "pages", "widgets", "features", "entities", "shared"] as const;
export type FsdLayer = (typeof FSD_LAYERS)[number];

export const SLICED_LAYERS: ReadonlySet<FsdLayer> = new Set(["pages", "widgets", "features", "entities"]);

export const STANDARD_SEGMENTS = ["ui", "api", "model", "lib", "config"] as const;
export type StandardSegment = (typeof STANDARD_SEGMENTS)[number];

export interface FsdPosition {
  layer: FsdLayer;
  slice?: string;
  segment?: string;
}

export const LAYER_DESCRIPTIONS: Record<FsdLayer, string> = {
  app: "全局配置、路由、Provider 等应用入口层",
  pages: "页面视图组件，由 widgets + features 拼装而成",
  widgets: "业务视图组件，聚焦视图聚合，强绑定特定业务场景",
  features: "可复用的最小业务功能组件，封装 UI + 业务逻辑",
  entities: "业务实体层，管理数据结构、请求接口、状态等",
  shared: "与业务无关的通用代码（UI 组件、工具函数、配置等）",
};

export interface FileAnalysis {
  name: string;
  purpose: string;
  exports: string[];
}

export interface SegmentAnalysis {
  name: string;
  summary: string;
  files: FileAnalysis[];
}

export interface SliceAnalysis {
  summary: string;
  scenarios: string[];
  conventions: string[];
  publicApi: string[];
  segments: SegmentAnalysis[];
}

export interface LayerDirectAnalysis {
  summary: string;
  segments: SegmentAnalysis[];
}

export type AnalysisResult = SliceAnalysis | LayerDirectAnalysis;

export function isSliceAnalysis(a: AnalysisResult): a is SliceAnalysis {
  return "publicApi" in a;
}
