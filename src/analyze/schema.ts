/**
 * Zod schemas for FSD analysis output; used for JSON Schema generation and runtime validation.
 */

import * as z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type Zod3Compatible = Parameters<typeof zodToJsonSchema>[0];

const FileAnalysisSchema = z.object({
  name: z.string(),
  purpose: z.string().describe("文件职责，一句话"),
  exports: z.array(z.string()).describe("关键导出名"),
});

const SegmentAnalysisSchema = z.object({
  name: z.string(),
  summary: z.string().describe("一句话概括该 Segment 的职责"),
  files: z.array(FileAnalysisSchema).describe("该 Segment 下的文件列表"),
});

export const SliceAnalysisSchema = z.object({
  summary: z.string().describe("该切片的业务功能描述，中文"),
  scenarios: z.array(z.string()).describe("使用场景列表"),
  conventions: z.array(z.string()).describe("观察到的编码约定"),
  publicApi: z.array(z.string()).describe("公共 API 导出名"),
  segments: z.array(SegmentAnalysisSchema).describe("各 Segment 详情"),
});

export const LayerDirectAnalysisSchema = z.object({
  summary: z.string().describe("该层的整体职责描述，中文"),
  segments: z.array(SegmentAnalysisSchema).describe("各 Segment 详情"),
});

export function getSliceJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(SliceAnalysisSchema as unknown as Zod3Compatible, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export function getLayerDirectJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(LayerDirectAnalysisSchema as unknown as Zod3Compatible, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}
